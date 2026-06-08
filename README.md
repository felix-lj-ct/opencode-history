# OpenCode Dashboard

> A local-first web dashboard for browsing your [OpenCode](https://opencode.ai) session history across every project — token usage, cost, code changes, and one-click resume in your favorite terminal.

[![npm version](https://img.shields.io/npm/v/opencode-history.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/opencode-history)
[![npm downloads](https://img.shields.io/npm/dm/opencode-history.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/opencode-history)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/opencode-history.svg?logo=node.js)](package.json)
[![GitHub stars](https://img.shields.io/github/stars/felix-lj-ct/opencode-history?style=social)](https://github.com/felix-lj-ct/opencode-history)

> **Heads up:** this project is now also published under the shorter, easier-to-find name **[`opencode-history`](https://www.npmjs.com/package/opencode-history)**. Both packages ship the same code and version — please prefer `opencode-history` going forward. The older [`@felixli-ct/opencode-dashboard`](https://www.npmjs.com/package/@felixli-ct/opencode-dashboard) will continue to receive updates for now.

![Dashboard overview](https://raw.githubusercontent.com/felix-lj-ct/opencode-history/main/docs/images/dashboard.png)

## Why?

If you use [OpenCode](https://opencode.ai) across many projects, all your session
history lives in a single SQLite database — but the CLI only shows the project
you're currently in. This dashboard gives you a **bird's-eye view** of every
project, every session, and lets you jump back in with one click.

- **Zero config** — auto-detects your `opencode.db` on Windows / macOS / Linux
- **Local-first & private** — binds to `127.0.0.1` only, DB opened read-only, nothing leaves your machine
- **No native build** — pure Node + WASM SQLite (works behind corporate firewalls, no toolchain needed)
- **Resume in your terminal** — one click launches `opencode` in the right directory

## Quick Start

Try it instantly without installing:

```bash
npx opencode-history
```

Or install globally:

```bash
npm install -g opencode-history
opencode-dashboard
```

> The CLI binary is still named `opencode-dashboard` for backward compatibility.

The dashboard auto-opens at <http://127.0.0.1:19860>. Press `Ctrl+C` to stop.

> **Requirements:** Node.js >= 16 (you already have it if you're using OpenCode).

## Features

- 📊 **Project overview** — every project with session counts, total tokens, cost, and code-change stats
- 🔍 **Session drill-down** — expand any project to see its recent sessions (title, agent, model, tokens, lines changed)
- 🌍 **Global stats** — total sessions, tokens, lines added/deleted, files changed across everything
- ⚡ **One-click resume** — `Open` button spawns your terminal in the project directory and runs `opencode`
- 🎨 **Fully customizable** — pick which stats appear on each card and which columns show in the session table
- 🌐 **i18n** — English & 简体中文 built in
- 🕒 **Time filter** — show only sessions from the last N days
- 🙈 **Hide noise** — hide projects you don't care about
- 🔔 **Update notifications** — knows when a new version is published
- 🖥️ **Cross-platform terminals** — Windows Terminal, PowerShell, CMD, plus custom commands for `alacritty`, `wezterm`, `kitty`, `gnome-terminal`, iTerm2, etc.

## Screenshots

### Pick the terminal you actually use

![Terminal picker](https://raw.githubusercontent.com/felix-lj-ct/opencode-history/main/docs/images/terminal-picker.png)

### Customize project cards & session columns

![Customize project card fields and session table columns](https://raw.githubusercontent.com/felix-lj-ct/opencode-history/main/docs/images/customize-fields.png)

## How It Works

1. Locates your `opencode.db` SQLite database automatically
2. Reads it **read-only** with [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
3. Serves a self-contained HTML dashboard via Node's built-in HTTP server (no Express, no React, no build step)
4. The `Open` button spawns a terminal in the selected project directory and runs `opencode`

## Database Locations

The tool auto-detects `opencode.db` in this order:

| Platform | Path |
|----------|------|
| Linux    | `$XDG_DATA_HOME/opencode/opencode.db` or `~/.local/share/opencode/opencode.db` |
| macOS    | `~/.local/share/opencode/opencode.db` or `~/Library/Application Support/opencode/opencode.db` |
| Windows  | `%USERPROFILE%\.local\share\opencode\opencode.db` |

You can override the path in **Settings** → **Database path**.

## Configuration

Open **Settings** (top-right gear icon) to customize:

- **Language** — English / 简体中文
- **Terminal command** — preset or custom, with `{dir}` and `{cmd}` placeholders
- **Project card fields** — pick which stats appear on each card
- **Session table columns** — pick which columns show in the per-project table
- **Time filter** — last 7 / 30 / 90 / all days
- **Auto-update check** — toggle on/off
- **Database path** — point to a custom `opencode.db` location

Config is stored at `~/.config/opencode-dashboard/config.json` (XDG-aware).

## Security

- HTTP server binds to `127.0.0.1` only — **not** accessible from your network
- Database is opened in **read-only** mode — the dashboard never writes to it
- **No telemetry, no external network calls** (except an opt-in npm version check)
- All data stays on your machine

## FAQ

**Does this modify my OpenCode data?**
No. The DB is opened read-only.

**Will it work with future OpenCode versions?**
Schema columns are detected at runtime, so older and newer schemas both work. If something breaks, please [open an issue](https://github.com/felix-lj-ct/opencode-history/issues).

**Can I run it on a server / remote machine?**
By design it binds to localhost only. If you need remote access, use SSH port forwarding: `ssh -L 19860:127.0.0.1:19860 your-server`.

**Why not a TUI?**
A web UI gives you sortable tables, clickable links, and screenshots you can share — without leaving the terminal you already have open.

## Contributing

Issues and PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

Quick dev loop:

```bash
git clone https://github.com/felix-lj-ct/opencode-history.git
cd opencode-dashboard
npm install
node dashboard.js
```

## License

[MIT](LICENSE) © Felix

---

If this tool helps you, please ⭐ the repo — it really helps others discover it.
