#!/usr/bin/env node

"use strict";

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const { exec } = require("node:child_process");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Package version (read once at startup)
// ---------------------------------------------------------------------------
// npm package name (used for version checks and auto-update commands).
// The previous package @felixli-ct/opencode-dashboard has been deprecated.
const PKG_NAME = "opencode-history";
const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")
).version;

const { PORT, HOST, SESSIONS_PER_PAGE, getConfig, setConfig, saveConfig, getLang } = require("./lib/config");
const { findDatabase } = require("./lib/db-locator");
const { loadData, queryMoreSessions, queryTodayCostDetail, closeDb } = require("./lib/query");
const { openTerminal } = require("./lib/terminal");
const { buildHTML } = require("./lib/template");
const { openBrowser, killPort } = require("./lib/browser");

// ---------------------------------------------------------------------------
// Helper: fetch latest version from npm registry
// ---------------------------------------------------------------------------
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    const url = `https://registry.npmjs.org/${PKG_NAME}/latest`;
    const npmReq = https.get(url, { timeout: 5000 }, (resp) => {
      let body = "";
      resp.on("data", (chunk) => (body += chunk));
      resp.on("end", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(body).version || null); }
        catch { resolve(null); }
      });
    });
    npmReq.on("error", () => { clearTimeout(timer); resolve(null); });
    npmReq.on("timeout", () => { clearTimeout(timer); npmReq.destroy(); resolve(null); });
  });
}

