"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PORT = 19860;
const HOST = "127.0.0.1";
const SESSIONS_PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Config directory & path
// ---------------------------------------------------------------------------
const CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME || (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support")
    : path.join(os.homedir(), ".config")),
  "opencode-history"
);
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

// ---------------------------------------------------------------------------
// Terminal presets (per-platform)
// ---------------------------------------------------------------------------
const DEFAULT_PRESETS = {
  win32: [
    { name: "Windows Terminal (fish)", command: "wt.exe", args: "-w 0 new-tab -p fish -d {dir} -- fish -C opencode" },
    { name: "Windows Terminal (PowerShell)", command: "wt.exe", args: "-w 0 new-tab -p PowerShell -d {dir} -- pwsh -NoExit -Command opencode" },
    { name: "Windows Terminal (CMD)", command: "wt.exe", args: "-w 0 new-tab -d {dir} cmd /k opencode" },
    { name: "PowerShell", command: "pwsh.exe", args: "-NoExit -Command cd '{dir}'; opencode" },
    { name: "CMD", command: "cmd.exe", args: "/k cd /d {dir} && opencode" },
  ],
  darwin: [
    { name: "Terminal.app", command: "osascript", args: "-e 'tell application \"Terminal\" to do script \"cd {dir} && opencode\"'" },
    { name: "iTerm2", command: "osascript", args: "-e 'tell application \"iTerm\" to create window with default profile command \"cd {dir} && opencode\"'" },
    { name: "WezTerm", command: "wezterm", args: "start --cwd {dir} -- opencode" },
  ],
  linux: [
    { name: "Default Terminal", command: "x-terminal-emulator", args: "-e bash -c 'cd {dir} && opencode; exec bash'" },
    { name: "GNOME Terminal", command: "gnome-terminal", args: "-- bash -c 'cd {dir} && opencode; exec bash'" },
    { name: "Konsole", command: "konsole", args: "-e bash -c 'cd {dir} && opencode; exec bash'" },
    { name: "WezTerm", command: "wezterm", args: "start --cwd {dir} -- opencode" },
  ],
};

// ---------------------------------------------------------------------------
// Field definitions for project cards and session tables
// ---------------------------------------------------------------------------
const PROJECT_FIELDS = [
  { key: "session_count", label: "Sessions", default: true },
  { key: "tokens",        label: "Tokens (in+out)", default: true },
  { key: "tokens_input",  label: "Input Tokens", default: false },
  { key: "tokens_output", label: "Output Tokens", default: false },
  { key: "tokens_reasoning", label: "Reasoning Tokens", default: false },
  { key: "tokens_cache_read", label: "Cache Read", default: false },
  { key: "tokens_cache_write", label: "Cache Write", default: false },
  { key: "cost",          label: "Cost ($)", default: false },
  { key: "changes",       label: "Line Changes (+/-)", default: true },
  { key: "additions",     label: "Lines Added", default: false },
  { key: "deletions",     label: "Lines Deleted", default: false },
  { key: "files_changed", label: "Files Changed", default: false },
  { key: "last_used",     label: "Last Used", default: true },
];

