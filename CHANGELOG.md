# Changelog

Project releases use version tags `vMAJOR.MINOR.PATCH`. These are release versions, not save-file schema versions.

## v0.9.0 — Live traffic editing and selection

- Fix Select clicks failing once vehicles enter the simulation. Highlight selected pavement across its full width.
- Change control modes, signal cycles and priority approaches during a trip. Undo and redo individual junction edits while preserving traffic and crossing reservations.
- Improve panel contrast and expose the inspector on compact screens. Canceling a road drag restores its original geometry.

## v0.8.0 — Updating and distribution

- Added a **one-time portable Windows updater**. Checks the GitHub Releases API and downloads only new game builds; installed builds are cached and work offline.
- Private-repository downloads use a restricted GitHub token stored in the current Windows user's encrypted DPAPI store, not embedded in source or binaries.
- Stabilized the game's local server on port 4173 where available to avoid a different browser autosave origin on every launch.
- Consolidated the README and moved detailed release history and developer commands into separate documents.
- GitHub Actions now builds and releases both downloadable editions automatically when the package version changes.
- **No substantive new driving or lane-changing model in this release.** Traffic simulation remains based on v0.7.0.

## v0.7.0 — Lane rendering, selection, and braking

- Select roads using their full paved width instead of a centerline-only hit test.
- Queued cars illuminate brake lights even after reaching zero acceleration.
- Add two crossing traffic pairs to the default example map.
- Road geometry is clipped to intersection portals; markings and pavement share compiled lane boundaries.
- Snap road endpoints to the logical junction center; retain distinct lane approach portals and continuous turning connectors.
- New tests for brake lights, road hit testing, and lane clipping. Automated Firefox tests verify selecting roads and intersections.

## v0.6.0 — Inspection and priority controls

- Select a car to view speed, delay, ID, current movement, and planned lane-level route.
- Select a road to see linked junctions, or a junction to see connected roads and lane counts.
- Added an on-map intersection control menu; choose priority road by clicking the approach.
- Prioritizes opposite collinear approaches even if they are separate road segments.

## v0.5.0 — Intersection flow and signals

- Prevent junction gridlock by checking destination-lane availability before entry.
- Use geometry-based conflict permits to allow non-conflicting movements to cross at the same time.
- Add traffic-light signal heads, yellow/all-red intervals, brake lamps, and reaction delay.
- Track junction crossings and vehicle waiting time.

## v0.4.0 — Manual lane portals and multiple demands

- Highlight selected roads and junctions.
- Give turning paths distinct solid colors, direction arrows, and draggable lane endpoint portals.
- Support multiple named origin/destination pairs with independent demand rates.

## v0.3.0 — Optimized drawing and junction inspector

- Cache static road geometry and separate vehicle rendering from road drawing.
- Introduce complete intersection lane inventories and a portable Windows game host.

## v0.2.0 — Connected lanes and routing

- Explicit lane connectors, non-U-turn defaults, source/destination trips, stop/yield/signal control, and lane permissions.

## v0.1.0 — First traffic laboratory

- Road editor, curved geometry, lane generation, vehicle following and worker-driven simulation.

## Current limitations

- The Windows launcher runs a local browser game, not a native GPU renderer. On-device graphics performance is hardware-dependent.
- Mid-road cooperative lane changes, advanced merges, adaptive signal optimization, roundabout generation and complex overlapping junction validation remain incomplete.
- Structural network edits still reset the moving traffic simulation.
- Maps saved under earlier random localhost ports may require manual JSON export/import to migrate.
