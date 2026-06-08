"use strict";

const fs = require("node:fs");
const Database = require("better-sqlite3");
const { SESSIONS_PER_PAGE, getDefaults, SESSION_COLUMNS, getLang, getConfig } = require("./config");
const { escapeHTML, formatNumber, formatRelativeTime } = require("./utils");

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

/** Return a map of tableName -> Set of column names. */
function introspectSchema(db) {
  const schema = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  for (const row of tables) {
    const t = row.name;
    const cols = db.pragma(`table_info(${t})`);
    schema[t] = new Set(cols.map(c => c.name));
  }
  return schema;
}

// ---------------------------------------------------------------------------
// Field resolver
// ---------------------------------------------------------------------------

/**
 * Build a field resolver bound to a given schema.
 *
 * FIELD_MAP defines, for each logical field name, a list of candidate
 * expressions to try in order. Each candidate has:
 *   - requires: array of "table.column" the candidate depends on
 *   - per-context expressions:
 *       agg_session_scope (s = session row in a GROUP BY s.directory query)
 *       per_session_join  (returns a SELECT clause for a CTE keyed by session_id;
 *                          the CTE is aliased as `t`)
 *       global_scalar     (a scalar subquery for the global-stats SELECT)
 *
 * When no candidate is satisfied by the current schema, the resolver falls back
 * to a constant (typically `0` for numerics, `NULL` for text/identifiers) and
 * records the field as "missing" so we can log it once at startup.
 */
