# Traffic Sketch Lab

A lightweight, top-down **traffic-engineering sandbox** for Windows and desktop browsers. Draw free-form roads, configure individual lanes and intersections, then generate and inspect vehicle trips.

**Current version: [v0.9.1](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/releases/tag/v0.9.1)** · [All releases](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/releases) · [Changelog](CHANGELOG.md) · [Report a bug](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/issues)

## Download and play on Windows

### Recommended — install the updater once

1. Open the [latest GitHub release](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/releases/latest) and download **`TrafficSketchLab-Updater.exe`**.
2. Keep it anywhere convenient (for example, your Desktop). Double-click it to start the game.
3. On first launch, the updater downloads the game from the public GitHub release.
4. Every subsequent launch checks for a new release, updates the cached game if needed, and starts it. **You do not need to download updates manually, install Node.js, or work with source code.**

The launcher stores the game and any previously saved encrypted access token in `%LOCALAPPDATA%\TrafficSketchLab`. It only serves the game on your own PC (`127.0.0.1`), opening your default browser (including Firefox). If GitHub is unavailable, the installed game still works. To clear the stored token, run `TrafficSketchLab-Updater.exe --reset-auth`; to skip checking for updates, run `TrafficSketchLab-Updater.exe --offline`.

The updater and game executables are **unsigned development builds**. Windows SmartScreen may warn. The updater is not a native graphics engine; the game itself still runs in your browser.

### Alternative — self-contained offline portable copy

Download `TrafficSketchLab-Windows.zip` from a [release](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/releases), extract it, and run `TrafficSketchLab.exe`. This version is completely offline and requires no token, but **does not automatically update**.

**Important:** Maps saved only by browser autosave are tied to the game's localhost address. v0.8 uses stable port `127.0.0.1:4173` whenever available to keep that address consistent. For important maps, use the game's **Save** button to export JSON backups. Earlier versions used random ports, so their browser autosaves might not appear automatically after upgrading.

## What you can build

- Free-form Bézier streets, avenues, one-way ramps and highways; optional grid and road snapping, bridges and tunnels.
- Lane-level routing with continuous intersection paths, edited lane portals, allowed/blocked turns, lane splits and merges.
- Edit junction controls and undo or redo those edits while preserving vehicles, queued demand and simulation time.
- Selectable intersections with colored movement arrows, priority controls, yield rules, stop signs and traffic signals.
- Individual vehicle inspection (speed, delay, planned route), following distance and braking behavior.
- Multiple independently controlled source/destination traffic pairs with statistics and a 20 Hz traffic worker.
- JSON map save/load, undo/redo, cached static road rendering and a low-end graphics setting.

**Controls:** **V** Select · **P** choose priority approach · **G** grid · **C** curve · **Space + drag** pan · mouse wheel zoom · **Delete** remove · **Ctrl+Z** undo · **Esc** cancel. For lane endpoints, select an intersection and use the Intersection/Lane Links editor (or **Alt+drag** in Select mode).

## Version history

| Version | Summary | Release |
| --- | --- | --- |
| **0.9.1** | Clear green approaches retain speed and support following traffic | [v0.9.1](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/releases/tag/v0.9.1) |
| **0.9.0** | Live intersection edits, repaired selection under traffic, high-contrast road highlights and compact inspector | [v0.9.0](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/releases/tag/v0.9.0) |
| **0.8.0** | One-time Windows auto-updater, consistent localhost origin, documentation cleanup | [v0.8.0](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/releases/tag/v0.8.0) |
| **0.7.0** | Full-width road selection, brake lights for queues, two crossing traffic pairs, trimmed road rendering | [v0.7.0](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/releases/tag/v0.7.0) |
| **0.6.0** | Vehicle route inspector, road/intersection navigation and priority-road editing | [v0.6.0](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/releases/tag/v0.6.0) |
| **0.5 and earlier** | Simulation foundation, editable lanes and intersections, demand pairs, signals and gridlock prevention | Historical prototypes (not all have GitHub Releases) |

See [CHANGELOG.md](CHANGELOG.md) for details and remaining limitations.

## Development and testing

Source contributors: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) describes project architecture, TypeScript builds, test commands, and Windows packaging. **Players do not need any of these tools.**

Every push runs automated simulation/unit tests and actual Firefox UI tests on GitHub Actions. **Each new version bump in `package.json` automatically builds and publishes a new portable Windows GitHub Release**, including both the offline game ZIP and the reusable updater.

[Build status and test reports](https://github.com/spicypepper999/traffic-sketch-lab-chatgpt/actions)
