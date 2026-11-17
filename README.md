# Traffic Sketch Lab v0.6

A lightweight traffic engineering sandbox with a free-form Bézier road editor, elevation-aware intersections, **explicit lane-to-lane connections**, and a 20 Hz simulation worker. The application is optimized for desktop browsers and includes an optional **portable Windows launcher** (a small native host that opens the game in the user's default browser).

## v0.6 — Congestion and signals

- Junctions **reserve turning movements only if there is space in the outgoing lane**. A stopped car cannot enter and then block the whole intersection merely because the exit was already full.
- **Simultaneous non-conflicting crossing movements** are admitted using precomputed geometry-based movement conflicts. A junction is no longer limited to one car at a time.
- Intersection permits remain reserved until the **rear of the vehicle clears** the connector, then are released.
- Every traffic-signal approach shows a **three-lamp signal head (red / yellow / green)**, labeled by the approach road at higher zoom. Opposite approaches share a phase even when drawn as separate roads. Phase transitions have a short yellow and all-red interval.
- Cars have **two rear brake lights**, illuminating while decelerating or waiting. Start-up delay is now applied after a red light turns green.
- Statistics include **junction crossings** and **average stopped time for active vehicles**. Source/destination traffic pairs and lane endpoint editors are retained.
- A sustained four-way high-demand regression test checks progress from every direction and checks that no vehicle stays immobilized in a junction connector.

## Run

**No npm install needed to run the checked-in build.** With Node.js 22+:

```sh
npm start
```

Open <http://localhost:4173>. To change the TypeScript source:

```sh
npm install
npm run build
npm test
```

### Windows without Node.js

Download the `TrafficSketchLab-Windows.zip` artifact from a GitHub Actions build or a tagged **Release**, extract it and double-click `TrafficSketchLab.exe`. The application serves its embedded assets at a local-only `127.0.0.1` address and opens a browser tab automatically. The exe is unsigned, so Windows SmartScreen may warn. No administrator privileges are needed.

To build the executable yourself, run:

```sh
npm install
npm run build
npm run sync:launcher
cd launcher
go build -o TrafficSketchLab.exe .
```

Use Go 1.23+. The `launcher/go.mod` file makes the same command work in Windows PowerShell after `npm run sync:launcher`.

## Interaction and editing

- **Select:** Click a road or intersection. The selected object is outlined in gold. Drag road endpoints or the center bend handle to reshape a road.
- **Intersections / Lane links:** Click an intersection. Every allowed lane-to-lane movement is displayed as a **solid, distinct-colored curve with a directional arrow**. Each approach's individual incoming and outgoing lane endpoint is displayed as an amber or teal **draggable portal handle**. Moving a portal rebuilds its lane geometry and **all** turning connectors that meet at that endpoint; the simulation graph and graphics share exact endpoints. Click a connector or use the inspector's ALLOW/BLOCK controls to edit lane movements, create 1-to-many links or many-to-1 merges, or close lanes. Use **Reset** alongside a portal to restore generated geometry.
- **Trip nodes:** Click the desired source and target nodes. The route respects allowed directed lane connections. Cars only travel between selected nodes; no random trips.
- **Multiple traffic demands:** Click **+ Add pair** in the traffic panel. Assign each pair its own source and target, name, demand rate (cars/s), and enable toggle. The source/target nodes for each pair are shown with matching colored markers. Vehicles retain their pair identity. Save/load persists all pairs.
- **Roads:** Four presets; straight or three-click curved drawing; grid and road snapping; heights 0m, +6m, and −6m for ground roads, bridges, tunnels and ramps.
- **Simulation:** Pause, 1×–4× speed, queue 25 vehicles for the selected pair, and tune driver following gap, reaction delay and following time. Dynamic cars and static roads render on separate canvases with cached geometry and fast (1× pixel) drawing.
- **Persistence:** Save/load a JSON map, automatic browser saving, and undo/redo. JSON save version 4 accepts previous maps from v0.1–v0.3.

## Architecture

- `src/network.ts` — elevation-aware road/node segmentation, lane generation, per-lane editable portals, intersection entity inventories, permitted connectors, deterministic directed routing.
- `src/geometry.ts` — Bézier curves, offsets, intersection and arc-length functions.
- `src/sim-worker.ts` — 20 Hz independent vehicle simulation, intersection conflict reservations, car-following, and multiple source→target demand queues.
- `src/signals.ts` — shared traffic-light phase logic for simulation and graphics.
- `src/renderer.ts` — cached static map, vehicle overlay, lane/turn/selection/portal drawing.
- `src/main.ts` — editor, inspector, vehicle settings, multiple OD pairs, input and saved state.
- `launcher/main.go` — standard-library-only portable Windows executable, embedded static assets.
- `scripts/sync-launcher.mjs` — copies build artifacts into Go's embedded asset directory.
- `test/` — Node tests including geometry, portal continuity, multi-pair trips, renderer caching and UI bootstrapping.

## GitHub repository & automatic builds

This project includes `.github/workflows/build.yml`. Once pushed to GitHub:

1. Every push to `main` or pull request runs the TypeScript build and automated tests.
2. Successful builds publish a **Windows ZIP** as a GitHub Actions artifact.
3. Pushing a version tag such as `v0.6.0` creates a **GitHub Release** with the ZIP attached.

The repository should be **private initially** unless the owner chooses to make the project public. Create the remote and push using GitHub authorization. **The presence of this workflow does not mean the repository has been published.**

For direct CLI publishing after logging in with `gh auth login`:

```sh
gh repo create traffic-sketch-lab --private --source=. --remote=origin --push
```

## Known limitations

- The native Windows EXE is a **launcher**, not a native renderer. Actual FPS depends on the browser and hardware. The earlier major redraw bottleneck was reduced via static-map caching; performance on low-end PCs still needs on-device benchmarking.
- When moving a portal, the nearby lane is smoothly curved into its new endpoint; highly extreme edits can produce unnatural bends. Fine-grained connector Bézier handle editing is not implemented yet.
- Mid-road lane changes and cooperative highway merging are still pending.
- Collision prevention currently uses a conservative 2D conflict-corridor approximation, not full swept-volume physics. Under unusual hand-edited connector curves, stress-test the junction before using it for high demand.
- Very short approach segments, overlapping intersections, and severe arbitrary portal deformations remain limited. Mid-road lane changes, adaptive signals and roundabouts are still planned.
- Dense overlapping junction footprints require further topology validation.
- Automated unit/integration tests run in Node; full graphical end-to-end testing on Windows is still needed.

No external account credentials are embedded in this repository.


## v0.6: inspectable roads, intersections and vehicles

- **Select a car** in Select mode to see its live ID, speed, state, route progress, delay, remaining distance, trip pair, and exact planned lane/turn paths. Its route glows cyan; the vehicle receives a yellow outline. Detailed routes are requested for the selected vehicle only.
- **Select an intersection** to see all incoming/outgoing roads and lane counts. A compact floating menu appears beside it: choose stop, priority, signal, or yield, and click an approach road to prioritize it. The priority axis is shown in amber on the map. Press **P** then click a nearby connected road to choose its priority directly.
- **Select a road** to list every intersection it feeds and receives from. Click those links to jump between the associated entities.
- Opposing aligned approach segments share **priority** even when built as different road IDs, matching how the signal-phase axis already works.
- Vehicle metadata is carried only for the selected car, reducing unnecessary cross-thread traffic.

**Important:** Any structural/network-control edit still resets active traffic. A future live-editing update will preserve or safely reroute vehicles across graph changes.