function makeFieldResolver(schema) {
  const has = (tableCol) => {
    const [t, c] = tableCol.split(".");
    return schema[t] && schema[t].has(c);
  };

  // assistant-message JSON predicate (used in multiple candidates)
  const assistantWhere = "json_extract(m.data, '$.role') = 'assistant'";

  const FIELD_MAP = {
    // ---- Numeric token/cost fields ----
    tokens_input: {
      fallback: "0",
      candidates: [
        {
          requires: ["session.tokens_input"],
          agg_session_scope: "COALESCE(SUM(s.tokens_input), 0)",
          per_session_select: "s.tokens_input AS tokens_input",
          per_session_from_t: "COALESCE(t.tokens_input, 0)",
          global_scalar: "COALESCE((SELECT SUM(tokens_input) FROM session), 0)",
        },
        {
          requires: ["message.data"],
          agg_session_scope: "COALESCE(SUM(t.tokens_input), 0)",
          per_session_from_t: "COALESCE(t.tokens_input, 0)",
          cte_select: "SUM(json_extract(m.data, '$.tokens.input')) AS tokens_input",
          global_scalar: `COALESCE((SELECT SUM(json_extract(m.data, '$.tokens.input')) FROM message m WHERE ${assistantWhere}), 0)`,
        },
      ],
    },
    tokens_output: {
      fallback: "0",
      candidates: [
        {
          requires: ["session.tokens_output"],
          agg_session_scope: "COALESCE(SUM(s.tokens_output), 0)",
          per_session_select: "s.tokens_output AS tokens_output",
          per_session_from_t: "COALESCE(t.tokens_output, 0)",
          global_scalar: "COALESCE((SELECT SUM(tokens_output) FROM session), 0)",
        },
        {
          requires: ["message.data"],
          agg_session_scope: "COALESCE(SUM(t.tokens_output), 0)",
          per_session_from_t: "COALESCE(t.tokens_output, 0)",
          cte_select: "SUM(json_extract(m.data, '$.tokens.output')) AS tokens_output",
          global_scalar: `COALESCE((SELECT SUM(json_extract(m.data, '$.tokens.output')) FROM message m WHERE ${assistantWhere}), 0)`,
        },
      ],
    },
    tokens_reasoning: {
      fallback: "0",
      candidates: [
        {
          requires: ["session.tokens_reasoning"],
          agg_session_scope: "COALESCE(SUM(s.tokens_reasoning), 0)",
          per_session_select: "s.tokens_reasoning AS tokens_reasoning",
          per_session_from_t: "COALESCE(t.tokens_reasoning, 0)",
          global_scalar: "COALESCE((SELECT SUM(tokens_reasoning) FROM session), 0)",
        },
        {
          requires: ["message.data"],
          agg_session_scope: "COALESCE(SUM(t.tokens_reasoning), 0)",
          per_session_from_t: "COALESCE(t.tokens_reasoning, 0)",
          cte_select: "SUM(json_extract(m.data, '$.tokens.reasoning')) AS tokens_reasoning",
          global_scalar: `COALESCE((SELECT SUM(json_extract(m.data, '$.tokens.reasoning')) FROM message m WHERE ${assistantWhere}), 0)`,
        },
      ],
    },
    tokens_cache_read: {
      fallback: "0",
      candidates: [
        {
          requires: ["session.tokens_cache_read"],
          agg_session_scope: "COALESCE(SUM(s.tokens_cache_read), 0)",
          per_session_from_t: "COALESCE(t.tokens_cache_read, 0)",
          global_scalar: "COALESCE((SELECT SUM(tokens_cache_read) FROM session), 0)",
        },
        {
          requires: ["message.data"],
          agg_session_scope: "COALESCE(SUM(t.tokens_cache_read), 0)",
          per_session_from_t: "COALESCE(t.tokens_cache_read, 0)",
          cte_select: "SUM(json_extract(m.data, '$.tokens.cache.read')) AS tokens_cache_read",
          global_scalar: `COALESCE((SELECT SUM(json_extract(m.data, '$.tokens.cache.read')) FROM message m WHERE ${assistantWhere}), 0)`,
        },
      ],
    },
    tokens_cache_write: {
      fallback: "0",
      candidates: [
        {
          requires: ["session.tokens_cache_write"],
          agg_session_scope: "COALESCE(SUM(s.tokens_cache_write), 0)",
          per_session_from_t: "COALESCE(t.tokens_cache_write, 0)",
          global_scalar: "COALESCE((SELECT SUM(tokens_cache_write) FROM session), 0)",
        },
        {
          requires: ["message.data"],
          agg_session_scope: "COALESCE(SUM(t.tokens_cache_write), 0)",
          per_session_from_t: "COALESCE(t.tokens_cache_write, 0)",
          cte_select: "SUM(json_extract(m.data, '$.tokens.cache.write')) AS tokens_cache_write",
          global_scalar: `COALESCE((SELECT SUM(json_extract(m.data, '$.tokens.cache.write')) FROM message m WHERE ${assistantWhere}), 0)`,
        },
      ],
    },
    cost: {
      fallback: "0",
      candidates: [
        {
          requires: ["session.cost"],
          agg_session_scope: "COALESCE(SUM(s.cost), 0)",
          per_session_select: "s.cost AS cost",
          per_session_from_t: "COALESCE(t.cost, 0)",
          global_scalar: "COALESCE((SELECT SUM(cost) FROM session), 0)",
          today_global_scalar: (todayMs) => `COALESCE((SELECT SUM(cost) FROM session WHERE time_updated >= ${todayMs}), 0)`,
        },
        {
          requires: ["message.data"],
          agg_session_scope: "COALESCE(SUM(t.cost), 0)",
          per_session_from_t: "COALESCE(t.cost, 0)",
          cte_select: "SUM(json_extract(m.data, '$.cost')) AS cost",
          global_scalar: `COALESCE((SELECT SUM(json_extract(m.data, '$.cost')) FROM message m WHERE ${assistantWhere}), 0)`,
          today_global_scalar: (todayMs) => `COALESCE((SELECT SUM(json_extract(m.data, '$.cost')) FROM message m INNER JOIN session s2 ON s2.id = m.session_id WHERE ${assistantWhere} AND s2.time_updated >= ${todayMs}), 0)`,
        },
      ],
    },

    // ---- Summary line-change fields ----
    additions: {
      fallback: "0",
      candidates: [
        {
          requires: ["session.summary_additions"],
          agg_session_scope: "COALESCE(SUM(s.summary_additions), 0)",
          per_session_select: "s.summary_additions AS summary_additions",
          global_scalar: "COALESCE((SELECT SUM(summary_additions) FROM session), 0)",
        },
      ],
    },
    deletions: {
      fallback: "0",
      candidates: [
        {
          requires: ["session.summary_deletions"],
          agg_session_scope: "COALESCE(SUM(s.summary_deletions), 0)",
          per_session_select: "s.summary_deletions AS summary_deletions",
          global_scalar: "COALESCE((SELECT SUM(summary_deletions) FROM session), 0)",
        },
      ],
    },
    files_changed: {
      fallback: "0",
      candidates: [
        {
          requires: ["session.summary_files"],
          agg_session_scope: "COALESCE(SUM(s.summary_files), 0)",
          per_session_select: "s.summary_files AS summary_files",
          global_scalar: "COALESCE((SELECT SUM(summary_files) FROM session), 0)",
        },
      ],
    },

    // ---- Per-session text fields (only used in per-session SELECT) ----
    agent: {
      fallback: "NULL",
      candidates: [
        {
          requires: ["session.agent"],
          per_session_select: "s.agent AS agent",
        },
        {
          requires: ["message.data"],
          per_session_from_t: "t.agent",
          cte_select: "json_extract(m.data, '$.agent') AS agent",
        },
      ],
    },
    model: {
      fallback: "NULL",
      candidates: [
        {
          requires: ["session.model"],
          per_session_select: "s.model AS model",
        },
        {
          requires: ["message.data"],
          per_session_from_t: "t.model",
          cte_select:
            "(COALESCE(json_extract(m.data, '$.providerID'), json_extract(m.data, '$.modelID.providerID')) " +
            "|| '/' || " +
            "COALESCE(json_extract(m.data, '$.modelID.id'), json_extract(m.data, '$.modelID'))) AS model",
        },
      ],
    },
  };

  const missing = [];
  const resolved = {}; // fieldName -> { candidate, fallback } | { fallback }

  for (const [name, def] of Object.entries(FIELD_MAP)) {
    const pick = def.candidates.find(c => c.requires.every(has));
    if (pick) {
      resolved[name] = { candidate: pick, fallback: def.fallback };
    } else {
      resolved[name] = { candidate: null, fallback: def.fallback };
      missing.push(name);
    }
  }

  // Whether any field needs the per-session message CTE (`t`)
  const needsMessageCTE = Object.values(resolved).some(r => {
    if (!r.candidate) return false;
    return r.candidate.requires.includes("message.data") &&
      (r.candidate.cte_select || r.candidate.per_session_from_t);
  });

  // Build the CTE body (only for fields whose chosen candidate is the message
  // JSON one). Always includes session_id key.
  let cteBody = null;
  if (needsMessageCTE) {
    const cteLines = ["session_id"];
    for (const [name, r] of Object.entries(resolved)) {
      if (r.candidate && r.candidate.requires.includes("message.data") && r.candidate.cte_select) {
        cteLines.push(r.candidate.cte_select);
      }
    }
    cteBody = `
      SELECT
        ${cteLines.join(",\n        ")}
      FROM message m
      WHERE ${assistantWhere}
      GROUP BY session_id
    `;
  }

  // Helpers used by query builders
  function aggExpr(name) {
    const r = resolved[name];
    if (r.candidate && r.candidate.agg_session_scope) return r.candidate.agg_session_scope;
    return r.fallback;
  }
  function perSessionExpr(name) {
    const r = resolved[name];
    if (!r.candidate) return `${r.fallback} AS ${name}`;
    if (r.candidate.per_session_select) {
      return r.candidate.per_session_select;
    }
    if (r.candidate.per_session_from_t) {
      return `${r.candidate.per_session_from_t} AS ${name}`;
    }
    return `${r.fallback} AS ${name}`;
  }
  function globalScalar(name, timeFilterWhere) {
    const r = resolved[name];
    if (r.candidate && r.candidate.global_scalar) {
      if (!timeFilterWhere) return r.candidate.global_scalar;
      // Inject time filter into scalar subqueries:
      // For session-table queries: "FROM session)" -> "FROM session WHERE ..."
      // For message-table queries that already have WHERE: append AND clause
      let sql = r.candidate.global_scalar;
      if (sql.includes("FROM session)")) {
        sql = sql.replace("FROM session)", `FROM session WHERE ${timeFilterWhere})`);
      } else if (sql.includes("FROM message m WHERE")) {
        // message-based: join session to filter by time
        sql = sql.replace(
          "FROM message m WHERE",
          `FROM message m INNER JOIN session _sf ON _sf.id = m.session_id WHERE _sf.time_updated >= 0 AND`
        );
        // Now replace the placeholder with actual filter
        sql = sql.replace("_sf.time_updated >= 0", timeFilterWhere.replace(/\btime_updated\b/, "_sf.time_updated"));
      }
      return sql;
    }
    return r.fallback;
  }
  function todayGlobalScalar(name, todayMs) {
    const r = resolved[name];
    if (r.candidate && r.candidate.today_global_scalar) return r.candidate.today_global_scalar(todayMs);
    return r.fallback;
  }

  // Build a SQL predicate to filter out sessions with zero tokens (no conversations).
  // Works in contexts where `s` is the session table and `t` is the CTE alias.
  // Used in WHERE clauses before GROUP BY or in per-session queries.
  function nonEmptyFilter() {
    const rIn  = resolved.tokens_input;
    const rOut = resolved.tokens_output;
    // If both fields are missing from schema, we can't filter — return tautology
    if (!rIn.candidate && !rOut.candidate) return "1=1";
    // If session table has tokens_input / tokens_output directly
    if (rIn.candidate && rIn.candidate.per_session_select) {
      return "(COALESCE(s.tokens_input, 0) + COALESCE(s.tokens_output, 0)) > 0";
    }
    // Using CTE (message JSON fallback)
    return "(COALESCE(t.tokens_input, 0) + COALESCE(t.tokens_output, 0)) > 0";
  }

  // Standalone scalar subquery that counts non-empty sessions (for global stats).
  function globalNonEmptySessionCount(timeFilterWhere) {
    const rIn  = resolved.tokens_input;
    const rOut = resolved.tokens_output;
    const timeAnd = timeFilterWhere ? ` AND ${timeFilterWhere}` : "";
    if (!rIn.candidate && !rOut.candidate) {
      return timeFilterWhere
        ? `(SELECT COUNT(*) FROM session WHERE ${timeFilterWhere})`
        : "(SELECT COUNT(*) FROM session)";
    }
    if (rIn.candidate && rIn.candidate.per_session_select) {
      // session table has tokens columns directly
      return `(SELECT COUNT(*) FROM session WHERE (COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0)) > 0${timeAnd})`;
    }
    // message JSON fallback
    const assistWhere = "json_extract(m.data, '$.role') = 'assistant'";
    const timeJoin = timeFilterWhere
      ? ` INNER JOIN session _sf ON _sf.id = m.session_id`
      : "";
    const timeAndMsg = timeFilterWhere
      ? ` AND ${timeFilterWhere.replace(/\btime_updated\b/, "_sf.time_updated")}`
      : "";
    return `(SELECT COUNT(DISTINCT m.session_id) FROM message m${timeJoin} WHERE ${assistWhere} AND (COALESCE(json_extract(m.data, '$.tokens.input'), 0) + COALESCE(json_extract(m.data, '$.tokens.output'), 0)) > 0${timeAndMsg})`;
  }

  return {
    resolved,
    missing,
    needsMessageCTE,
    cteBody,
    aggExpr,
    perSessionExpr,
    globalScalar,
    todayGlobalScalar,
    nonEmptyFilter,
    globalNonEmptySessionCount,
  };
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------
let _missingWarned = false;
function warnMissingOnce(missing) {
  if (_missingWarned || missing.length === 0) return;
  _missingWarned = true;
  console.warn(
    `Note: ${missing.length} field(s) not available in current opencode schema, ` +
    `falling back to 0/NULL: ${missing.join(", ")}`
  );
}

// Persistent DB connection — reopened only when the file changes (mtime/size)
let _dbCache = { path: null, mtime: 0, size: 0, db: null, schema: null, resolver: null };

/**
 * Get (or reopen) a read-only better-sqlite3 Database for the given path.
 * Returns { db, schema, resolver }.
 */
function getDb(dbPath) {
  const stat = fs.statSync(dbPath);
  const mtime = stat.mtimeMs;
  const size = stat.size;

  if (_dbCache.db && _dbCache.path === dbPath && _dbCache.mtime === mtime && _dbCache.size === size) {
    return _dbCache;
  }

  // Close previous connection if any
  if (_dbCache.db) {
    try { _dbCache.db.close(); } catch {}
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const schema = introspectSchema(db);
  const resolver = makeFieldResolver(schema);
  warnMissingOnce(resolver.missing);

  _dbCache = { path: dbPath, mtime, size, db, schema, resolver };
  return _dbCache;
}

/** Close the cached DB connection (e.g. on process exit). */
function closeDb() {
  if (_dbCache.db) {
    try { _dbCache.db.close(); } catch {}
    _dbCache = { path: null, mtime: 0, size: 0, db: null, schema: null, resolver: null };
  }
}

// ---------------------------------------------------------------------------
// loadData — main query function
// ---------------------------------------------------------------------------
function loadData(dbPath) {
  const { db, schema, resolver: F } = getDb(dbPath);

  // session table must at least have id/directory/time_updated to do anything
  const sessionCols = schema.session || new Set();
  if (!sessionCols.has("id") || !sessionCols.has("directory") || !sessionCols.has("time_updated")) {
    console.error("Session table missing required base columns (id/directory/time_updated). Aborting load.");
    return { globalStats: {}, projectStats: [], sessionsByDir: {} };
  }

  // Time filter: compute cutoff timestamp from config (0 = no filter)
  const filterDays = parseInt(getConfig().sessionTimeFilter, 10) || 0;
  const timeCutoffMs = filterDays > 0
    ? Date.now() - filterDays * 24 * 60 * 60 * 1000
    : 0;
  const timeFilterClause = timeCutoffMs > 0 ? ` AND s.time_updated >= ${timeCutoffMs}` : "";

  const cteClause = F.needsMessageCTE
    ? `WITH session_tokens AS (${F.cteBody})`
    : "";
  const joinClause = F.needsMessageCTE
    ? "LEFT JOIN session_tokens t ON t.session_id = s.id"
    : "";

  // 2) Project stats (grouped by session.directory)
  const statsSql = `
    ${cteClause}
    SELECT
      s.directory AS directory,
      COUNT(s.id) AS session_count,
      MAX(s.time_updated) AS last_used,
      ${F.aggExpr("tokens_input")} AS tokens_input,
      ${F.aggExpr("tokens_output")} AS tokens_output,
      ${F.aggExpr("tokens_reasoning")} AS tokens_reasoning,
      ${F.aggExpr("tokens_cache_read")} AS tokens_cache_read,
      ${F.aggExpr("tokens_cache_write")} AS tokens_cache_write,
      ${F.aggExpr("cost")} AS cost,
      ${F.aggExpr("additions")} AS additions,
      ${F.aggExpr("deletions")} AS deletions,
      ${F.aggExpr("files_changed")} AS files_changed
    FROM session s
    ${joinClause}
    WHERE s.directory != ''${sessionCols.has("parent_session_id") ? " AND s.parent_session_id IS NULL" : ""} AND ${F.nonEmptyFilter()}${timeFilterClause}
    GROUP BY s.directory
    ORDER BY last_used DESC
  `;
  const projectStats = db.prepare(statsSql).all();

  // 3) Global stats (scalar subqueries; no need to share the CTE)
  // Compute start-of-today in local timezone as millisecond timestamp
  const now = new Date();
  const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Time filter for global scalar subqueries (e.g. "time_updated >= 123456")
  const globalTimeFilter = timeCutoffMs > 0 ? `time_updated >= ${timeCutoffMs}` : "";

  const globalSql = `
    SELECT
      ${F.globalNonEmptySessionCount(globalTimeFilter)} AS total_sessions,
      ${F.globalScalar("tokens_input", globalTimeFilter)} AS tokens_input,
      ${F.globalScalar("tokens_output", globalTimeFilter)} AS tokens_output,
      ${F.globalScalar("tokens_reasoning", globalTimeFilter)} AS tokens_reasoning,
      ${F.globalScalar("tokens_cache_read", globalTimeFilter)} AS tokens_cache_read,
      ${F.globalScalar("tokens_cache_write", globalTimeFilter)} AS tokens_cache_write,
      ${F.todayGlobalScalar("cost", todayStartMs)} AS today_cost,
      ${F.globalScalar("cost", globalTimeFilter)} AS cost,
      ${F.globalScalar("additions", globalTimeFilter)} AS additions,
      ${F.globalScalar("deletions", globalTimeFilter)} AS deletions,
      ${F.globalScalar("files_changed", globalTimeFilter)} AS files_changed
  `;
  const globalStats = db.prepare(globalSql).get();

  // 4) Sessions per directory
  const versionCol = sessionCols.has("version") ? "s.version" : "NULL AS version";
  const timeCreatedCol = sessionCols.has("time_created") ? "s.time_created" : "NULL AS time_created";
  const titleCol = sessionCols.has("title") ? "s.title" : "NULL AS title";
  const parentCol = sessionCols.has("parent_session_id") ? "s.parent_session_id" : "NULL AS parent_session_id";

  // Use ROW_NUMBER() window function to fetch top-N sessions per directory
  // in a single query instead of N separate queries (one per project).
  const sessSql = `
    ${cteClause}
    SELECT * FROM (
      SELECT
        s.id, ${titleCol}, s.directory, ${versionCol},
        ${timeCreatedCol}, s.time_updated, ${parentCol},
        ${F.perSessionExpr("agent")},
        ${F.perSessionExpr("model")},
        ${F.perSessionExpr("tokens_input")},
        ${F.perSessionExpr("tokens_output")},
        ${F.perSessionExpr("tokens_reasoning")},
        ${F.perSessionExpr("cost")},
        ${F.perSessionExpr("additions")},
        ${F.perSessionExpr("deletions")},
        ${F.perSessionExpr("files_changed")},
        ROW_NUMBER() OVER (PARTITION BY s.directory ORDER BY s.time_updated DESC) AS _rn
      FROM session s
      ${joinClause}
      WHERE s.directory != '' AND ${parentCol.startsWith("s.") ? "s.parent_session_id IS NULL" : "1=1"} AND ${F.nonEmptyFilter()}${timeFilterClause}
    ) WHERE _rn <= ${SESSIONS_PER_PAGE}
  `;

  const sessionsByDir = {};
  for (const row of db.prepare(sessSql).all()) {
    delete row._rn; // remove internal ranking column
    const dir = row.directory;
    if (!sessionsByDir[dir]) sessionsByDir[dir] = [];
    sessionsByDir[dir].push(row);
  }

  return { globalStats, projectStats, sessionsByDir };
}

// ---------------------------------------------------------------------------
// queryMoreSessions — paginated session loading with server-rendered HTML rows
// ---------------------------------------------------------------------------
function queryMoreSessions(dbPath, directory, offset, limit) {
  const { db, schema, resolver: F } = getDb(dbPath);

  const sessionCols = schema.session || new Set();
  const versionCol = sessionCols.has("version") ? "s.version" : "NULL AS version";
  const timeCreatedCol = sessionCols.has("time_created") ? "s.time_created" : "NULL AS time_created";
  const titleCol = sessionCols.has("title") ? "s.title" : "NULL AS title";
  const parentCol = sessionCols.has("parent_session_id") ? "s.parent_session_id" : "NULL AS parent_session_id";

  const cteClause = F.needsMessageCTE ? `WITH session_tokens AS (${F.cteBody})` : "";
  const joinClause = F.needsMessageCTE ? "LEFT JOIN session_tokens t ON t.session_id = s.id" : "";

  // Time filter for queryMoreSessions
  const moreFilterDays = parseInt(getConfig().sessionTimeFilter, 10) || 0;
  const moreTimeCutoffMs = moreFilterDays > 0
    ? Date.now() - moreFilterDays * 24 * 60 * 60 * 1000
    : 0;
  const moreTimeFilterClause = moreTimeCutoffMs > 0 ? ` AND s.time_updated >= ${moreTimeCutoffMs}` : "";

  const sql = `
    ${cteClause}
    SELECT
      s.id, ${titleCol}, s.directory, ${versionCol},
      ${timeCreatedCol}, s.time_updated, ${parentCol},
      ${F.perSessionExpr("agent")},
      ${F.perSessionExpr("model")},
      ${F.perSessionExpr("tokens_input")},
      ${F.perSessionExpr("tokens_output")},
      ${F.perSessionExpr("tokens_reasoning")},
      ${F.perSessionExpr("cost")},
      ${F.perSessionExpr("additions")},
      ${F.perSessionExpr("deletions")},
      ${F.perSessionExpr("files_changed")}
    FROM session s
    ${joinClause}
    WHERE s.directory = ? AND ${parentCol.startsWith("s.") ? "s.parent_session_id IS NULL" : "1=1"} AND ${F.nonEmptyFilter()}${moreTimeFilterClause}
    ORDER BY s.time_updated DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const sessions = db.prepare(sql).all(directory);

  // Render HTML rows using the same logic as buildHTML
  const L = getLang();
  const currentConfig = getConfig();
  const sc = currentConfig.sessionColumns || getDefaults(SESSION_COLUMNS);

  function renderCell(key, s) {
    let modelName = "";
    if (s.model) { try { modelName = JSON.parse(s.model).id || ""; } catch {} }
    const defs = {
      title:            `<td class="session-title" title="${escapeHTML(s.title || "")}">${escapeHTML(s.title || L.untitled)}</td>`,
      agent:            `<td><span class="agent-badge agent-${escapeHTML(s.agent || "default")}">${escapeHTML(s.agent || "-")}</span></td>`,
      model:            `<td class="model-name">${escapeHTML(modelName)}</td>`,
      time_updated:     `<td class="time-cell">${formatRelativeTime(s.time_updated, getLang)}</td>`,
      tokens:           `<td class="token-cell">${formatNumber(s.tokens_input + s.tokens_output)}</td>`,
      tokens_input:     `<td class="token-cell">${formatNumber(s.tokens_input)}</td>`,
      tokens_output:    `<td class="token-cell">${formatNumber(s.tokens_output)}</td>`,
      tokens_reasoning: `<td class="token-cell">${formatNumber(s.tokens_reasoning || 0)}</td>`,
      cost:             `<td class="token-cell">$${(s.cost || 0).toFixed(4)}</td>`,
      changes:          `<td class="change-cell"><span class="additions">+${formatNumber(s.summary_additions || 0)}</span><span class="deletions">-${formatNumber(s.summary_deletions || 0)}</span></td>`,
      additions:        `<td class="change-cell"><span class="additions">+${formatNumber(s.summary_additions || 0)}</span></td>`,
      deletions:        `<td class="change-cell"><span class="deletions">-${formatNumber(s.summary_deletions || 0)}</span></td>`,
      files_changed:    `<td class="token-cell">${formatNumber(s.summary_files || 0)}</td>`,
      time_created:     `<td class="time-cell">${formatRelativeTime(s.time_created, getLang)}</td>`,
      version:          `<td class="time-cell">${escapeHTML(s.version || "-")}</td>`,
    };
    return defs[key] || "<td>-</td>";
  }

  const NON_RESUMABLE_AGENTS = new Set(["explore", "general"]);
  const rowsHTML = sessions.map((s) => {
    const cells = sc.map((key) => renderCell(key, s)).join("");
    const canResume = !s.parent_session_id && !NON_RESUMABLE_AGENTS.has(s.agent);
    const resumeBtn = canResume
      ? `<button class="resume-btn" onclick="event.stopPropagation(); openSession('${escapeHTML(s.directory.replace(/\\/g, "\\\\"))}', '${escapeHTML(s.id)}')" title="${L.resume}">${L.resume}</button>`
      : "";
    return `<tr class="session-row">${cells}<td class="action-cell">${resumeBtn}</td></tr>`;
  }).join("");

  return { rowsHTML, count: sessions.length };
}

// ---------------------------------------------------------------------------
// queryTodayCostDetail — today's cost breakdown by session + sub-agents
// ---------------------------------------------------------------------------
function queryTodayCostDetail(dbPath) {
  const { db, schema, resolver: F } = getDb(dbPath);
  const sessionCols = schema.session || new Set();
  const hasParent = sessionCols.has("parent_session_id");
  const hasCost = sessionCols.has("cost");
  const hasModel = sessionCols.has("model");
  const hasAgent = sessionCols.has("agent");
  const hasTitle = sessionCols.has("title");

  // Today start timestamp (local timezone)
  const now = new Date();
  const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // --- 1) Query today's top-level sessions ---
  const topCostExpr = hasCost ? "s.cost" : `(SELECT COALESCE(SUM(json_extract(m.data, '$.cost')), 0) FROM message m WHERE json_extract(m.data, '$.role') = 'assistant' AND m.session_id = s.id)`;
  const topModelExpr = hasModel ? "s.model" : "NULL";
  const topAgentExpr = hasAgent ? "s.agent" : "NULL";
  const topTitleExpr = hasTitle ? "s.title" : "NULL";

  const topSql = `
    SELECT
      s.id,
      ${topTitleExpr} AS title,
      s.directory,
      ${topAgentExpr} AS agent,
      ${topModelExpr} AS model,
      ${topCostExpr} AS cost,
      s.time_updated
    FROM session s
    WHERE s.time_updated >= ${todayStartMs}
      ${hasParent ? "AND s.parent_session_id IS NULL" : ""}
      AND ${topCostExpr} > 0
    ORDER BY ${topCostExpr} DESC
  `;
  const topSessions = db.prepare(topSql).all();

  // --- 2) Query sub-agent sessions for today's parent sessions ---
  let subSessions = [];
  if (hasParent && topSessions.length > 0) {
    const subCostExpr = hasCost ? "s.cost" : `(SELECT COALESCE(SUM(json_extract(m.data, '$.cost')), 0) FROM message m WHERE json_extract(m.data, '$.role') = 'assistant' AND m.session_id = s.id)`;
    const subModelExpr = hasModel ? "s.model" : "NULL";
    const subAgentExpr = hasAgent ? "s.agent" : "NULL";
    const subTitleExpr = hasTitle ? "s.title" : "NULL";

    const parentIds = topSessions.map(s => `'${s.id}'`).join(",");
    const subSql = `
      SELECT
        s.id,
        s.parent_session_id,
        ${subTitleExpr} AS title,
        ${subAgentExpr} AS agent,
        ${subModelExpr} AS model,
        ${subCostExpr} AS cost,
        s.time_updated
      FROM session s
      WHERE s.parent_session_id IN (${parentIds})
        AND ${subCostExpr} > 0
      ORDER BY ${subCostExpr} DESC
    `;
    subSessions = db.prepare(subSql).all();
  }

  // --- 3) Group sub-sessions by parent ---
  const subByParent = {};
  for (const sub of subSessions) {
    if (!subByParent[sub.parent_session_id]) subByParent[sub.parent_session_id] = [];
    subByParent[sub.parent_session_id].push({
      id: sub.id,
      agent: sub.agent,
      model: sub.model,
      title: sub.title,
      cost: sub.cost || 0,
    });
  }

  // --- 4) Build result ---
  const result = topSessions.map(s => ({
    id: s.id,
    title: s.title,
    directory: s.directory,
    agent: s.agent,
    model: s.model,
    cost: s.cost || 0,
    time_updated: s.time_updated,
    subAgents: subByParent[s.id] || [],
  }));

  // Total today cost
  const totalCost = result.reduce((sum, s) => sum + s.cost, 0);

  return { sessions: result, totalCost };
}

module.exports = { loadData, queryMoreSessions, queryTodayCostDetail, closeDb };