const SESSION_COLUMNS = [
  { key: "title",           label: "Title", default: true },
  { key: "agent",           label: "Agent", default: true },
  { key: "model",           label: "Model", default: true },
  { key: "time_updated",    label: "Time", default: true },
  { key: "tokens",          label: "Tokens (in+out)", default: true },
  { key: "tokens_input",    label: "Input Tokens", default: false },
  { key: "tokens_output",   label: "Output Tokens", default: false },
  { key: "tokens_reasoning",label: "Reasoning Tokens", default: false },
  { key: "cost",            label: "Cost ($)", default: false },
  { key: "changes",         label: "Line Changes (+/-)", default: true },
  { key: "additions",       label: "Lines Added", default: false },
  { key: "deletions",       label: "Lines Deleted", default: false },
  { key: "files_changed",   label: "Files Changed", default: false },
  { key: "time_created",    label: "Created", default: false },
  { key: "version",         label: "OC Version", default: false },
];

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
const I18N = {
  en: {
    // Header
    title: "OpenCode Dashboard",
    subtitle: "Local session history viewer",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    settings: "Settings",
    showHidden: "Show hidden",
    // Global stats
    totalSessions: "Total Sessions",
    totalTokens: "Total Tokens",
    todayCost: "Today Cost",
    totalCost: "Total Cost",
    cacheRead: "Cache Read",
    linesAdded: "Lines Added",
    linesDeleted: "Lines Deleted",
    filesChanged: "Files Changed",
    // Sort & Filter
    sort: "Sort:",
    sortRecent: "Recent",
    sortMostUsed: "Most Used",
    sortTokens: "Tokens",
    sortChanges: "Changes",
    timeFilterLabel: "Show recent",
    timeFilterDays: "days",
    timeFilterAll: "0 = show all",
    // Project card
    projects: "Projects",
    open: "Open",
    hide: "Hide",
    show: "Show",
    // Session table
    resume: "Resume",
    untitled: "Untitled",
    // Settings modal
    settingsTitle: "Settings",
    language: "Language",
    terminal: "Terminal",
    quickSelect: "Quick Select",
    orCustom: "or custom",
    command: "Command",
    commandHint: "The terminal executable (e.g. wt.exe, pwsh.exe, alacritty.exe)",
    arguments: "Arguments",
    argsHint: "Use {dir} as placeholder for the project directory",
    projectCardFields: "Project Card Fields",
    projectCardFieldsHint: "Choose which stats to show on each project card",
    sessionTableColumns: "Session Table Columns",
    sessionTableColumnsHint: "Choose which columns to show in the session list",
    save: "Save",
    // Field labels
    f_sessions: "Sessions", f_tokens: "Tokens (in+out)", f_input: "Input Tokens",
    f_output: "Output Tokens", f_reasoning: "Reasoning Tokens", f_cacheRead: "Cache Read",
    f_cacheWrite: "Cache Write", f_cost: "Cost ($)", f_changes: "Line Changes (+/-)",
    f_added: "Lines Added", f_deleted: "Lines Deleted", f_files: "Files Changed",
    f_lastUsed: "Last Used", f_title: "Title", f_agent: "Agent", f_model: "Model",
    f_time: "Time", f_created: "Created", f_version: "OC Version",
    // Stat labels (short)
    s_sessions: "sessions", s_tokens: "tokens", s_input: "input", s_output: "output",
    s_reasoning: "reasoning", s_cacheRead: "cache read", s_cacheWrite: "cache write",
    s_cost: "cost", s_lines: "lines", s_added: "added", s_deleted: "deleted",
    s_files: "files", s_lastUsed: "last used",
    // Relative time
    t_months: " months ago", t_d: "d ago", t_h: "h ago", t_m: "m ago", t_now: "just now",
    // Toast
    toastOpening: "Opening",
    toastIn: "in",
    toastResuming: "Resuming session in",
    toastSaved: "Settings saved",
    toastTerminalSet: "Terminal set to",
    notConfigured: "Not configured",
    commandRequired: "Command is required",
    // DB path
    dbPath: "Database Path",
    dbPathHint: "Path to opencode.db. Leave empty to auto-detect. Press Enter to save.",
    dbPathPlaceholderPrefix: "e.g. ",
    dbNotFound: "Database not found. Please configure the path to opencode.db in Settings.",
    dbNotFoundShort: "opencode.db not found",
    dbAutoDetected: "Auto-detected",
    dbConfigured: "Configured",
    dbPathSaved: "Database path saved, reloading data...",
    dbPathInvalid: "Database file not found at this path",
    // Pagination
    prevPage: "Prev",
    nextPage: "Next",
    // Load more sessions
    loadMore: "Load More",
    loadingMore: "Loading...",
    // Version
    versionCurrent: "Current",
    versionLatest: "Latest",
    versionChecking: "Checking...",
    versionCheckFailed: "Check failed",
    versionUpToDate: "Up to date",
    versionUpdateAvailable: "Update available",
    versionCopyCmd: "Copy command",
    versionCopied: "Copied!",
    versionAutoUpdate: "Update now",
    versionUpdating: "Updating...",
    versionUpdateSuccess: "Updated! Please restart the dashboard.",
    versionUpdateFailed: "Update failed",
    autoUpdateLabel: "Auto Update",
    autoUpdateHint: "Automatically update to latest version on startup",
    autoUpdateFailedTip: "Auto update failed on startup. Click to see details.",
    autoUpdateSuccessBanner: "Updated from v{from} to v{to}. The new version will take effect next time you start the dashboard.",
    autoUpdateFailedBanner: "Auto update failed on startup.",
    autoUpdateBannerDismiss: "Dismiss",
    // Today cost detail modal
    todayCostDetail: "Today Cost Detail",
    todayCostDetailHint: "Click a session to expand sub-agent details",
    todayCostNoData: "No cost data for today",
    todayCostProject: "Project",
    todayCostSession: "Session",
    todayCostAgent: "Agent",
    todayCostModel: "Model",
    todayCostAmount: "Cost",
    todayCostSubAgents: "Sub-agents",
    todayCostTotal: "Total",
    todayCostLoading: "Loading...",
  },
  zh: {
    title: "OpenCode \u4eea\u8868\u76d8",
    subtitle: "\u672c\u5730\u4f1a\u8bdd\u5386\u53f2\u67e5\u770b\u5668",
    refresh: "\u5237\u65b0",
    refreshing: "\u5237\u65b0\u4e2d...",
    settings: "\u8bbe\u7f6e",
    showHidden: "\u663e\u793a\u9690\u85cf",
    totalSessions: "\u603b\u4f1a\u8bdd\u6570",
    totalTokens: "\u603b Tokens",
    todayCost: "\u4eca\u65e5\u8d39\u7528",
    totalCost: "\u603b\u8d39\u7528",
    cacheRead: "\u7f13\u5b58\u8bfb\u53d6",
    linesAdded: "\u65b0\u589e\u884c\u6570",
    linesDeleted: "\u5220\u9664\u884c\u6570",
    filesChanged: "\u53d8\u66f4\u6587\u4ef6\u6570",
    sort: "\u6392\u5e8f:",
    sortRecent: "\u6700\u8fd1\u4f7f\u7528",
    sortMostUsed: "\u6700\u5e38\u4f7f\u7528",
    sortTokens: "Token \u7528\u91cf",
    sortChanges: "\u4ee3\u7801\u6539\u52a8",
    timeFilterLabel: "\u663e\u793a\u6700\u8fd1",
    timeFilterDays: "\u5929",
    timeFilterAll: "0 = \u663e\u793a\u5168\u90e8",
    projects: "\u9879\u76ee",
    open: "\u6253\u5f00",
    hide: "\u9690\u85cf",
    show: "\u663e\u793a",
    resume: "\u6062\u590d",
    untitled: "\u65e0\u6807\u9898",
    settingsTitle: "\u8bbe\u7f6e",
    language: "\u8bed\u8a00",
    terminal: "\u7ec8\u7aef",
    quickSelect: "\u5feb\u901f\u9009\u62e9",
    orCustom: "\u6216 \u81ea\u5b9a\u4e49",
    command: "\u547d\u4ee4",
    commandHint: "\u7ec8\u7aef\u7a0b\u5e8f\u8def\u5f84 (\u5982 wt.exe, pwsh.exe, alacritty.exe)",
    arguments: "\u53c2\u6570",
    argsHint: "\u4f7f\u7528 {dir} \u4f5c\u4e3a\u9879\u76ee\u76ee\u5f55\u5360\u4f4d\u7b26",
    projectCardFields: "\u9879\u76ee\u5361\u7247\u5b57\u6bb5",
    projectCardFieldsHint: "\u9009\u62e9\u9879\u76ee\u5361\u7247\u4e0a\u8981\u5c55\u793a\u7684\u7edf\u8ba1\u9879",
    sessionTableColumns: "\u4f1a\u8bdd\u8868\u683c\u5217",
    sessionTableColumnsHint: "\u9009\u62e9\u4f1a\u8bdd\u5217\u8868\u4e2d\u8981\u5c55\u793a\u7684\u5217",
    save: "\u4fdd\u5b58",
    f_sessions: "\u4f1a\u8bdd\u6570", f_tokens: "Tokens (\u8f93\u5165+\u8f93\u51fa)", f_input: "\u8f93\u5165 Tokens",
    f_output: "\u8f93\u51fa Tokens", f_reasoning: "\u63a8\u7406 Tokens", f_cacheRead: "\u7f13\u5b58\u8bfb\u53d6",
    f_cacheWrite: "\u7f13\u5b58\u5199\u5165", f_cost: "\u8d39\u7528 ($)", f_changes: "\u884c\u6570\u53d8\u66f4 (+/-)",
    f_added: "\u65b0\u589e\u884c\u6570", f_deleted: "\u5220\u9664\u884c\u6570", f_files: "\u53d8\u66f4\u6587\u4ef6\u6570",
    f_lastUsed: "\u6700\u8fd1\u4f7f\u7528", f_title: "\u6807\u9898", f_agent: "Agent", f_model: "\u6a21\u578b",
    f_time: "\u65f6\u95f4", f_created: "\u521b\u5efa\u65f6\u95f4", f_version: "OC \u7248\u672c",
    s_sessions: "\u4f1a\u8bdd", s_tokens: "tokens", s_input: "\u8f93\u5165", s_output: "\u8f93\u51fa",
    s_reasoning: "\u63a8\u7406", s_cacheRead: "\u7f13\u5b58\u8bfb", s_cacheWrite: "\u7f13\u5b58\u5199",
    s_cost: "\u8d39\u7528", s_lines: "\u884c\u6570", s_added: "\u65b0\u589e", s_deleted: "\u5220\u9664",
    s_files: "\u6587\u4ef6", s_lastUsed: "\u6700\u8fd1\u4f7f\u7528",
    t_months: " \u4e2a\u6708\u524d", t_d: " \u5929\u524d", t_h: " \u5c0f\u65f6\u524d", t_m: " \u5206\u949f\u524d", t_now: "\u521a\u521a",
    toastOpening: "\u6b63\u5728\u6253\u5f00",
    toastIn: "\u4e8e",
    toastResuming: "\u6b63\u5728\u6062\u590d\u4f1a\u8bdd\u4e8e",
    toastSaved: "\u8bbe\u7f6e\u5df2\u4fdd\u5b58",
    toastTerminalSet: "\u7ec8\u7aef\u5df2\u8bbe\u7f6e\u4e3a",
    notConfigured: "\u672a\u914d\u7f6e",
    commandRequired: "\u547d\u4ee4\u4e0d\u80fd\u4e3a\u7a7a",
    dbPath: "\u6570\u636e\u5e93\u8def\u5f84",
    dbPathHint: "opencode.db \u6587\u4ef6\u8def\u5f84\uff0c\u7559\u7a7a\u5219\u81ea\u52a8\u67e5\u627e\u3002\u6309 Enter \u4fdd\u5b58\u3002",
    dbPathPlaceholderPrefix: "\u4f8b\u5982 ",
    dbNotFound: "\u672a\u627e\u5230\u6570\u636e\u5e93\u6587\u4ef6\uff0c\u8bf7\u5728\u8bbe\u7f6e\u4e2d\u914d\u7f6e opencode.db \u7684\u8def\u5f84\u3002",
    dbNotFoundShort: "\u672a\u627e\u5230 opencode.db",
    dbAutoDetected: "\u81ea\u52a8\u68c0\u6d4b",
    dbConfigured: "\u624b\u52a8\u914d\u7f6e",
    dbPathSaved: "\u6570\u636e\u5e93\u8def\u5f84\u5df2\u4fdd\u5b58\uff0c\u6b63\u5728\u91cd\u65b0\u52a0\u8f7d\u6570\u636e...",
    dbPathInvalid: "\u6307\u5b9a\u8def\u5f84\u672a\u627e\u5230\u6570\u636e\u5e93\u6587\u4ef6",
    prevPage: "\u4e0a\u4e00\u9875",
    nextPage: "\u4e0b\u4e00\u9875",
    loadMore: "\u52a0\u8f7d\u66f4\u591a",
    loadingMore: "\u52a0\u8f7d\u4e2d...",
    versionCurrent: "\u5f53\u524d\u7248\u672c",
    versionLatest: "\u6700\u65b0\u7248\u672c",
    versionChecking: "\u68c0\u67e5\u4e2d...",
    versionCheckFailed: "\u68c0\u67e5\u5931\u8d25",
    versionUpToDate: "\u5df2\u662f\u6700\u65b0",
    versionUpdateAvailable: "\u6709\u65b0\u7248\u672c",
    versionCopyCmd: "\u590d\u5236\u547d\u4ee4",
    versionCopied: "\u5df2\u590d\u5236!",
    versionAutoUpdate: "\u7acb\u5373\u66f4\u65b0",
    versionUpdating: "\u66f4\u65b0\u4e2d...",
    versionUpdateSuccess: "\u66f4\u65b0\u6210\u529f\uff01\u8bf7\u91cd\u542f Dashboard\u3002",
    versionUpdateFailed: "\u66f4\u65b0\u5931\u8d25",
    autoUpdateLabel: "\u81ea\u52a8\u66f4\u65b0",
    autoUpdateHint: "\u542f\u52a8\u65f6\u81ea\u52a8\u68c0\u67e5\u5e76\u66f4\u65b0\u5230\u6700\u65b0\u7248\u672c",
    autoUpdateFailedTip: "\u542f\u52a8\u65f6\u81ea\u52a8\u66f4\u65b0\u5931\u8d25\uff0c\u70b9\u51fb\u67e5\u770b\u8be6\u60c5\u3002",
    autoUpdateSuccessBanner: "\u5df2\u4ece v{from} \u66f4\u65b0\u5230 v{to}\uff0c\u4e0b\u6b21\u542f\u52a8\u65f6\u5c06\u4f7f\u7528\u65b0\u7248\u672c\u3002",
    autoUpdateFailedBanner: "\u542f\u52a8\u65f6\u81ea\u52a8\u66f4\u65b0\u5931\u8d25\u3002",
    autoUpdateBannerDismiss: "\u5173\u95ed",
    todayCostDetail: "\u4eca\u65e5\u8d39\u7528\u660e\u7ec6",
    todayCostDetailHint: "\u70b9\u51fb\u4f1a\u8bdd\u5c55\u5f00\u5b50\u4ee3\u7406\u660e\u7ec6",
    todayCostNoData: "\u4eca\u65e5\u65e0\u8d39\u7528\u6570\u636e",
    todayCostProject: "\u9879\u76ee",
    todayCostSession: "\u4f1a\u8bdd",
    todayCostAgent: "\u4ee3\u7406",
    todayCostModel: "\u6a21\u578b",
    todayCostAmount: "\u8d39\u7528",
    todayCostSubAgents: "\u5b50\u4ee3\u7406",
    todayCostTotal: "\u5408\u8ba1",
    todayCostLoading: "\u52a0\u8f7d\u4e2d...",
  },
};