// ---------------------------------------------------------------------------
// Helper: compare semver strings, returns -1, 0, or 1
// ---------------------------------------------------------------------------
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Helper: run npm install -g to update
// ---------------------------------------------------------------------------
function runNpmUpdate() {
  return new Promise((resolve, reject) => {
    exec(`npm install -g ${PKG_NAME}@latest`, {
      timeout: 120000,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

// Startup auto-update result (null = not attempted, object = result)
let autoUpdateResult = null;

// ---------------------------------------------------------------------------
// Empty data structure when DB is not available
// ---------------------------------------------------------------------------
function emptyData() {
  return {
    globalStats: {
      total_sessions: 0, tokens_input: 0, tokens_output: 0, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0, today_cost: 0, cost: 0,
      additions: 0, deletions: 0, files_changed: 0,
    },
    projectStats: [],
    sessionsByDir: {},
  };
}

// ---------------------------------------------------------------------------
// Helper: read JSON body from a request
// ---------------------------------------------------------------------------
const MAX_BODY_SIZE = 64 * 1024; // 64 KB
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const currentConfig = getConfig();
  let dbResult = findDatabase();
  let dbPath = dbResult.path;
  console.log("Terminal:", currentConfig.terminal?.name || currentConfig.terminal?.command || "not configured");

  let data;
  if (dbPath) {
    console.log("Found database:", dbPath, `(${dbResult.source})`);
    console.log("Loading data...");
    data = loadData(dbPath);
    console.log(`Loaded ${data.projectStats.length} projects, ${data.globalStats.total_sessions} sessions`);
  } else {
    console.log("No database found. Starting with empty data.");
    console.log("Users can configure the database path in Settings.");
    data = emptyData();
  }

  let html = buildHTML(data, dbResult, PKG_VERSION);

  // -----------------------------------------------------------------------
  // HTTP server & API routes
  // -----------------------------------------------------------------------
  const server = http.createServer(async (req, res) => {
    try {
      // GET / — serve dashboard HTML
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      // GET /api/data — raw JSON data
      if (req.method === "GET" && req.url === "/api/data") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
        return;
      }

      // GET /api/sessions?dir=<directory>&offset=<n>&limit=<n>
      if (req.method === "GET" && req.url.startsWith("/api/sessions")) {
        const params = new URL(req.url, `http://${HOST}`).searchParams;
        const dir = params.get("dir");
        const offset = parseInt(params.get("offset") || "0", 10);
        const limit = Math.min(parseInt(params.get("limit") || String(SESSIONS_PER_PAGE), 10), 100);

        if (!dir) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "dir parameter is required" }));
          return;
        }
        if (!dbPath) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Database not available" }));
          return;
        }

        const result = queryMoreSessions(dbPath, dir, offset, limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, html: result.rowsHTML, count: result.count }));
        return;
      }

      // POST /api/open — open terminal in project directory
      if (req.method === "POST" && req.url === "/api/open") {
        const { directory, sessionId } = await readBody(req);
        if (!directory || !fs.existsSync(directory)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Directory not found: " + directory }));
          return;
        }
        const result = openTerminal(directory, sessionId);
        res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/config — save terminal + field config
      if (req.method === "POST" && req.url === "/api/config") {
        const { terminal, projectFields, sessionColumns, language } = await readBody(req);
        if (!terminal || !terminal.command) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "terminal.command is required" }));
          return;
        }
        const cfg = getConfig();
        cfg.terminal = terminal;
        if (projectFields) cfg.projectFields = projectFields;
        if (sessionColumns) cfg.sessionColumns = sessionColumns;
        if (language) cfg.language = language;
        setConfig(cfg);
        saveConfig(cfg);
        html = buildHTML(data, dbResult, PKG_VERSION);
        console.log("Config saved:", terminal.name, "| fields:", (projectFields||[]).length, "| columns:", (sessionColumns||[]).length);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // POST /api/dbpath — save database path and reload data
      if (req.method === "POST" && req.url === "/api/dbpath") {
        const { dbPath: newDbPath } = await readBody(req);
        const trimmed = (newDbPath || "").trim();
        const cfg = getConfig();

        if (trimmed) {
          if (!fs.existsSync(trimmed)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: getLang().dbPathInvalid }));
            return;
          }
          cfg.dbPath = trimmed;
        } else {
          delete cfg.dbPath;
        }
        setConfig(cfg);
        saveConfig(cfg);

        // Re-detect and reload
        dbResult = findDatabase();
        dbPath = dbResult.path;
        if (dbPath) {
          data = loadData(dbPath);
        } else {
          data = emptyData();
        }
        html = buildHTML(data, dbResult, PKG_VERSION);
        console.log("DB path updated:", dbPath || "(not found)", `(${dbResult.source || "none"})`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, dbPath: dbPath || null, source: dbResult.source }));
        return;
      }

      // POST /api/set — save any config fields immediately
      if (req.method === "POST" && req.url === "/api/set") {
        const fields = await readBody(req);
        const cfg = getConfig();
        Object.assign(cfg, fields);
        setConfig(cfg);
        saveConfig(cfg);
        html = buildHTML(data, dbResult, PKG_VERSION);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // POST /api/hide — hide a directory
      if (req.method === "POST" && req.url === "/api/hide") {
        const { directory } = await readBody(req);
        const cfg = getConfig();
        if (!cfg.hiddenDirs) cfg.hiddenDirs = [];
        if (!cfg.hiddenDirs.includes(directory)) {
          cfg.hiddenDirs.push(directory);
          setConfig(cfg);
          saveConfig(cfg);
          html = buildHTML(data, dbResult, PKG_VERSION);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, hiddenDirs: cfg.hiddenDirs }));
        return;
      }

      // POST /api/unhide — unhide a directory
      if (req.method === "POST" && req.url === "/api/unhide") {
        const { directory } = await readBody(req);
        const cfg = getConfig();
        if (cfg.hiddenDirs) {
          cfg.hiddenDirs = cfg.hiddenDirs.filter((d) => d !== directory);
          setConfig(cfg);
          saveConfig(cfg);
          html = buildHTML(data, dbResult, PKG_VERSION);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, hiddenDirs: cfg.hiddenDirs }));
        return;
      }

      // GET /api/today-cost-detail — today's cost breakdown by session + sub-agents
      if (req.method === "GET" && req.url === "/api/today-cost-detail") {
        if (!dbPath) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Database not available" }));
          return;
        }
        const detail = queryTodayCostDetail(dbPath);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...detail }));
        return;
      }

      // GET /api/refresh — reload data from DB
      if (req.method === "GET" && req.url === "/api/refresh") {
        if (!dbPath) {
          dbResult = findDatabase();
          dbPath = dbResult.path;
        }
        if (!dbPath) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: getLang().dbNotFoundShort }));
          return;
        }
        // Verify the database file still exists and is readable before loading
        if (!fs.existsSync(dbPath)) {
          console.error("Refresh: database file no longer exists:", dbPath);
          dbPath = null;
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: getLang().dbNotFoundShort }));
          return;
        }
        try {
          data = loadData(dbPath);
          html = buildHTML(data, dbResult, PKG_VERSION);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (refreshErr) {
          console.error("Refresh error:", refreshErr);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: refreshErr.message || "Failed to reload data" }));
        }
        return;
      }

      // GET /api/version — current version + latest from npm registry + auto-update result
      if (req.method === "GET" && req.url === "/api/version") {
        const latest = await fetchLatestVersion();
        const resp = { ok: true, current: PKG_VERSION, latest, autoUpdate: getConfig().autoUpdate || false };
        if (autoUpdateResult) resp.autoUpdateResult = autoUpdateResult;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resp));
        return;
      }

      // POST /api/update — run npm install -g to update to latest
      if (req.method === "POST" && req.url === "/api/update") {
        try {
          const result = await runNpmUpdate();
          console.log("Update result:", result);
          autoUpdateResult = { ok: true, from: PKG_VERSION, to: "latest" };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, output: result }));
        } catch (updateErr) {
          console.error("Update failed:", updateErr.message);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: updateErr.message }));
        }
        return;
      }

      // POST /api/auto-update — toggle auto-update setting
      if (req.method === "POST" && req.url === "/api/auto-update") {
        const { enabled } = await readBody(req);
        const cfg = getConfig();
        cfg.autoUpdate = !!enabled;
        setConfig(cfg);
        saveConfig(cfg);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, autoUpdate: cfg.autoUpdate }));
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");

    } catch (err) {
      console.error("Request error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });

  // -----------------------------------------------------------------------
  // Error handling & port recovery
  // -----------------------------------------------------------------------
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${PORT} in use, attempting to take over...`);
      const probe = http.get(`http://${HOST}:${PORT}/`, (res) => {
        res.resume();
        killPort(PORT).then(() => {
          setTimeout(() => server.listen(PORT, HOST), 500);
        });
      });
      probe.on("error", () => {
        killPort(PORT).then(() => {
          setTimeout(() => server.listen(PORT, HOST), 1000);
        });
      });
      probe.setTimeout(2000, () => { probe.destroy(); });
    } else {
      console.error("Server error:", err);
      process.exit(1);
    }
  });

  // -----------------------------------------------------------------------
  // Start server
  // -----------------------------------------------------------------------
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`Dashboard running at ${url}`);
    console.log("Press Ctrl+C to stop");
    openBrowser(url);

    // Background auto-update (non-blocking, after server is already up)
    if (currentConfig.autoUpdate) {
      (async () => {
        console.log("Auto-update enabled, checking for updates...");
        try {
          const latest = await fetchLatestVersion();
          if (latest && compareVersions(PKG_VERSION, latest) < 0) {
            console.log(`New version available: ${PKG_VERSION} -> ${latest}, updating...`);
            try {
              const output = await runNpmUpdate();
              console.log("Auto-update succeeded:", output.trim());
              autoUpdateResult = { ok: true, from: PKG_VERSION, to: latest };
            } catch (updateErr) {
              console.warn("Auto-update failed:", updateErr.message);
              autoUpdateResult = { ok: false, error: updateErr.message };
            }
          } else if (latest) {
            console.log(`Already up to date (${PKG_VERSION})`);
          } else {
            console.log("Could not check for updates (network issue), skipping.");
          }
        } catch (e) {
          console.warn("Auto-update check error:", e.message);
        }
      })();
    }
  });
}

// Clean up persistent DB connection on exit
process.on("exit", () => closeDb());
process.on("SIGINT", () => { closeDb(); process.exit(0); });
process.on("SIGTERM", () => { closeDb(); process.exit(0); });

// Prevent unexpected errors from crashing the server
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server still running):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (server still running):", reason);
});

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
