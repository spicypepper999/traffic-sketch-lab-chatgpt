# Developer guide

Players should download the updater from GitHub Releases; this document is only for contributors.

## Project layout

- `src/` — TypeScript road editor, lane graph, intersection controllers, vehicle simulation and rendering.
- `dist/js/` — compiled browser modules, checked in for no-install local hosting.
- `launcher/` — self-contained offline Go-based Windows game executable (embedded web assets).
- `updater/` — tiny standard-library Go updater for private GitHub Releases, with Windows-encrypted token storage.
- `test/` — Node unit/integration tests for simulation and geometry.
- `e2e/` — Playwright tests that launch actual Firefox, including on Windows CI.
- `.github/workflows/` — validation, portable game and updater release publishing.

## Run from source

With Node.js 22+:

```sh
npm install
npm run build
npm test
npm start
```

Open `http://127.0.0.1:4173`. The standalone browser test suite:

```sh
npx playwright install firefox
npm run test:browser
```

## Windows binaries

The *offline game* embeds the already-built `index.html`, CSS, and `dist/js/` in `launcher/web/`:

```sh
npm run build
npm run sync:launcher
cd launcher
go build -o TrafficSketchLab.exe .
```

The *auto-updating bootstrap* does not embed game assets. It requires only Go 1.23+ and has no external runtime dependencies:

```sh
cd updater
go test ./...
go build -trimpath -ldflags="-s -w" -o TrafficSketchLab-Updater.exe .
```

Windows DPAPI credential tests run on Windows CI. Private-repo downloads should be smoke-tested with a restricted read-only token; do not commit access tokens, GitHub credentials or encrypted credential files.

## Release policy

1. Bump the single version in **`package.json`** (`0.8.0` etc.). Keep visible product labels in the HTML and launcher synchronized.
2. Add a summary to **CHANGELOG.md**. Keep README short, with a link to latest release and a one-line version history.
3. Commit the new version to `main`. The **Publish portable Windows release** GitHub Actions workflow automatically detects the version bump, runs tests, builds both Windows executables, and publishes `vX.Y.Z` with the game ZIP and updater EXE.
4. Confirm GitHub Actions succeeded and verify the release has both assets. Do **not** call an update released until its artifacts exist.
5. Existing updater installations then retrieve the new game ZIP on the next launch.

The release workflow can also be rerun manually in GitHub Actions with its version input for retrying a failed upload. A new feature version must not silently overwrite an older release tag.
