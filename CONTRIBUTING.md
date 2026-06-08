# Contributing

Thanks for your interest in improving OpenCode Dashboard! Bug reports, feature requests, and PRs are all welcome.

## Quick start

```bash
git clone https://github.com/felix-lj-ct/opencode-dashboard.git
cd opencode-dashboard
npm install
node dashboard.js
```

The dashboard opens at <http://127.0.0.1:19860>.

## Project layout

A short tour — full details in [AGENTS.md](AGENTS.md).

```
dashboard.js          # HTTP server + API router (~250 lines)
lib/
  config.js           # constants, i18n, config singleton
  db-locator.js       # find opencode.db
  query.js            # schema introspection + SQL
  template.js         # server-side HTML (with embedded CSS + JS)
  terminal.js         # spawn terminal in project dir
  browser.js          # open browser, kill port
  utils.js            # helpers (no deps)
```

- **No build step**, no TypeScript, no framework.
- **CommonJS** (`require`), Node.js >= 16.
- Only runtime dep is `better-sqlite3`.

## Reporting bugs

Please include:

1. OS + Node version (`node -v`)
2. OpenCode Dashboard version (`opencode-dashboard --version` or check `package.json`)
3. OpenCode version (the CLI you're using)
4. Steps to reproduce
5. Relevant output from the dashboard's terminal window

If the issue is schema-related (column missing, query failure), please attach the output of:

```bash
sqlite3 path/to/opencode.db ".schema"
```

(Read-only, won't modify your data.)

## Submitting a PR

1. Fork & create a feature branch off `main`.
2. Keep changes focused — one feature/fix per PR.
3. Match the existing code style:
   - 2-space indentation
   - No semicolons-at-end policy enforced; match surrounding code
   - Prefer small, named functions over deeply nested logic
4. If you add a user-visible string, add it to **both** `en` and `zh` in `lib/config.js` `I18N`.
5. If you add a new SQL column dependency, use the field-resolver pattern in `lib/query.js` so older schemas still work.
6. Update `README.md` and `CHANGELOG.md` (under `## [Unreleased]`).
7. Test manually on at least one real `opencode.db`.

## i18n

Both English and 简体中文 are first-class. When adding a string:

```js
// lib/config.js
I18N: {
  en: { my_new_label: "My label" },
  zh: { my_new_label: "我的标签" },
}
```

## Schema compatibility

OpenCode's SQLite schema evolves. We support old + new schemas by:

- Introspecting columns at runtime
- Using `makeFieldResolver()` in `lib/query.js` to compile SQL expressions only for columns that exist
- Never `SELECT *`

If you depend on a new column, gate it behind the resolver — don't assume it exists.

## Security

- The HTTP server must remain bound to `127.0.0.1` only.
- The database must remain **read-only**.
- No outbound network calls beyond the opt-in npm version check.

If you discover a security issue, please email the maintainer privately rather than opening a public issue.

## Releasing (maintainers)

1. Bump version in `package.json`
2. Update `CHANGELOG.md` (move `[Unreleased]` items into a new versioned section)
3. `git commit -m "chore(release): X.Y.Z - <summary>"`
4. `git tag vX.Y.Z && git push --tags`
5. `npm publish --access public`
6. Create a GitHub Release from the tag, paste the changelog section as the release notes

## License

By contributing, you agree your contributions will be licensed under the [MIT License](LICENSE).
