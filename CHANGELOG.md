# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] - 2026-06-08

### Added
- Today's cost popup on the dashboard header
- Also published as [`opencode-history`](https://www.npmjs.com/package/opencode-history) — a shorter, easier-to-discover package name (same code, same version)
- `CHANGELOG.md` and `CONTRIBUTING.md`
- Expanded npm keywords for better discoverability
- Reworked README with badges, `npx` quick-start, FAQ, and screenshots

## [0.4.0] - 2026-06-01

### Changed
- **BREAKING (runtime)**: Replaced `sql.js` (WASM) with [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) for massive memory reduction and faster queries. Native module, requires a working build toolchain on first install for unsupported platforms.

### Added
- Session time filter — show only sessions from the last N days

### Fixed
- Language change error tracking
- macOS refresh issue
- Hide function on certain projects

## [0.3.8] - 2026-05-29

### Changed
- Reduced published package size

## [0.3.6] - 2026-05-26

### Added
- Auto-update notification banner
- Async startup for faster cold-start
- Toggle for the startup auto-update check

### Fixed
- DEP0190 deprecation warning
- Resume failure when project directory path contained the substring `opencode`
- Exclude empty sessions from listings

## [0.3.2] - 2026-05-25

### Added
- Footer with GitHub and npm links

## [0.3.1] - 2026-05-25

### Added
- Version badge with update support

## [0.3.0] - 2026-05-25

### Changed
- Refactored monolithic `dashboard.js` into focused modules under `lib/` (config, db-locator, query, template, terminal, browser, utils)

### Added
- "Load more" pagination for sessions
- Today's cost display
- Performance optimizations

## [0.2.x] - 2026-05-24

### Added
- OpenCode CLI version detection
- Screenshots in README
- UI polish

### Fixed
- Per-session SELECT fallbacks for older schemas
- Accept object-shape `modelID` in newer schemas

## [0.1.0] - 2026-05-22

### Added
- Initial release: project list, session drill-down, global stats, one-click resume in terminal

[Unreleased]: https://github.com/felix-lj-ct/opencode-history/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/felix-lj-ct/opencode-history/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/felix-lj-ct/opencode-history/compare/v0.3.8...v0.4.0
[0.3.8]: https://github.com/felix-lj-ct/opencode-history/compare/v0.3.6...v0.3.8
[0.3.6]: https://github.com/felix-lj-ct/opencode-history/compare/v0.3.2...v0.3.6
[0.3.2]: https://github.com/felix-lj-ct/opencode-history/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/felix-lj-ct/opencode-history/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/felix-lj-ct/opencode-history/compare/v0.2.1...v0.3.0
[0.2.x]: https://github.com/felix-lj-ct/opencode-history/compare/v0.1.1...v0.2.1
[0.1.0]: https://github.com/felix-lj-ct/opencode-history/releases/tag/v0.1.0