// Field key -> i18n label key mapping
const FIELD_LABEL_KEYS = {
  session_count: "f_sessions", tokens: "f_tokens", tokens_input: "f_input",
  tokens_output: "f_output", tokens_reasoning: "f_reasoning",
  tokens_cache_read: "f_cacheRead", tokens_cache_write: "f_cacheWrite",
  cost: "f_cost", changes: "f_changes", additions: "f_added",
  deletions: "f_deleted", files_changed: "f_files", last_used: "f_lastUsed",
  title: "f_title", agent: "f_agent", model: "f_model",
  time_updated: "f_time", time_created: "f_created", version: "f_version",
};

const STAT_LABEL_KEYS = {
  session_count: "s_sessions", tokens: "s_tokens", tokens_input: "s_input",
  tokens_output: "s_output", tokens_reasoning: "s_reasoning",
  tokens_cache_read: "s_cacheRead", tokens_cache_write: "s_cacheWrite",
  cost: "s_cost", changes: "s_lines", additions: "s_added",
  deletions: "s_deleted", files_changed: "s_files", last_used: "s_lastUsed",
};

// ---------------------------------------------------------------------------
// Config state (mutable singleton)
// ---------------------------------------------------------------------------
function getDefaults(fields) {
  return fields.filter((f) => f.default).map((f) => f.key);
}

