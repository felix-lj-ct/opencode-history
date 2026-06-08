"use strict";

const path = require("node:path");
const {
  SESSIONS_PER_PAGE, PROJECT_FIELDS, SESSION_COLUMNS,
  FIELD_LABEL_KEYS, STAT_LABEL_KEYS,
  getDefaults, getPresets, getConfig, getLang,
} = require("./config");
const { getDbCandidates } = require("./db-locator");
const { escapeHTML, formatNumber, formatRelativeTime } = require("./utils");

// ---------------------------------------------------------------------------
// HTML template builder
// ---------------------------------------------------------------------------
function buildHTML(data, dbInfo, pkgVersion) {
  const currentConfig = getConfig();
  const { globalStats, projectStats, sessionsByDir } = data;
  const presetsJSON = JSON.stringify(getPresets());
  const configJSON = JSON.stringify(currentConfig);
  const dbInfoJSON = JSON.stringify(dbInfo || { path: null, source: null });
  const L = getLang();
  const hasData = dbInfo && dbInfo.path;

  const hiddenDirs = currentConfig.hiddenDirs || [];
  const pf = currentConfig.projectFields || getDefaults(PROJECT_FIELDS);
  const sc = currentConfig.sessionColumns || getDefaults(SESSION_COLUMNS);

  // Helper: render a project stat field
  function renderProjectStat(key, p) {
    const vals = {
      session_count:     formatNumber(p.session_count),
      tokens:            formatNumber(p.tokens_input + p.tokens_output),
      tokens_input:      formatNumber(p.tokens_input),
      tokens_output:     formatNumber(p.tokens_output),
      tokens_reasoning:  formatNumber(p.tokens_reasoning),
      tokens_cache_read: formatNumber(p.tokens_cache_read),
      tokens_cache_write:formatNumber(p.tokens_cache_write),
      cost:              "$" + (p.cost || 0).toFixed(2),
      changes:           `<span class="additions">+${formatNumber(p.additions)}</span> <span class="deletions">-${formatNumber(p.deletions)}</span>`,
      additions:         `<span class="additions">+${formatNumber(p.additions)}</span>`,
      deletions:         `<span class="deletions">-${formatNumber(p.deletions)}</span>`,
      files_changed:     formatNumber(p.files_changed),
      last_used:         formatRelativeTime(p.last_used, getLang),
    };
    const v = vals[key];
    if (v == null) return "";
    const labelKey = STAT_LABEL_KEYS[key];
    const label = labelKey ? L[labelKey] : key;
    return `<div class="stat"><span class="stat-value">${v}</span><span class="stat-label">${label}</span></div>`;
  }

  // Helper: render a session table cell
  function renderSessionCell(key, s) {
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

  // Session column headers (i18n)
  const sessionHeaderLabels = {};
  SESSION_COLUMNS.forEach((c) => {
    const lk = FIELD_LABEL_KEYS[c.key];
    sessionHeaderLabels[c.key] = lk ? L[lk] : c.label;
  });

  const projectCardsHTML = projectStats
    .map((p, idx) => {
      const dir = p.directory;
      const folderName = path.basename(dir);
      const parentPath = path.dirname(dir);
      const displayName = folderName;
      const cardId = "card-" + idx;
      const isHidden = hiddenDirs.includes(dir);
      const sessions = sessionsByDir[dir] || [];

      const sessionRowsHTML = sessions
        .map((s) => {
          const cells = sc.map((key) => renderSessionCell(key, s)).join("");
          const NON_RESUMABLE_AGENTS = new Set(["explore", "general"]);
          const canResume = !s.parent_session_id && !NON_RESUMABLE_AGENTS.has(s.agent);
          const resumeBtn = canResume
            ? `<button class="resume-btn" onclick="event.stopPropagation(); openSession('${escapeHTML(s.directory.replace(/\\/g, "\\\\"))}', '${escapeHTML(s.id)}')" title="${L.resume}">${L.resume}</button>`
            : "";
          return `
          <tr class="session-row">
            ${cells}
            <td class="action-cell">
              ${resumeBtn}
            </td>
          </tr>`;
        })
        .join("");

      const statsHTML = pf.map((key) => renderProjectStat(key, p)).join("");
      const thHTML = sc.map((key) => `<th>${sessionHeaderLabels[key] || key}</th>`).join("") + "<th></th>";

      const dirEscaped = escapeHTML(dir.replace(/\\/g, "\\\\"));
      return `
      <div class="project-card${isHidden ? " hidden-card" : ""}" data-dir="${escapeHTML(dir)}" data-last-used="${p.last_used || 0}" data-sessions="${p.session_count}" data-tokens="${p.tokens_input + p.tokens_output}" data-changes="${(p.additions || 0) + (p.deletions || 0)}">
        <div class="project-header" onclick="toggleProject('${cardId}')">
          <div class="project-info">
            <div class="project-name">${escapeHTML(displayName)}</div>
            <div class="project-path">${escapeHTML(parentPath)}</div>
          </div>
          ${statsHTML}
          <button class="hide-btn" onclick="event.stopPropagation(); toggleHide('${dirEscaped}', ${isHidden})" title="${isHidden ? L.show : L.hide}">${isHidden ? L.show : L.hide}</button>
          <button class="open-btn" onclick="event.stopPropagation(); openProject('${dirEscaped}')">${L.open}</button>
        </div>
        <div class="project-sessions" id="sessions-${cardId}" style="display:none;">
          <table class="session-table">
            <thead><tr>${thHTML}</tr></thead>
            <tbody id="tbody-${cardId}">${sessionRowsHTML}</tbody>
          </table>${p.session_count > sessions.length ? `
          <div class="load-more-wrap" id="loadmore-${cardId}">
            <button class="load-more-btn" data-dir="${escapeHTML(dir)}" data-loaded="${sessions.length}" data-total="${p.session_count}" onclick="loadMoreSessions(this, '${cardId}')">${L.loadMore} (${sessions.length}/${p.session_count})</button>
          </div>` : ""}
        </div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenCode Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #0d1117; color: #c9d1d9; min-height: 100vh;
  }
  .header {
    background: #161b22; border-bottom: 1px solid #30363d;
    padding: 20px 32px; display: flex; align-items: center; gap: 16px;
  }
  .header h1 { font-size: 20px; font-weight: 600; color: #f0f6fc; }
  .header .subtitle { font-size: 13px; color: #8b949e; flex: 1; }
  .settings-btn {
    background: #30363d; color: #c9d1d9; border: 1px solid #484f58;
    border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer;
    transition: background 0.2s;
  }
  .settings-btn:hover { background: #484f58; }

  .global-stats {
    display: flex; gap: 24px; padding: 20px 32px;
    background: #161b22; border-bottom: 1px solid #30363d; flex-wrap: wrap;
  }
  .global-stat { display: flex; flex-direction: column; align-items: center; min-width: 120px; }
  .global-stat .value { font-size: 24px; font-weight: 700; color: #f0f6fc; }
  .global-stat .label { font-size: 12px; color: #8b949e; margin-top: 4px; }

  .main { max-width: 100%; margin: 0 auto; padding: 24px 32px; }
  .section-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 16px;
  }
  .section-title { font-size: 16px; font-weight: 600; color: #f0f6fc; }
  .sort-controls { display: flex; align-items: center; gap: 8px; }
  .sort-label { font-size: 12px; color: #8b949e; }
  .sort-btn {
    background: none; color: #8b949e; border: 1px solid #30363d;
    border-radius: 4px; padding: 4px 10px; font-size: 12px;
    cursor: pointer; transition: all 0.2s;
  }
  .sort-btn:hover { border-color: #58a6ff; color: #c9d1d9; }
  .sort-btn.active { border-color: #58a6ff; color: #58a6ff; background: rgba(88,166,255,0.1); }

  .time-filter { display: flex; align-items: center; gap: 6px; margin-left: 16px; padding-left: 16px; border-left: 1px solid #30363d; }
  .time-filter-label { font-size: 12px; color: #8b949e; white-space: nowrap; }
  .time-filter-input {
    width: 56px; background: #0d1117; color: #c9d1d9; border: 1px solid #30363d;
    border-radius: 4px; padding: 4px 8px; font-size: 12px; text-align: center;
    transition: border-color 0.2s;
  }
  .time-filter-input:focus { outline: none; border-color: #58a6ff; }
  .time-filter-input::-webkit-inner-spin-button,
  .time-filter-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .time-filter-input { -moz-appearance: textfield; }
  .time-filter-hint { font-size: 11px; color: #6e7681; white-space: nowrap; }

  .project-card {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    margin-bottom: 12px; overflow: hidden; transition: border-color 0.2s;
  }
  .project-card:hover { border-color: #58a6ff; }
  .project-header {
    display: grid; align-items: center; padding: 16px 20px;
    cursor: pointer; gap: 0 16px;
  }
  .project-header:hover { background: #1c2128; }
  .project-info { min-width: 0; grid-column: 1; }
  .project-name {
    font-size: 16px; font-weight: 600; color: #58a6ff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .project-path {
    font-size: 12px; color: #8b949e; margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .stat { display: flex; flex-direction: column; align-items: center; justify-self: center; }
  .stat-value { font-size: 14px; font-weight: 600; color: #f0f6fc; }
  .stat-label { font-size: 11px; color: #8b949e; margin-top: 2px; }

  .open-btn {
    background: #238636; color: #fff; border: none; border-radius: 6px;
    padding: 8px 16px; font-size: 13px; font-weight: 600;
    cursor: pointer; white-space: nowrap; transition: background 0.2s;
  }
  .open-btn:hover { background: #2ea043; }
  .open-btn:active { background: #1a7f37; }

  .project-sessions { border-top: 1px solid #30363d; background: #0d1117; }
  .session-table { width: 100%; border-collapse: collapse; }
  .session-table th {
    text-align: left; font-size: 12px; font-weight: 600;
    color: #8b949e; padding: 8px 12px; border-bottom: 1px solid #21262d;
  }
  .session-table td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #21262d; }
  .session-row:hover { background: #161b22; }
  .session-title {
    max-width: 300px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; color: #c9d1d9;
  }
  .model-name {
    font-size: 12px; color: #8b949e; max-width: 180px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .time-cell { white-space: nowrap; color: #8b949e; font-size: 12px; }
  .token-cell { white-space: nowrap; font-size: 12px; color: #8b949e; }
  .change-cell { white-space: nowrap; font-size: 12px; }
  .additions { color: #3fb950; }
  .deletions { color: #f85149; margin-left: 6px; }

  .agent-badge {
    display: inline-block; padding: 2px 8px; border-radius: 12px;
    font-size: 11px; font-weight: 600; background: #30363d; color: #8b949e;
  }
  .agent-build { background: #1f3d2a; color: #3fb950; }
  .agent-plan { background: #2a1f3d; color: #a371f7; }
  .agent-explore { background: #1f2d3d; color: #58a6ff; }
  .agent-general { background: #3d2a1f; color: #d29922; }

  /* Toast */
  .toast {
    position: fixed; bottom: 24px; right: 24px;
    background: #238636; color: #fff; padding: 12px 20px;
    border-radius: 8px; font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    transform: translateY(80px); opacity: 0;
    transition: all 0.3s ease; z-index: 1000;
  }
  .toast.show { transform: translateY(0); opacity: 1; }
  .toast.error { background: #da3633; }

  /* Settings Modal */
  .modal-overlay {
    display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.6); z-index: 2000; justify-content: center; align-items: center;
  }
  .modal-overlay.open { display: flex; }
  .modal {
    background: #161b22; border: 1px solid #30363d; border-radius: 12px;
    width: 560px; max-width: 90vw; max-height: 80vh;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-header {
    padding: 20px 24px; border-bottom: 1px solid #30363d;
    display: flex; justify-content: space-between; align-items: center;
    flex-shrink: 0;
  }
  .modal-header h2 { font-size: 18px; color: #f0f6fc; }
  .modal-close {
    background: transparent; border: none; color: #8b949e;
    cursor: pointer; padding: 0; border-radius: 8px;
    width: 32px; height: 32px;
    display: inline-flex; align-items: center; justify-content: center;
    transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
  }
  .modal-close svg { width: 16px; height: 16px; display: block; }
  .modal-close:hover { background: #30363d; color: #f0f6fc; }
  .modal-close:active { transform: scale(0.92); }
  .modal-close:focus-visible {
    outline: none; box-shadow: 0 0 0 2px #58a6ff;
  }
  .modal-body { padding: 24px; overflow-y: auto; flex: 1 1 auto; }

  /* Custom scrollbar for the modal body (WebKit) */
  .modal-body::-webkit-scrollbar { width: 10px; }
  .modal-body::-webkit-scrollbar-track {
    background: transparent;
  }
  .modal-body::-webkit-scrollbar-thumb {
    background: #30363d; border-radius: 8px;
    border: 2px solid #161b22; /* creates inset effect matching modal bg */
  }
  .modal-body::-webkit-scrollbar-thumb:hover { background: #484f58; }
  /* Firefox */
  .modal-body { scrollbar-width: thin; scrollbar-color: #30363d transparent; }

  .form-group { margin-bottom: 20px; }
  .form-label {
    display: block; font-size: 13px; font-weight: 600;
    color: #c9d1d9; margin-bottom: 8px;
  }
  .form-hint { font-size: 12px; color: #8b949e; margin-bottom: 8px; }
  .form-input {
    width: 100%; background: #0d1117; border: 1px solid #30363d;
    border-radius: 6px; padding: 8px 12px; font-size: 14px;
    color: #c9d1d9; font-family: monospace;
  }
  .form-input:focus { outline: none; border-color: #58a6ff; }

  .preset-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .preset-item {
    display: flex; align-items: center; gap: 12px;
    background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    padding: 10px 14px; cursor: pointer; transition: border-color 0.2s;
  }
  .preset-item:hover { border-color: #58a6ff; }
  .preset-item.active { border-color: #238636; background: #0d1117; }
  .preset-item .preset-name { font-size: 14px; font-weight: 600; color: #f0f6fc; }
  .preset-item .preset-cmd { font-size: 12px; color: #8b949e; font-family: monospace; }

  .or-divider {
    text-align: center; color: #484f58; font-size: 12px;
    margin: 16px 0; position: relative;
  }
  .or-divider::before, .or-divider::after {
    content: ''; position: absolute; top: 50%;
    width: 40%; height: 1px; background: #30363d;
  }
  .or-divider::before { left: 0; }
  .or-divider::after { right: 0; }

  .save-btn {
    background: #238636; color: #fff; border: none; border-radius: 6px;
    padding: 10px 20px; font-size: 14px; font-weight: 600;
    cursor: pointer; width: 100%; transition: background 0.2s;
  }
  .save-btn:hover { background: #2ea043; }

  .action-cell { white-space: nowrap; }
  .resume-btn {
    background: #30363d; color: #c9d1d9; border: 1px solid #484f58;
    border-radius: 4px; padding: 3px 10px; font-size: 12px;
    cursor: pointer; transition: all 0.2s;
  }
  .resume-btn:hover { background: #58a6ff; color: #fff; border-color: #58a6ff; }

  .hide-btn {
    background: none; color: #484f58; border: 1px solid transparent;
    border-radius: 4px; padding: 4px 10px; font-size: 12px;
    cursor: pointer; transition: all 0.2s;
  }
  .hide-btn:hover { color: #f85149; border-color: #484f58; }

  .hidden-card { display: none; }
  body.show-hidden .hidden-card {
    display: block; opacity: 0.5;
  }
  body.show-hidden .hidden-card:hover { opacity: 0.8; }
  body.show-hidden .hidden-card .hide-btn { color: #3fb950; }
  body.show-hidden .hidden-card .hide-btn:hover { color: #3fb950; border-color: #3fb950; }

  .lang-picker { display: flex; gap: 8px; margin-top: 8px; }
  .lang-btn {
    background: #0d1117; color: #8b949e; border: 1px solid #30363d;
    border-radius: 6px; padding: 8px 20px; font-size: 14px;
    cursor: pointer; transition: all 0.2s;
  }
  .lang-btn:hover { border-color: #58a6ff; color: #c9d1d9; }
  .lang-btn.active { border-color: #238636; color: #3fb950; background: #0d1117; }

  .settings-section-title {
    font-size: 15px; font-weight: 600; color: #f0f6fc;
    margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #30363d;
  }
  .field-picker {
    display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;
  }
  .field-chip {
    display: flex; align-items: center; gap: 6px;
    background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    padding: 6px 12px; cursor: pointer; transition: all 0.2s;
    font-size: 13px; color: #8b949e; user-select: none;
  }
  .field-chip:hover { border-color: #58a6ff; color: #c9d1d9; }
  .field-chip.active { border-color: #238636; background: #0d1117; color: #3fb950; }
  .field-chip input { display: none; }

  .toggle-hidden-btn {
    background: none; color: #8b949e; border: 1px solid #30363d;
    border-radius: 6px; padding: 4px 12px; font-size: 12px;
    cursor: pointer; transition: all 0.2s;
  }
  .toggle-hidden-btn:hover { border-color: #58a6ff; color: #c9d1d9; }
  .toggle-hidden-btn.active { border-color: #58a6ff; color: #58a6ff; }

  .current-terminal {
    display: inline-flex; align-items: center; gap: 6px;
    background: #30363d; padding: 3px 10px; border-radius: 12px;
    font-size: 12px; color: #c9d1d9;
  }

  .project-header {
    grid-template-columns: minmax(180px, 1.5fr) ${pf.map((key) => {
      const widths = {
        session_count: '55px', tokens: '60px', tokens_input: '60px', tokens_output: '60px',
        tokens_reasoning: '60px', tokens_cache_read: '65px', tokens_cache_write: '65px',
        cost: '72px', changes: '90px', additions: '65px', deletions: '65px',
        files_changed: '50px', last_used: '65px',
      };
      return widths[key] || '60px';
    }).join(" ")} auto auto;
  }

  /* Empty state */
  .empty-state {
    text-align: center; padding: 80px 20px; color: #8b949e;
  }
  .empty-state-icon { font-size: 48px; margin-bottom: 16px; }
  .empty-state-title { font-size: 20px; font-weight: 600; color: #c9d1d9; margin-bottom: 8px; }
  .empty-state-message { font-size: 14px; line-height: 1.6; max-width: 500px; margin: 0 auto; }

  /* DB path settings */
  .db-path-row { margin-top: 8px; }
  .db-path-status { margin-top: 8px; font-size: 12px; word-break: break-all; }
  .db-status-ok { color: #3fb950; }
  .db-status-error { color: #f85149; }

  /* Load More */
  .load-more-wrap {
    display: flex; justify-content: center; padding: 12px 0;
  }
  .load-more-btn {
    background: #21262d; color: #c9d1d9; border: 1px solid #30363d;
    border-radius: 6px; padding: 8px 24px; font-size: 13px;
    cursor: pointer; transition: all 0.2s;
  }
  .load-more-btn:hover { border-color: #58a6ff; color: #f0f6fc; }
  .load-more-btn:disabled { opacity: 0.5; cursor: default; border-color: #30363d; color: #484f58; }

  /* Pagination */
  .pagination {
    display: flex; justify-content: center; align-items: center; gap: 4px;
    margin-top: 20px; padding: 12px 0;
  }
  .page-btn {
    background: #21262d; color: #c9d1d9; border: 1px solid #30363d;
    border-radius: 6px; padding: 6px 12px; font-size: 13px;
    cursor: pointer; transition: all 0.2s; min-width: 36px; text-align: center;
  }
  .page-btn:hover { border-color: #58a6ff; color: #f0f6fc; }
  .page-btn.active { background: #58a6ff; color: #fff; border-color: #58a6ff; }
  .page-btn:disabled { opacity: 0.4; cursor: default; border-color: #30363d; color: #484f58; }
  .page-btn:disabled:hover { border-color: #30363d; color: #484f58; }
  .page-info { color: #8b949e; font-size: 13px; margin: 0 8px; }
  .page-ellipsis { color: #484f58; font-size: 13px; padding: 6px 4px; }

  /* Version badge & popup */
  .version-wrapper { position: relative; }
  .version-badge {
    background: #21262d; color: #8b949e; border: 1px solid #30363d;
    border-radius: 12px; padding: 4px 12px; font-size: 12px; cursor: pointer;
    transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px;
    user-select: none;
  }
  .version-badge:hover { border-color: #58a6ff; color: #c9d1d9; }
  .version-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #3fb950; display: none;
    animation: pulse-dot 2s infinite;
  }
  .version-dot.show { display: inline-block; }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .version-popup {
    display: none; position: absolute; top: calc(100% + 8px); right: 0;
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 16px; min-width: 340px; z-index: 1000;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  .version-popup.show { display: block; }
  .version-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 0; font-size: 13px;
  }
  .version-row .label { color: #8b949e; }
  .version-row .value { color: #c9d1d9; font-family: monospace; }
  .version-row .value.new-version { color: #3fb950; font-weight: 600; }
  .version-status {
    margin-top: 8px; padding: 8px 12px; border-radius: 6px; font-size: 12px; text-align: center;
  }
  .version-status.up-to-date { background: rgba(63,185,80,0.1); color: #3fb950; }
  .version-status.update-available { background: rgba(210,153,34,0.1); color: #d29922; }
  .version-divider { border: none; border-top: 1px solid #30363d; margin: 12px 0; }
  .version-cmd-row {
    display: flex; align-items: center; gap: 8px; margin-top: 4px;
  }
  .version-cmd {
    flex: 1; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    padding: 8px 10px; font-family: monospace; font-size: 12px; color: #c9d1d9;
    overflow-x: auto; white-space: nowrap;
  }
  .version-copy-btn, .version-update-btn {
    background: #21262d; color: #c9d1d9; border: 1px solid #30363d;
    border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer;
    transition: all 0.2s; white-space: nowrap;
  }
  .version-copy-btn:hover { border-color: #58a6ff; color: #f0f6fc; }
  .version-update-btn {
    background: #238636; border-color: #2ea043; color: #fff; margin-top: 8px;
    width: 100%; text-align: center;
  }
  .version-update-btn:hover { background: #2ea043; }
  .version-update-btn:disabled {
    opacity: 0.6; cursor: default; background: #21262d; border-color: #30363d; color: #8b949e;
  }
  .version-actions { display: none; }
  .version-actions.show { display: block; }

  /* Version dot colors */
  .version-dot.error {
    background: #f85149;
  }

  /* Auto-update toggle row */
  .auto-update-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 12px; padding-top: 12px; border-top: 1px solid #30363d;
  }
  .auto-update-label { font-size: 13px; color: #c9d1d9; }
  .auto-update-hint { font-size: 11px; color: #8b949e; margin-top: 2px; }
  .toggle-switch {
    position: relative; width: 40px; height: 22px; cursor: pointer; flex-shrink: 0;
  }
  .toggle-switch input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: #30363d; border-radius: 11px; transition: background 0.3s;
  }
  .toggle-slider::before {
    content: ""; position: absolute; width: 16px; height: 16px; left: 3px; bottom: 3px;
    background: #c9d1d9; border-radius: 50%; transition: transform 0.3s;
  }
  .toggle-switch input:checked + .toggle-slider { background: #238636; }
  .toggle-switch input:checked + .toggle-slider::before { transform: translateX(18px); }

  /* Auto-update failure banner in popup */
  .auto-update-fail-banner {
    display: none; background: rgba(248,81,73,0.1); color: #f85149;
    font-size: 12px; padding: 8px 12px; border-radius: 6px; margin-top: 8px;
    word-break: break-all;
  }
  .auto-update-fail-banner.show { display: block; }

  /* Startup auto-update notification banner */
  .auto-update-notify {
    display: none; position: fixed; top: 0; left: 0; right: 0; z-index: 2000;
    padding: 12px 24px; font-size: 14px; font-weight: 500;
    text-align: center; align-items: center; justify-content: center; gap: 12px;
    animation: slide-down 0.4s ease;
  }
  .auto-update-notify.show { display: flex; }
  .auto-update-notify.success {
    background: linear-gradient(135deg, rgba(35,134,54,0.95), rgba(46,160,67,0.95));
    color: #fff; border-bottom: 1px solid #2ea043;
  }
  .auto-update-notify.error {
    background: linear-gradient(135deg, rgba(218,54,51,0.95), rgba(248,81,73,0.95));
    color: #fff; border-bottom: 1px solid #f85149;
  }
  .auto-update-notify .notify-msg { flex: 1; }
  .auto-update-notify .notify-btn {
    background: rgba(255,255,255,0.2); color: #fff; border: 1px solid rgba(255,255,255,0.3);
    border-radius: 6px; padding: 4px 14px; font-size: 13px; cursor: pointer;
    transition: all 0.2s; white-space: nowrap;
  }
  .auto-update-notify .notify-btn:hover { background: rgba(255,255,255,0.3); }
  @keyframes slide-down {
    from { transform: translateY(-100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  /* Footer */
  .footer {
    border-top: 1px solid #30363d; padding: 20px 32px;
    display: flex; justify-content: center; align-items: center; gap: 20px;
    font-size: 13px; color: #484f58; margin-top: 40px;
  }
  .footer a {
    color: #8b949e; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
    transition: color 0.2s;
  }
  .footer a:hover { color: #58a6ff; }
  .footer .sep { color: #30363d; }

  /* Today Cost Detail Modal */
  .today-cost-stat { cursor: pointer; transition: all 0.2s; border-radius: 8px; padding: 8px 12px; margin: -8px -12px; position: relative; }
  .today-cost-stat:hover { background: rgba(88,166,255,0.08); }
  .today-cost-stat:hover .tip-icon { opacity: 1; }
  .tip-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 14px; height: 14px; margin-left: 4px;
    position: relative; top: -1px; vertical-align: text-bottom;
    opacity: 0.7; transition: opacity 0.2s;
  }
  .tip-icon svg { width: 14px; height: 14px; }
  .cost-detail-body { padding: 0; }
  .cost-detail-list { list-style: none; padding: 0; margin: 0; }
  .cost-detail-item {
    border-bottom: 1px solid #21262d; transition: background 0.15s;
  }
  .cost-detail-item:last-child { border-bottom: none; }
  .cost-detail-header {
    display: grid; grid-template-columns: 1fr auto auto auto;
    align-items: center; gap: 12px; padding: 14px 24px;
    cursor: pointer; transition: background 0.15s;
  }
  .cost-detail-header:hover { background: #1c2128; }
  .cost-detail-session-info { min-width: 0; }
  .cost-detail-title {
    font-size: 14px; font-weight: 600; color: #c9d1d9;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 320px;
  }
  .cost-detail-project {
    font-size: 12px; color: #8b949e; margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 320px;
  }
  .cost-detail-agent { }
  .cost-detail-model {
    font-size: 12px; color: #8b949e; max-width: 160px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cost-detail-cost {
    font-size: 14px; font-weight: 700; color: #f0f6fc;
    white-space: nowrap; min-width: 70px; text-align: right;
  }
  .cost-detail-expand {
    color: #484f58; font-size: 10px; transition: transform 0.2s;
    margin-left: 8px;
  }
  .cost-detail-item.expanded .cost-detail-expand { transform: rotate(90deg); }
  .cost-sub-agents {
    display: none; background: #0d1117; border-top: 1px solid #21262d;
  }
  .cost-detail-item.expanded .cost-sub-agents { display: block; }
  .cost-sub-agent-row {
    display: grid; grid-template-columns: 24px 1fr auto auto auto;
    align-items: center; gap: 12px; padding: 10px 24px 10px 32px;
    border-bottom: 1px solid rgba(33,38,45,0.5); font-size: 13px;
  }
  .cost-sub-agent-row:last-child { border-bottom: none; }
  .cost-sub-icon { color: #484f58; font-size: 10px; text-align: center; }
  .cost-sub-title {
    color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cost-sub-model {
    font-size: 12px; color: #6e7681; max-width: 140px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cost-sub-cost {
    font-size: 13px; font-weight: 600; color: #c9d1d9;
    white-space: nowrap; min-width: 70px; text-align: right;
  }
  .cost-detail-footer {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 24px; border-top: 1px solid #30363d;
    font-size: 14px; font-weight: 600; flex-shrink: 0;
  }
  .cost-detail-footer .label { color: #8b949e; }
  .cost-detail-footer .value { color: #f0f6fc; font-size: 18px; }
  .cost-detail-empty {
    text-align: center; padding: 40px 20px; color: #8b949e; font-size: 14px;
  }
  .cost-detail-loading {
    text-align: center; padding: 40px 20px; color: #8b949e; font-size: 14px;
  }
  .cost-detail-no-subs {
    padding: 10px 24px 10px 56px; color: #484f58; font-size: 12px;
    font-style: italic;
  }

  @media (max-width: 768px) {
    .project-header { display: flex !important; flex-direction: column; align-items: flex-start; gap: 12px; }
    .global-stats { gap: 16px; }
  }
</style>
</head>
<body>

<div class="auto-update-notify" id="autoUpdateNotify">
  <span class="notify-msg" id="autoUpdateNotifyMsg"></span>
  <button class="notify-btn" onclick="dismissAutoUpdateNotify()">${L.autoUpdateBannerDismiss}</button>
</div>

<div class="header">
  <h1>${L.title}</h1>
  <span class="subtitle">${L.subtitle}</span>
  <span class="current-terminal" id="current-terminal"></span>
  <button class="settings-btn" id="refreshBtn" onclick="refreshData()">${L.refresh}</button>
  <button class="toggle-hidden-btn" id="toggleHiddenBtn" onclick="toggleShowHidden()">${L.showHidden} (${hiddenDirs.length})</button>
  <button class="settings-btn" onclick="openSettings()">${L.settings}</button>
  <div class="version-wrapper">
    <span class="version-badge" onclick="toggleVersionPopup()" id="versionBadge">
      v${escapeHTML(pkgVersion || '')}
      <span class="version-dot" id="versionDot"></span>
    </span>
    <div class="version-popup" id="versionPopup">
      <div class="version-row">
        <span class="label">${L.versionCurrent}</span>
        <span class="value">${escapeHTML(pkgVersion || '')}</span>
      </div>
      <div class="version-row">
        <span class="label">${L.versionLatest}</span>
        <span class="value" id="latestVersion">${L.versionChecking}</span>
      </div>
      <div class="version-status" id="versionStatus"></div>
      <div class="version-actions" id="versionActions">
        <hr class="version-divider">
        <div class="version-cmd-row">
          <code class="version-cmd" id="versionCmd">npm install -g opencode-history@latest</code>
          <button class="version-copy-btn" onclick="copyVersionCmd()">${L.versionCopyCmd}</button>
        </div>
        <button class="version-update-btn" id="versionUpdateBtn" onclick="runUpdate()">${L.versionAutoUpdate}</button>
      </div>
      <div class="auto-update-fail-banner" id="autoUpdateFailBanner"></div>
      <div class="auto-update-row">
        <div>
          <div class="auto-update-label">${L.autoUpdateLabel}</div>
          <div class="auto-update-hint">${L.autoUpdateHint}</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="autoUpdateToggle" ${currentConfig.autoUpdate ? 'checked' : ''} onchange="toggleAutoUpdate(this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  </div>
</div>

<div class="global-stats">
  <div class="global-stat">
    <span class="value">${formatNumber(globalStats.total_sessions)}</span>
    <span class="label">${L.totalSessions}</span>
  </div>
  <div class="global-stat">
    <span class="value">${formatNumber(globalStats.tokens_input + globalStats.tokens_output + globalStats.tokens_reasoning)}</span>
    <span class="label">${L.totalTokens}</span>
  </div>
  <div class="global-stat today-cost-stat" onclick="openTodayCostDetail()" title="${L.todayCostDetailHint}">
    <span class="value">$${(globalStats.today_cost || 0).toFixed(2)}</span>
    <span class="label">${L.todayCost}<span class="tip-icon"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11ZM8 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 6Zm0-2a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg></span></span>
  </div>
  <div class="global-stat">
    <span class="value">$${(globalStats.cost || 0).toFixed(2)}</span>
    <span class="label">${L.totalCost}</span>
  </div>
  <div class="global-stat">
    <span class="value">${formatNumber(globalStats.tokens_cache_read)}</span>
    <span class="label">${L.cacheRead}</span>
  </div>
  <div class="global-stat">
    <span class="value additions">+${formatNumber(globalStats.additions)}</span>
    <span class="label">${L.linesAdded}</span>
  </div>
  <div class="global-stat">
    <span class="value deletions">-${formatNumber(globalStats.deletions)}</span>
    <span class="label">${L.linesDeleted}</span>
  </div>
  <div class="global-stat">
    <span class="value">${formatNumber(globalStats.files_changed)}</span>
    <span class="label">${L.filesChanged}</span>
  </div>
</div>

<div class="main">
  <div class="section-header">
    <div class="section-title">${L.projects} (${projectStats.length})</div>
    <div class="sort-controls">
      <span class="sort-label">${L.sort}</span>
      <button class="sort-btn active" data-sort="last_used" onclick="sortProjects('last_used')">${L.sortRecent}</button>
      <button class="sort-btn" data-sort="session_count" onclick="sortProjects('session_count')">${L.sortMostUsed}</button>
      <button class="sort-btn" data-sort="tokens" onclick="sortProjects('tokens')">${L.sortTokens}</button>
      <button class="sort-btn" data-sort="changes" onclick="sortProjects('changes')">${L.sortChanges}</button>
      <div class="time-filter">
        <span class="time-filter-label">${L.timeFilterLabel}</span>
        <input type="text" inputmode="numeric" pattern="[0-9]*" class="time-filter-input" id="timeFilterInput"
          value="${currentConfig.sessionTimeFilter || 0}"
          title="${L.timeFilterAll}">
        <span class="time-filter-label">${L.timeFilterDays}</span>
        <span class="time-filter-hint">(${L.timeFilterAll})</span>
      </div>
    </div>
  </div>
  <div id="projectList">
  ${!hasData ? `
  <div class="empty-state">
    <div class="empty-state-icon">&#128450;</div>
    <div class="empty-state-title">${L.dbNotFoundShort}</div>
    <div class="empty-state-message">${L.dbNotFound}</div>
    <button class="save-btn" onclick="openSettings()" style="margin-top:16px; width:auto; padding:10px 32px;">${L.settings}</button>
  </div>
  ` : projectCardsHTML}
  </div>
  <div class="pagination" id="pagination"></div>
</div>

<div class="toast" id="toast"></div>

<!-- Settings Modal -->
<div class="modal-overlay" id="settingsModal">
  <div class="modal">
    <div class="modal-header">
      <h2>${L.settingsTitle}</h2>
      <button class="modal-close" onclick="closeSettings()" aria-label="Close">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M3 3 L13 13 M13 3 L3 13"/>
        </svg>
      </button>
    </div>
    <div class="modal-body">
      <h3 class="settings-section-title">${L.dbPath}</h3>
      <div class="form-hint">${L.dbPathHint}</div>
      <div class="db-path-row">
        <input class="form-input" id="dbPathInput" placeholder="${escapeHTML(L.dbPathPlaceholderPrefix + (getDbCandidates()[0] || ""))}" value="${escapeHTML(currentConfig.dbPath || "")}" onkeydown="if(event.key==='Enter')saveDbPath()">
      </div>
      <div class="db-path-status" id="dbPathStatus">
        ${hasData
          ? `<span class="db-status-ok">${dbInfo.source === "configured" ? L.dbConfigured : L.dbAutoDetected}: ${escapeHTML(dbInfo.path)}</span>`
          : `<span class="db-status-error">${L.dbNotFoundShort}</span>`
        }
      </div>

      <h3 class="settings-section-title" style="margin-top:28px;">${L.language}</h3>
      <div class="lang-picker">
        <button class="lang-btn${currentConfig.language === "en" ? " active" : ""}" onclick="setLanguage('en')">English</button>
        <button class="lang-btn${currentConfig.language === "zh" ? " active" : ""}" onclick="setLanguage('zh')">\u4e2d\u6587</button>
      </div>

      <h3 class="settings-section-title" style="margin-top:28px;">${L.terminal}</h3>
      <div class="form-group">
        <label class="form-label">${L.quickSelect}</label>
        <div class="preset-list" id="presetList"></div>
      </div>

      <div class="or-divider">${L.orCustom}</div>

      <div class="form-group">
        <label class="form-label" for="termCommand">${L.command}</label>
        <div class="form-hint">${L.commandHint}</div>
        <input class="form-input" id="termCommand" placeholder="wt.exe">
      </div>

      <div class="form-group">
        <label class="form-label" for="termArgs">${L.arguments}</label>
        <div class="form-hint">${L.argsHint}</div>
        <input class="form-input" id="termArgs" placeholder="-d {dir} cmd /k opencode">
      </div>

      <h3 class="settings-section-title" style="margin-top:28px;">${L.projectCardFields}</h3>
      <div class="form-hint">${L.projectCardFieldsHint}</div>
      <div class="field-picker" id="projectFieldPicker"></div>

      <h3 class="settings-section-title" style="margin-top:28px;">${L.sessionTableColumns}</h3>
      <div class="form-hint">${L.sessionTableColumnsHint}</div>
      <div class="field-picker" id="sessionColumnPicker"></div>

      <button class="save-btn" style="margin-top:24px;" onclick="saveSettings()">${L.save}</button>
    </div>
  </div>
</div>

<!-- Today Cost Detail Modal -->
<div class="modal-overlay" id="todayCostModal">
  <div class="modal" style="width:680px;">
    <div class="modal-header">
      <h2>${L.todayCostDetail}</h2>
      <button class="modal-close" onclick="closeTodayCostDetail()" aria-label="Close">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M3 3 L13 13 M13 3 L3 13"/>
        </svg>
      </button>
    </div>
    <div class="modal-body cost-detail-body" id="todayCostBody">
      <div class="cost-detail-loading">${L.todayCostLoading}</div>
    </div>
    <div class="cost-detail-footer" id="todayCostFooter" style="display:none;">
      <span class="label">${L.todayCostTotal}</span>
      <span class="value" id="todayCostTotal">$0.00</span>
    </div>
  </div>
</div>

<script>
const presets = ${presetsJSON};
const config = ${configJSON};
const dbInfo = ${dbInfoJSON};
const FIELD_I18N = ${JSON.stringify(FIELD_LABEL_KEYS)};
const LANG = ${JSON.stringify(L)};
const ALL_PROJECT_FIELDS = ${JSON.stringify(PROJECT_FIELDS.map((f) => ({ key: f.key, label: L[FIELD_LABEL_KEYS[f.key]] || f.label, default: f.default })))};
const ALL_SESSION_COLUMNS = ${JSON.stringify(SESSION_COLUMNS.map((f) => ({ key: f.key, label: L[FIELD_LABEL_KEYS[f.key]] || f.label, default: f.default })))};

// Show current terminal in header
function updateCurrentTerminal() {
  const el = document.getElementById('current-terminal');
  const t = config.terminal;
  if (t && t.name) {
    el.textContent = t.name;
  } else if (t && t.command) {
    el.textContent = t.command;
  } else {
    el.textContent = LANG.notConfigured;
  }
}
updateCurrentTerminal();

function setLanguage(lang) {
  fetch('/api/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: lang })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) location.reload();
    else showToast(data.error || 'Error', true);
  })
  .catch(err => showToast('Error: ' + err.message, true));
}

// Time filter — only accept positive integers or 0; save on Enter or blur
(function initTimeFilter() {
  const input = document.getElementById('timeFilterInput');
  if (!input) return;
  let lastSaved = input.value;

  function sanitize(v) {
    // Strip anything that is not a digit
    const cleaned = v.replace(/[^0-9]/g, '');
    const n = parseInt(cleaned, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function applyFilter() {
    const val = sanitize(input.value);
    input.value = val;
    if (String(val) === lastSaved) return;
    lastSaved = String(val);
    fetch('/api/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionTimeFilter: val })
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        // Need to re-query data since the filter changes SQL results
        return fetch('/api/refresh').then(r => r.json());
      }
    })
    .then(() => location.reload())
    .catch(err => showToast('Error: ' + err.message, true));
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); applyFilter(); }
  });
  input.addEventListener('blur', applyFilter);

  // Prevent non-digit input
  input.addEventListener('input', function() {
    input.value = input.value.replace(/[^0-9]/g, '');
  });
})();

function saveDbPath() {
  const input = document.getElementById('dbPathInput');
  const newPath = input.value.trim();
  const statusEl = document.getElementById('dbPathStatus');
  statusEl.innerHTML = '<span style="color:#8b949e;">...</span>';
  fetch('/api/dbpath', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dbPath: newPath })
  })
  .then(r => r.json())
  .then(result => {
    if (result.ok) {
      showToast(LANG.dbPathSaved);
      setTimeout(() => location.reload(), 500);
    } else {
      statusEl.innerHTML = '<span class="db-status-error">' + (result.error || 'Error') + '</span>';
      showToast(result.error || 'Error', true);
    }
  })
  .catch(err => {
    statusEl.innerHTML = '<span class="db-status-error">Error</span>';
    showToast('Error: ' + err.message, true);
  });
}

function toggleProject(projectId) {
  const el = document.getElementById('sessions-' + projectId);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

function loadMoreSessions(btn, cardId) {
  const dir = btn.dataset.dir;
  const loaded = parseInt(btn.dataset.loaded, 10);
  const total = parseInt(btn.dataset.total, 10);
  const limit = ${SESSIONS_PER_PAGE};

  btn.disabled = true;
  btn.textContent = LANG.loadingMore;

  fetch('/api/sessions?dir=' + encodeURIComponent(dir) + '&offset=' + loaded + '&limit=' + limit)
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        const tbody = document.getElementById('tbody-' + cardId);
        tbody.insertAdjacentHTML('beforeend', data.html);
        const newLoaded = loaded + data.count;
        btn.dataset.loaded = newLoaded;
        if (newLoaded >= total || data.count < limit) {
          // No more sessions to load -- remove the button
          const wrap = document.getElementById('loadmore-' + cardId);
          if (wrap) wrap.remove();
        } else {
          btn.disabled = false;
          btn.textContent = LANG.loadMore + ' (' + newLoaded + '/' + total + ')';
        }
      } else {
        showToast(data.error || 'Failed', true);
        btn.disabled = false;
        btn.textContent = LANG.loadMore + ' (' + loaded + '/' + total + ')';
      }
    })
    .catch(err => {
      showToast('Error: ' + err.message, true);
      btn.disabled = false;
      btn.textContent = LANG.loadMore + ' (' + loaded + '/' + total + ')';
    });
}

function openProject(directory) {
  fetch('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory: directory })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      showToast(LANG.toastOpening + ' ' + (config.terminal && config.terminal.name || 'terminal') + ' ' + LANG.toastIn + ' ' + directory);
    } else {
      showToast(data.error || 'Failed to open terminal', true);
    }
  })
  .catch(err => showToast('Error: ' + err.message, true));
}

function openSession(directory, sessionId) {
  fetch('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory: directory, sessionId: sessionId })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      showToast(LANG.toastResuming + ' ' + directory);
    } else {
      showToast(data.error || 'Failed to open session', true);
    }
  })
  .catch(err => showToast('Error: ' + err.message, true));
}

function toggleHide(directory, isCurrentlyHidden) {
  const endpoint = isCurrentlyHidden ? '/api/unhide' : '/api/hide';
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory: directory })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      // Update DOM in-place instead of reloading to preserve pagination
      const nowHidden = !isCurrentlyHidden;
      const cards = document.querySelectorAll('.project-card');
      let card = null;
      for (const c of cards) {
        if (c.dataset.dir === directory) { card = c; break; }
      }
      if (card) {
        card.classList.toggle('hidden-card', nowHidden);
        const btn = card.querySelector('.hide-btn');
        if (btn) {
          btn.textContent = nowHidden ? LANG.show : LANG.hide;
          btn.title = nowHidden ? LANG.show : LANG.hide;
          btn.setAttribute('onclick', "event.stopPropagation(); toggleHide('" + directory.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'") + "', " + nowHidden + ")");
        }
      }
      applyPagination();
    } else {
      showToast(data.error || 'Failed', true);
    }
  })
  .catch(err => showToast('Error: ' + err.message, true));
}

// Pagination state
const PAGE_SIZE = 10;
let currentPage = 1;

function getVisibleCards() {
  const list = document.getElementById('projectList');
  const all = Array.from(list.querySelectorAll('.project-card'));
  const showHidden = document.body.classList.contains('show-hidden');
  return all.filter(c => showHidden || !c.classList.contains('hidden-card'));
}

function applyPagination() {
  const list = document.getElementById('projectList');
  const allCards = Array.from(list.querySelectorAll('.project-card'));
  const showHidden = document.body.classList.contains('show-hidden');
  const visible = allCards.filter(c => showHidden || !c.classList.contains('hidden-card'));
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;

  // Hide all, then show only current page
  allCards.forEach(c => c.style.display = 'none');
  visible.forEach((c, i) => {
    c.style.display = (i >= start && i < end) ? '' : 'none';
  });
  // Hidden cards not in visible set stay hidden
  if (showHidden) {
    allCards.filter(c => c.classList.contains('hidden-card')).forEach((c, i) => {
      // Already handled above via visible array
    });
  }

  renderPagination(visible.length, totalPages);
}

function renderPagination(total, totalPages) {
  const el = document.getElementById('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = '';
  html += '<button class="page-btn" onclick="goToPage(' + (currentPage - 1) + ')"' + (currentPage <= 1 ? ' disabled' : '') + '>' + LANG.prevPage + '</button>';

  // Show page numbers with ellipsis for large page counts
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }
  pages.forEach(p => {
    if (p === '...') {
      html += '<span class="page-ellipsis">...</span>';
    } else {
      html += '<button class="page-btn' + (p === currentPage ? ' active' : '') + '" onclick="goToPage(' + p + ')">' + p + '</button>';
    }
  });

  html += '<button class="page-btn" onclick="goToPage(' + (currentPage + 1) + ')"' + (currentPage >= totalPages ? ' disabled' : '') + '>' + LANG.nextPage + '</button>';
  el.innerHTML = html;
}

function goToPage(page) {
  const visible = getVisibleCards();
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  applyPagination();
  // Scroll to top of project list
  document.querySelector('.section-header').scrollIntoView({ behavior: 'smooth' });
}

function sortProjects(sortKey) {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sortKey);
  });

  const list = document.getElementById('projectList');
  const cards = Array.from(list.querySelectorAll('.project-card'));

  const attrMap = {
    last_used: 'lastUsed',
    session_count: 'sessions',
    tokens: 'tokens',
    changes: 'changes',
  };
  const attr = attrMap[sortKey] || 'lastUsed';

  cards.sort((a, b) => Number(b.dataset[attr]) - Number(a.dataset[attr]));
  cards.forEach(card => list.appendChild(card));
  currentPage = 1;
  applyPagination();
}

function refreshData() {
  const btn = document.getElementById('refreshBtn');
  btn.textContent = LANG.refreshing;
  btn.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  fetch('/api/refresh', { signal: controller.signal })
    .then(r => {
      clearTimeout(timeout);
      if (!r.ok) {
        return r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
      }
      return r.json();
    })
    .then(data => {
      if (data.ok) {
        location.reload();
      } else {
        showToast(data.error || 'Failed', true);
        btn.textContent = LANG.refresh;
        btn.disabled = false;
      }
    })
    .catch(err => {
      clearTimeout(timeout);
      const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
      showToast('Error: ' + msg, true);
      btn.textContent = LANG.refresh;
      btn.disabled = false;
    });
}

function toggleShowHidden() {
  document.body.classList.toggle('show-hidden');
  const btn = document.getElementById('toggleHiddenBtn');
  btn.classList.toggle('active');
  currentPage = 1;
  applyPagination();
}

function showToast(message, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, 3000);
}

// Settings modal
let selectedPresetIdx = -1;

function openSettings() {
  const modal = document.getElementById('settingsModal');
  modal.classList.add('open');

  // Populate presets
  const list = document.getElementById('presetList');
  list.innerHTML = presets.map((p, i) => {
    const isActive = config.terminal && config.terminal.command === p.command && config.terminal.args === p.args;
    if (isActive) selectedPresetIdx = i;
    return '<div class="preset-item' + (isActive ? ' active' : '') + '" onclick="selectPreset(' + i + ')">'
      + '<div><div class="preset-name">' + p.name + '</div>'
      + '<div class="preset-cmd">' + p.command + ' ' + p.args + '</div></div></div>';
  }).join('');

  // Populate custom fields
  document.getElementById('termCommand').value = config.terminal ? config.terminal.command : '';
  document.getElementById('termArgs').value = config.terminal ? config.terminal.args : '';

  // Populate field pickers
  renderFieldPicker('projectFieldPicker', ALL_PROJECT_FIELDS, config.projectFields || []);
  renderFieldPicker('sessionColumnPicker', ALL_SESSION_COLUMNS, config.sessionColumns || []);

  // Close on overlay click
  modal.onclick = (e) => { if (e.target === modal) closeSettings(); };
}

function renderFieldPicker(containerId, allFields, activeKeys) {
  const container = document.getElementById(containerId);
  container.innerHTML = allFields.map(f => {
    const isActive = activeKeys.includes(f.key);
    return '<label class="field-chip' + (isActive ? ' active' : '') + '" data-key="' + f.key + '">'
      + '<input type="checkbox"' + (isActive ? ' checked' : '') + ' onchange="toggleFieldChip(this)">'
      + f.label + '</label>';
  }).join('');
}

function toggleFieldChip(checkbox) {
  const chip = checkbox.closest('.field-chip');
  chip.classList.toggle('active', checkbox.checked);
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function selectPreset(idx) {
  selectedPresetIdx = idx;
  const items = document.querySelectorAll('.preset-item');
  items.forEach((el, i) => el.classList.toggle('active', i === idx));
  document.getElementById('termCommand').value = presets[idx].command;
  document.getElementById('termArgs').value = presets[idx].args;
}

function getPickerSelection(containerId) {
  const chips = document.querySelectorAll('#' + containerId + ' .field-chip');
  const selected = [];
  chips.forEach(chip => {
    if (chip.querySelector('input').checked) selected.push(chip.dataset.key);
  });
  return selected;
}

function saveSettings() {
  const command = document.getElementById('termCommand').value.trim();
  const args = document.getElementById('termArgs').value.trim();
  if (!command) { showToast(LANG.commandRequired, true); return; }

  const name = selectedPresetIdx >= 0
    && presets[selectedPresetIdx].command === command
    && presets[selectedPresetIdx].args === args
    ? presets[selectedPresetIdx].name
    : 'Custom';

  const terminal = { name, command, args };
  const projectFields = getPickerSelection('projectFieldPicker');
  const sessionColumns = getPickerSelection('sessionColumnPicker');

  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal, projectFields, sessionColumns })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      config.terminal = terminal;
      config.projectFields = projectFields;
      config.sessionColumns = sessionColumns;
      updateCurrentTerminal();
      closeSettings();
      showToast(LANG.toastSaved);
      location.reload();
    } else {
      showToast(data.error || 'Save failed', true);
    }
  })
  .catch(err => showToast('Error: ' + err.message, true));
}
// ---------------------------------------------------------------------------
// Version popup
// ---------------------------------------------------------------------------
const CURRENT_VERSION = ${JSON.stringify(pkgVersion || '')};

function toggleVersionPopup() {
  const popup = document.getElementById('versionPopup');
  const isOpen = popup.classList.contains('show');
  popup.classList.toggle('show');
  if (!isOpen) checkLatestVersion();
}

// Close popup when clicking outside
document.addEventListener('click', function(e) {
  const wrapper = document.querySelector('.version-wrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    document.getElementById('versionPopup').classList.remove('show');
  }
});

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

function checkLatestVersion() {
  const el = document.getElementById('latestVersion');
  const statusEl = document.getElementById('versionStatus');
  const actionsEl = document.getElementById('versionActions');
  const dotEl = document.getElementById('versionDot');

  el.textContent = LANG.versionChecking;
  el.className = 'value';
  statusEl.textContent = '';
  statusEl.className = 'version-status';

  const bannerEl = document.getElementById('autoUpdateFailBanner');
  const toggleEl = document.getElementById('autoUpdateToggle');

  fetch('/api/version')
    .then(r => r.json())
    .then(data => {
      // Sync auto-update toggle state
      if (toggleEl) toggleEl.checked = !!data.autoUpdate;

      // Handle auto-update failure from startup
      if (data.autoUpdateResult && !data.autoUpdateResult.ok) {
        bannerEl.textContent = LANG.autoUpdateFailedTip + ' ' + (data.autoUpdateResult.error || '');
        bannerEl.classList.add('show');
        dotEl.classList.add('show', 'error');
      }

      if (!data.latest) {
        el.textContent = LANG.versionCheckFailed;
        statusEl.textContent = '';
        return;
      }
      el.textContent = data.latest;
      if (compareVersions(CURRENT_VERSION, data.latest) < 0) {
        // Update available
        el.classList.add('new-version');
        statusEl.textContent = LANG.versionUpdateAvailable;
        statusEl.className = 'version-status update-available';
        actionsEl.classList.add('show');
        dotEl.classList.add('show');
        if (!dotEl.classList.contains('error')) dotEl.classList.remove('error');
      } else {
        statusEl.textContent = LANG.versionUpToDate;
        statusEl.className = 'version-status up-to-date';
        actionsEl.classList.remove('show');
        if (!dotEl.classList.contains('error')) {
          dotEl.classList.remove('show');
        }

        // Auto-update succeeded on startup
        if (data.autoUpdateResult && data.autoUpdateResult.ok) {
          statusEl.textContent = LANG.versionUpdateSuccess;
          statusEl.className = 'version-status up-to-date';
          dotEl.classList.add('show');
          dotEl.classList.remove('error');
        }
      }
    })
    .catch(() => {
      el.textContent = LANG.versionCheckFailed;
    });
}

function copyVersionCmd() {
  const cmd = document.getElementById('versionCmd').textContent;
  navigator.clipboard.writeText(cmd).then(() => {
    showToast(LANG.versionCopied);
  }).catch(() => {
    // Fallback: select text
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('versionCmd'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

function runUpdate() {
  const btn = document.getElementById('versionUpdateBtn');
  btn.disabled = true;
  btn.textContent = LANG.versionUpdating;

  fetch('/api/update', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        btn.textContent = LANG.versionUpdateSuccess;
        showToast(LANG.versionUpdateSuccess);
      } else {
        btn.textContent = LANG.versionUpdateFailed + ': ' + (data.error || '');
        btn.disabled = false;
        showToast(LANG.versionUpdateFailed, true);
      }
    })
    .catch(err => {
      btn.textContent = LANG.versionUpdateFailed;
      btn.disabled = false;
      showToast(LANG.versionUpdateFailed + ': ' + err.message, true);
    });
}

function toggleAutoUpdate(enabled) {
  fetch('/api/auto-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      showToast(LANG.toastSaved);
    }
  })
  .catch(err => showToast('Error: ' + err.message, true));
}

// Check for auto-update result on page load and show notification banner.
// The update runs in the background after server starts, so it may not be
// ready when the page first loads. Poll a few times if autoUpdate is on but
// result is not yet available.
function checkAutoUpdateNotify(retries) {
  if (retries === undefined) retries = 10;
  fetch('/api/version')
    .then(r => r.json())
    .then(data => {
      if (!data.autoUpdateResult) {
        // Auto-update enabled but still running — retry
        if (data.autoUpdate && retries > 0) {
          setTimeout(() => checkAutoUpdateNotify(retries - 1), 3000);
        }
        return;
      }
      const banner = document.getElementById('autoUpdateNotify');
      const msgEl = document.getElementById('autoUpdateNotifyMsg');
      if (data.autoUpdateResult.ok) {
        const msg = LANG.autoUpdateSuccessBanner
          .replace('{from}', data.autoUpdateResult.from || '?')
          .replace('{to}', data.autoUpdateResult.to || '?');
        msgEl.textContent = msg;
        banner.classList.add('show', 'success');
      } else {
        msgEl.textContent = LANG.autoUpdateFailedBanner + ' ' + (data.autoUpdateResult.error || '');
        banner.classList.add('show', 'error');
      }
    })
    .catch(() => { /* silent */ });
}
function dismissAutoUpdateNotify() {
  const banner = document.getElementById('autoUpdateNotify');
  banner.classList.remove('show');
}
checkAutoUpdateNotify();

// ---------------------------------------------------------------------------
// Today Cost Detail Modal
// ---------------------------------------------------------------------------
function openTodayCostDetail() {
  const modal = document.getElementById('todayCostModal');
  const body = document.getElementById('todayCostBody');
  const footer = document.getElementById('todayCostFooter');
  modal.classList.add('open');
  body.innerHTML = '<div class="cost-detail-loading">' + LANG.todayCostLoading + '</div>';
  footer.style.display = 'none';
  modal.onclick = (e) => { if (e.target === modal) closeTodayCostDetail(); };

  fetch('/api/today-cost-detail')
    .then(r => r.json())
    .then(data => {
      if (!data.ok || !data.sessions || data.sessions.length === 0) {
        body.innerHTML = '<div class="cost-detail-empty">' + LANG.todayCostNoData + '</div>';
        return;
      }
      renderTodayCostDetail(data.sessions, data.totalCost);
    })
    .catch(err => {
      body.innerHTML = '<div class="cost-detail-empty" style="color:#f85149;">Error: ' + err.message + '</div>';
    });
}

function closeTodayCostDetail() {
  document.getElementById('todayCostModal').classList.remove('open');
}

function escapeH(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseModelName(model) {
  if (!model) return '';
  try { return JSON.parse(model).id || model; } catch { return model; }
}

function renderTodayCostDetail(sessions, totalCost) {
  const body = document.getElementById('todayCostBody');
  const footer = document.getElementById('todayCostFooter');
  const totalEl = document.getElementById('todayCostTotal');

  let html = '<ul class="cost-detail-list">';
  sessions.forEach((s, i) => {
    const title = s.title || LANG.untitled;
    const project = s.directory ? s.directory.replace(/\\\\/g, '/').split('/').pop() : '-';
    const model = parseModelName(s.model);
    const agent = s.agent || 'default';
    const hasSubs = s.subAgents && s.subAgents.length > 0;
    const expandIcon = hasSubs ? '<span class="cost-detail-expand">&#9654;</span>' : '';

    html += '<li class="cost-detail-item" id="cost-item-' + i + '">';
    html += '<div class="cost-detail-header" onclick="toggleCostItem(' + i + ')">';
    html += '<div class="cost-detail-session-info">';
    html += '<div class="cost-detail-title">' + escapeH(title) + '</div>';
    html += '<div class="cost-detail-project">' + escapeH(project) + '</div>';
    html += '</div>';
    html += '<span class="agent-badge agent-' + escapeH(agent) + '">' + escapeH(agent) + '</span>';
    html += '<span class="cost-detail-model">' + escapeH(model) + '</span>';
    html += '<span class="cost-detail-cost">$' + s.cost.toFixed(4) + expandIcon + '</span>';
    html += '</div>';

    // Sub-agents section
    if (hasSubs) {
      html += '<div class="cost-sub-agents">';
      s.subAgents.forEach(sub => {
        const subModel = parseModelName(sub.model);
        const subAgent = sub.agent || 'default';
        const subTitle = sub.title || LANG.untitled;
        html += '<div class="cost-sub-agent-row">';
        html += '<span class="cost-sub-icon">&#8627;</span>';
        html += '<span class="cost-sub-title" title="' + escapeH(subTitle) + '">' + escapeH(subTitle) + '</span>';
        html += '<span class="agent-badge agent-' + escapeH(subAgent) + '">' + escapeH(subAgent) + '</span>';
        html += '<span class="cost-sub-model">' + escapeH(subModel) + '</span>';
        html += '<span class="cost-sub-cost">$' + sub.cost.toFixed(4) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</li>';
  });
  html += '</ul>';

  body.innerHTML = html;
  totalEl.textContent = '$' + totalCost.toFixed(2);
  footer.style.display = 'flex';
}

function toggleCostItem(idx) {
  const item = document.getElementById('cost-item-' + idx);
  if (item) item.classList.toggle('expanded');
}

// Init pagination on load
applyPagination();
</script>

<footer class="footer">
  <a href="https://github.com/felix-lj-ct/opencode-history" target="_blank" rel="noopener">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
    GitHub
  </a>
  <span class="sep">|</span>
  <a href="https://www.npmjs.com/package/opencode-history" target="_blank" rel="noopener">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 0v16h16V0H0zm13 13H8v-2H5v2H3V3h10v10z"/><path d="M5 5h3v4h2V5h1v6H5z" fill="#0d1117"/></svg>
    npm
  </a>
</footer>

</body>
</html>`;
}

module.exports = { buildHTML };