function getPresets() {
  return DEFAULT_PRESETS[process.platform] || DEFAULT_PRESETS.linux;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      if (!cfg.hiddenDirs) cfg.hiddenDirs = [];
      if (!cfg.projectFields) cfg.projectFields = getDefaults(PROJECT_FIELDS);
      if (!cfg.sessionColumns) cfg.sessionColumns = getDefaults(SESSION_COLUMNS);
      if (!cfg.language) cfg.language = "en";
      if (cfg.sessionTimeFilter === undefined) cfg.sessionTimeFilter = 0;
      return cfg;
    }
  } catch {}
  const presets = getPresets();
  return {
    terminal: presets[0],
    hiddenDirs: [],
    projectFields: getDefaults(PROJECT_FIELDS),
    sessionColumns: getDefaults(SESSION_COLUMNS),
    language: "en",
    sessionTimeFilter: 0,
  };
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// The mutable config singleton — all modules share this reference
let currentConfig = loadConfig();

function getLang() {
  return I18N[currentConfig.language] || I18N.en;
}

module.exports = {
  PORT,
  HOST,
  SESSIONS_PER_PAGE,
  CONFIG_DIR,
  CONFIG_PATH,
  DEFAULT_PRESETS,
  PROJECT_FIELDS,
  SESSION_COLUMNS,
  I18N,
  FIELD_LABEL_KEYS,
  STAT_LABEL_KEYS,
  getDefaults,
  getPresets,
  loadConfig,
  saveConfig,
  currentConfig,
  getLang,
  // Allow other modules to get/set the config reference
  getConfig() { return currentConfig; },
  setConfig(cfg) { currentConfig = cfg; },
};
