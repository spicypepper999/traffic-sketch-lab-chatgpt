// @ts-nocheck
import { Renderer } from './renderer.js';
import { compileNetwork, PRESETS, findRoute } from './network.js';
import { clamp, cubic, dist, samples, nearestLine, controlStraight, controlBend } from './geometry.js';
import { movementColor, pairColor } from './colors.js';
import { roadJunctions, junctionRoads, priorityApproaches } from './inspection.js';
const el = id => document.getElementById(id), canvas = el('world'), render = new Renderer(canvas), worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
const defaults = { quality: 'fast', grid: true, snap: true, curve: false, roadKind: 'street', z0: 0, z1: 0, spawnRate: .8, headway: 1.5, gap: 2.5, startDelay: .7, simSpeed: 1 };
let settings = { ...defaults }, roads = [], blocked = new Set(), forced = new Set(), closed = new Set(), network = compileNetwork([]), pathLookup = new Map(), idCount = 0, tool = 'select', selectedRoad = null, selectedLane = null;
let odPairs = [{ id: 'pair1', name: 'Pair 1', sourceId: null, targetId: null, rate: .8, enabled: true, colorIndex: 0 }], activePairId = 'pair1', nextPairNumber = 1;
const activePair = () => odPairs.find(p => p.id === activePairId) || odPairs[0];
let sourceId = null, targetId = null, currentRoute = null, picking = 'source', intersectionControls = {}, selectedJunction = null;
let selectedVehicleId = null, selectedVehicleDetail = null, selectedVehicleRoute = null, priorityPick = false, lastCarPanel = 0;
let portals = {}, portalDrag = null, linkDrag = null, dragMode = 'move', selectedConnection = null, previewLast = 0;
let phase = 'none', start = null, end = null, pointer = { x: 0, y: 0 }, paused = false, debug = false, panKey = false, dragging = null, previousRoad = null, panStart = null;
const undoStack = [], redoStack = [];
let last = { received: 0, vehicles: [] };
const send = msg => worker.postMessage(msg);
const format = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
function toast(text, error = false) { const div = document.createElement('div'); div.className = 'toast' + (error ? ' error' : ''); div.textContent = text; el('notifications').append(div); setTimeout(() => div.remove(), 2500); }
function makeRoad(kind, p0, p3, mid = null, z0 = 0, z1 = 0) { const [p1, p2] = mid ? controlBend(p0, p3, mid) : controlStraight(p0, p3); return { id: 'r' + (++idCount), kind, p0: { ...p0 }, p1, p2, p3: { ...p3 }, z0, z1, ...PRESETS[kind] }; }
function example() {
    idCount = 0;
    return [
        makeRoad('street', { x: -350, y: 0 }, { x: 360, y: 0 }),
        makeRoad('street', { x: -80, y: -255 }, { x: -80, y: 255 }),
        makeRoad('avenue', { x: -345, y: -144 }, { x: 270, y: -144 }, { x: -10, y: -190 }),
        makeRoad('street', { x: 205, y: -260 }, { x: 205, y: 230 }),
        makeRoad('highway', { x: -410, y: 168 }, { x: 415, y: 168 }, null, 6, 6),
        makeRoad('oneway', { x: -220, y: 168 }, { x: -220, y: 0 }, { x: -250, y: 85 }, 6, 0),
        makeRoad('oneway', { x: 130, y: 0 }, { x: 130, y: 168 }, { x: 95, y: 85 }, 0, 6),
        makeRoad('street', { x: 205, y: -230 }, { x: 350, y: -65 }, { x: 330, y: -175 }),
        makeRoad('street', { x: -350, y: -260 }, { x: -345, y: -144 })
    ];
}
function asSave() { return { version: 4, roads, blocked: [...blocked], forced: [...forced], closed: [...closed], odPairs, activePairId, portals, intersectionControls, settings }; }
function snapshot() { return JSON.stringify({ roads, blocked: [...blocked], forced: [...forced], closed: [...closed], odPairs, activePairId, portals, intersectionControls }); }
function mark() { undoStack.push(snapshot()); if (undoStack.length > 80)
    undoStack.shift(); redoStack.length = 0; }
function restore(json) {
    const data = JSON.parse(json);
    roads = data.roads;
    blocked = new Set(data.blocked);
    forced = new Set(data.forced);
    closed = new Set(data.closed || []);
    setPairsFromData(data);
    portals = data.portals || {};
    nextPairNumber = Math.max(1, ...odPairs.map(p => Number(p.id.replace('pair', '')) || 0));
    intersectionControls = data.intersectionControls || {};
    idCount = Math.max(0, ...roads.map(r => Number(r.id.slice(1)) || 0));
    selectedRoad = null;
    selectedLane = null;
    selectedConnection = null;
    rebuild();
}
function legacyPair(data) {
    return { id: 'pair1', name: 'Pair 1', sourceId: data.sourceId || null, targetId: data.targetId || null,
        rate: Math.max(0, Number(data.settings?.spawnRate ?? .8)), enabled: true, colorIndex: 0 };
}
function setPairsFromData(data) {
    odPairs = Array.isArray(data.odPairs) && data.odPairs.length ? data.odPairs.slice(0, 80).filter(p => p && typeof p.id === 'string').map((p, i) => ({ id: p.id, name: String(p.name || 'Pair ' + (i + 1)).slice(0, 32),
        sourceId: p.sourceId || null, targetId: p.targetId || null, rate: clamp(Number(p.rate) || 0, 0, 8), enabled: p.enabled !== false, colorIndex: Number.isFinite(p.colorIndex) ? p.colorIndex : i })) : [legacyPair(data)];
    if (!odPairs.length)
        odPairs = [legacyPair(data)];
    nextPairNumber = Math.max(1, ...odPairs.map(p => Number(p.id.replace('pair', '')) || 0));
    activePairId = odPairs.some(p => p.id === data.activePairId) ? data.activePairId : odPairs[0].id;
}
function undo() { if (!undoStack.length)
    return toast('Nothing to undo'); redoStack.push(snapshot()); restore(undoStack.pop()); toast('Undid edit'); }
function redo() { if (!redoStack.length)
    return toast('Nothing to redo'); undoStack.push(snapshot()); restore(redoStack.pop()); toast('Redid edit'); }
function rebuild() {
    selectedVehicleId = null;
    selectedVehicleDetail = null;
    selectedVehicleRoute = null;
    send({ type: 'SELECT_VEHICLE', id: null });
    network = compileNetwork(roads, blocked, forced, closed, intersectionControls, portals);
    pathLookup = new Map(network.paths.map(p => [p.id, p]));
    if (selectedJunction && !network.intersections.some(n => n.id === selectedJunction))
        selectedJunction = null;
    const ids = new Set(network.nodes.map(n => n.id));
    for (const pair of odPairs) {
        if (pair.sourceId && !ids.has(pair.sourceId))
            pair.sourceId = null;
        if (pair.targetId && !ids.has(pair.targetId))
            pair.targetId = null;
    }
    syncActivePair();
    send({ type: 'INIT', network });
    send({ type: 'SET_PAIRS', pairs: odPairs });
    send({ type: 'SET_SETTINGS', headway: settings.headway, gap: settings.gap, startDelay: settings.startDelay });
    send({ type: 'SET_RUNNING', running: !paused });
    send({ type: 'SET_SPEED', speed: settings.simSpeed });
    last = { received: 0, vehicles: [] };
    el('nodeStat').textContent = network.nodes.length;
    el('laneStat').textContent = network.lanes.length;
    el('networkBadge').textContent = `${network.lanes.length} LANES · ${network.connectors.length} LINKS`;
    updatePairPanel();
    updateInspector();
    render.invalidateGeometry();
}
function syncActivePair() {
    const pair = activePair();
    sourceId = pair?.sourceId || null;
    targetId = pair?.targetId || null;
    currentRoute = findRoute(network, sourceId, targetId);
    settings.spawnRate = pair?.rate || 0;
    if (el('spawnRate'))
        el('spawnRate').value = String(settings.spawnRate);
    sliderLabels();
}
function nodeDescription(id) { const n = network.nodes.find(n => n.id === id); return n ? `${Math.round(n.x)}, ${Math.round(n.y)} m` : 'Not selected'; }
function updatePairPanel() {
    const current = activePair();
    el('pairList').innerHTML = odPairs.map((p, i) => {
        const route = findRoute(network, p.sourceId, p.targetId), selected = p.id === activePairId;
        const status = p.sourceId && p.targetId ? (route ? 'Connected' : 'NO ROUTE') : 'Incomplete';
        return `<div class="pair-card ${selected ? 'selected' : ''}" data-pair-card="${p.id}" style="--pair-color:${pairColor(p.colorIndex)}">
   <button class="pair-select" data-pair-select="${p.id}"><span class="pair-color"></span><b>${p.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</b><small>${status}</small></button>
   <label class="pair-rate"><span>cars/s</span><input type="number" min="0" max="8" step="0.2" value="${p.rate}" data-pair-rate="${p.id}" aria-label="Demand for ${p.name}"></label>
   <label class="pair-enable"><input type="checkbox" data-pair-enable="${p.id}" ${p.enabled ? 'checked' : ''} title="Enable demand"></label>
   ${odPairs.length > 1 ? `<button class="pair-remove" data-pair-remove="${p.id}" title="Delete pair">×</button>` : ''}
  </div>`;
    }).join('');
    el('pairName').value = current?.name || '';
    el('sourceValue').textContent = nodeDescription(sourceId);
    el('targetValue').textContent = nodeDescription(targetId);
    el('tripStatus').textContent = currentRoute ? `Route found · ${Math.round(currentRoute.distance)} m · ${Math.round(currentRoute.travelTime)} s free-flow` :
        sourceId && targetId ? 'No legal route between this pair' : 'Choose origin and destination nodes';
    el('tripStatus').classList.toggle('bad', !!sourceId && !!targetId && !currentRoute);
    el('spawnBtn').disabled = !currentRoute;
    el('pickSource').classList.toggle('picking', tool === 'endpoints' && picking === 'source');
    el('pickTarget').classList.toggle('picking', tool === 'endpoints' && picking === 'target');
    el('activePairLabel').textContent = current?.name || 'No pair';
}
function persist() { try {
    localStorage.setItem('traffic-sketch-autosave', JSON.stringify(asSave()));
}
catch { } }
function commit() { rebuild(); persist(); }
function validRoad(r) { return r && typeof r.id === 'string' && PRESETS[r.kind] && [r.p0, r.p1, r.p2, r.p3].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) && [r.z0, r.z1, r.forward, r.backward, r.width, r.speed].every(Number.isFinite) && r.width > 0 && r.speed > 0; }
function loadData(data) { if (![1, 2, 3, 4].includes(data?.version) || !Array.isArray(data.roads) || data.roads.length > 3000 || !data.roads.every(validRoad))
    throw Error('Invalid or unsupported map'); mark(); roads = data.roads; blocked = new Set(data.blocked || []); forced = new Set(data.forced || []); closed = new Set(data.closed || []); setPairsFromData(data); portals = data.portals || {}; intersectionControls = data.intersectionControls || {}; settings = { ...defaults, ...data.settings }; idCount = Math.max(0, ...roads.map(r => Number(r.id.slice(1)) || 0)); selectedRoad = null; selectedLane = null; phase = 'none'; syncUI(); commit(); toast(`Loaded ${roads.length} roads`); }
function syncUI() {
    render.setQuality(settings.quality);
    el('qualitySelect').value = settings.quality;
    for (const [id, value] of [['gridToggle', settings.grid], ['snapToggle', settings.snap], ['curveToggle', settings.curve]])
        el(id).checked = value;
    for (const [id, value] of [['fromElevation', settings.z0], ['toElevation', settings.z1], ['spawnRate', settings.spawnRate], ['headway', settings.headway], ['minGap', settings.gap], ['startDelay', settings.startDelay]])
        el(id).value = String(value);
    sliderLabels();
}
function sliderLabels() { el('headwayVal').textContent = settings.headway.toFixed(1) + ' s'; el('gapVal').textContent = settings.gap.toFixed(1) + ' m'; el('delayVal').textContent = settings.startDelay.toFixed(1) + ' s'; el('rateVal').textContent = settings.spawnRate.toFixed(1) + '/s'; }
function setTool(name) {
    const old = tool;
    tool = name;
    phase = 'none';
    start = null;
    end = null;
    if (name !== 'lanes' && name !== 'junctions' && name !== 'select') {
        selectedLane = null;
        selectedJunction = null;
    }
    if (old !== 'lanes' && old !== 'junctions' && name === 'lanes')
        selectedLane = null;
    if (name !== 'select' && name !== 'junctions' && name !== 'lanes')
        selectedRoad = null;
    if (name !== 'select') {
        selectedVehicleId = null;
        selectedVehicleDetail = null;
        selectedVehicleRoute = null;
        send({ type: 'SELECT_VEHICLE', id: null });
    }
    priorityPick = false;
    if (PRESETS[name])
        settings.roadKind = name;
    document.querySelectorAll('[data-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === name));
    canvas.style.cursor = name === 'pan' ? 'grab' : name === 'select' ? 'default' : 'crosshair';
    el('pickSource').classList.toggle('picking', name === 'endpoints' && picking === 'source');
    el('pickTarget').classList.toggle('picking', name === 'endpoints' && picking === 'target');
    el('actionHint').textContent = name === 'select' ? 'Click a road or intersection to inspect it. Drag road handles to edit.' :
        name === 'lanes' || name === 'junctions' ? 'Click an intersection. Drag its lane endpoints or edit the solid-colored turning paths.' :
            name === 'endpoints' ? 'Click a junction or road endpoint to set the ' + picking + '.' :
                name === 'pan' ? 'Drag to pan. Scroll to zoom.' : 'Click a start point, then an end point' + (settings.curve ? ', then a curve bend.' : '.');
    render.invalidateMap();
    updateInspector();
}
function containsPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if (((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x))
            inside = !inside;
    }
    return inside;
}
function intersectionAt(p) {
    const hits = network.intersections.filter(n => dist(p, n.center) < Math.max(5, 14 / render.zoom) || containsPolygon(p, n.polygon));
    hits.sort((a, b) => Math.abs(a.z - settings.z0) - Math.abs(b.z - settings.z0) || dist(p, a.center) - dist(p, b.center));
    return hits[0] || null;
}
function chooseIntersection(p) { const n = intersectionAt(p); selectedJunction = n?.id || null; selectedRoad = null; selectedLane = null; selectedVehicleId = null; selectedVehicleDetail = null; selectedVehicleRoute = null; priorityPick = false; send({ type: 'SELECT_VEHICLE', id: null }); updateInspector(); render.invalidateMap(); return !!n; }
function roadAt(p) { let match = null, best = Infinity; for (const r of roads) {
    const d = nearestLine(p, samples(r, Math.max(25, Math.min(100, Math.ceil(dist(r.p0, r.p3) / 4)))).map(s => s.p)).d;
    if (d < Math.max(4, 9 / render.zoom) && d < best) {
        best = d;
        match = r;
    }
} return match; }
function laneAt(p, junctionId = null) { let best = Infinity, id = null; for (const l of network.lanes) {
    if (junctionId && l.endNode !== junctionId)
        continue;
    const d = nearestLine(p, l.points).d;
    if (d < Math.max(1.6, 6 / render.zoom) && d < best) {
        best = d;
        id = l.id;
    }
} return id; }
function nodeAt(p) { let best = Math.max(6, 13 / render.zoom), selected = null; for (const n of network.nodes) {
    const d = dist(p, n);
    if (d < best) {
        best = d;
        selected = n;
    }
} return selected; }
function connectorAt(p) { let best = Infinity, id = null; for (const c of network.candidates.filter(c => c.from === selectedLane)) {
    const d = nearestLine(p, c.points).d;
    if (d < Math.max(2, 8 / render.zoom) && d < best) {
        best = d;
        id = c.id;
    }
} return id; }
function snap(p, z, shift = false) {
    if (shift)
        return p;
    let near = null, best = Math.max(3, 12 / render.zoom);
    if (settings.snap)
        for (const r of roads) {
            for (const [pt, h] of [[r.p0, r.z0], [r.p3, r.z1]]) {
                const d = dist(pt, p);
                if (d < best && Math.abs(h - z) < 1.2) {
                    near = pt;
                    best = d;
                }
            }
            const pts = samples(r, Math.max(25, Math.min(110, Math.ceil(dist(r.p0, r.p3) / 4))));
            for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1], b = pts[i], q = nearestLine(p, [a.p, b.p]);
                const t = a.t + (b.t - a.t) * q.s / Math.max(.001, dist(a.p, b.p));
                if (q.d < best && Math.abs(r.z0 + (r.z1 - r.z0) * t - z) < 1.2) {
                    near = cubic(r, t);
                    best = q.d;
                }
            }
        }
    if (near)
        return { ...near };
    if (el('gridSnapToggle').checked)
        return { x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 };
    return { ...p };
}
function place(p, shift) {
    if (phase === 'none') {
        start = snap(p, settings.z0, shift);
        phase = 'end';
        el('actionHint').textContent = 'Choose the road endpoint; right click cancels.';
        return;
    }
    if (phase === 'end') {
        end = snap(p, settings.z1, shift);
        if (dist(start, end) < 12)
            return toast('Road must be at least 12 meters long', true);
        if (settings.curve) {
            phase = 'bend';
            el('actionHint').textContent = 'Click to bend the curve.';
            return;
        }
        finish(null);
        return;
    }
    if (phase === 'bend')
        finish(p);
}
function finish(mid) { mark(); roads.push(makeRoad(settings.roadKind, start, end, mid, settings.z0, settings.z1)); start = null; end = null; phase = 'none'; commit(); el('actionHint').textContent = 'Road added; continue drawing or inspect its lane connections.'; }
function toggleLink(key) {
    const c = network.candidates.find(c => c.id === key);
    if (!c)
        return;
    const a = network.lanes.find(l => l.id === c.from), b = network.lanes.find(l => l.id === c.to);
    if (a?.closed || b?.closed)
        return toast('Open both lanes before connecting them', true);
    selectedLane = c.from;
    selectedJunction = c.nodeId;
    mark();
    if (c.allowed) {
        blocked.add(key);
        forced.delete(key);
    }
    else {
        forced.add(key);
        blocked.delete(key);
    }
    commit();
    toast(c.allowed ? 'Movement blocked' : 'Movement enabled');
}
function toggleClosedLane() {
    const l = network.lanes.find(l => l.id === selectedLane);
    if (!l)
        return;
    mark();
    if (closed.has(l.id))
        closed.delete(l.id);
    else
        closed.add(l.id);
    commit();
    toast(l.closed ? 'Lane reopened' : 'Lane closed to all traffic');
}
function junctionCandidates(id) { return network.candidates.filter(c => c.nodeId === id); }
function bulkLaneLinks(laneId, action) {
    const lane = network.lanes.find(l => l.id === laneId);
    if (!lane)
        return;
    const candidates = network.candidates.filter(c => c.from === laneId);
    if (!candidates.length)
        return;
    mark();
    for (const c of candidates) {
        if (action === 'block') {
            blocked.add(c.id);
            forced.delete(c.id);
        }
        if (action === 'reset') {
            blocked.delete(c.id);
            forced.delete(c.id);
        }
    }
    selectedJunction = lane.endNode;
    selectedLane = laneId;
    commit();
    toast(action === 'block' ? 'All movements blocked' : 'Automatic movements restored');
}
function resetIntersection() { if (!selectedJunction)
    return; mark(); for (const c of junctionCandidates(selectedJunction)) {
    blocked.delete(c.id);
    forced.delete(c.id);
} commit(); toast('Intersection links reset to automatic defaults'); }
function focusLane(id) { const l = network.lanes.find(l => l.id === id); if (!l || !network.intersections.some(n => n.id === l.endNode))
    return; selectedLane = l.id; selectedJunction = l.endNode; selectedRoad = null; render.invalidateMap(); updateInspector(); }
function focusRoad(id) {
    if (!roads.some(r => r.id === id))
        return;
    tool = 'select';
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === 'select'));
    selectedRoad = id;
    selectedJunction = null;
    selectedLane = null;
    selectedVehicleId = null;
    selectedVehicleDetail = null;
    selectedVehicleRoute = null;
    priorityPick = false;
    send({ type: 'SELECT_VEHICLE', id: null });
    updateInspector();
    render.invalidateMap();
}
function focusJunction(id) {
    const n = network.nodes.find(n => n.id === id && n.isJunction);
    if (!n)
        return;
    tool = 'select';
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === 'select'));
    selectedRoad = null;
    selectedLane = null;
    selectedJunction = id;
    selectedVehicleId = null;
    selectedVehicleDetail = null;
    selectedVehicleRoute = null;
    priorityPick = false;
    send({ type: 'SELECT_VEHICLE', id: null });
    updateInspector();
    render.invalidateMap();
}
function setJunctionControl(type) {
    const n = network.nodes.find(n => n.id === selectedJunction);
    if (!n)
        return;
    if (!['stop', 'priority', 'signal', 'yield', 'free'].includes(type))
        return;
    mark();
    intersectionControls[n.id] = { ...n.control, type };
    commit();
    toast(`Intersection: ${type}`);
}
function setJunctionPriority(roadId) {
    const n = network.nodes.find(n => n.id === selectedJunction);
    if (!n || !n.roadIds.includes(roadId))
        return toast('Click a road directly connected to this intersection', true);
    priorityPick = false;
    if (n.control.type === 'priority' && n.control.priorityRoad === roadId)
        return updateInspector();
    mark();
    intersectionControls[n.id] = { ...n.control, type: 'priority', priorityRoad: roadId };
    commit();
    toast(`${roadId} now has priority (including opposite aligned approaches)`);
}
function selectVehicle(id) {
    if (!Number.isInteger(id))
        return;
    selectedVehicleId = id;
    selectedVehicleDetail = null;
    selectedVehicleRoute = null;
    selectedJunction = null;
    selectedRoad = null;
    selectedLane = null;
    priorityPick = false;
    send({ type: 'SELECT_VEHICLE', id });
    updateInspector();
    render.invalidateMap();
}
function vehicleAt(p) {
    let hit = null, best = Math.max(2.8, 11 / render.zoom);
    const age = paused ? 0 : Math.min(.095, Math.max(0, (performance.now() - last.received) / 1000)) * settings.simSpeed;
    const pathById = pathLookup;
    for (const car of last.vehicles) {
        const path = pathById.get(car.pathId);
        if (!path)
            continue;
        const center = at(path, Math.min(path.length, car.s + car.speed * age)).point;
        const d = dist(p, center);
        if (d < best) {
            best = d;
            hit = car;
        }
    }
    return hit;
}
function updateCarMetrics() {
    const v = selectedVehicleDetail;
    if (!v)
        return;
    const path = pathLookup, remaining = v.route.slice(v.index).reduce((sum, id, i) => sum + Math.max(0, (path.get(id)?.length || 0) - (i === 0 ? v.s : 0)), 0);
    for (const [id, value] of [['carSpeed', (v.speed * 3.6).toFixed(1) + ' km/h'], ['carSegment', v.pathId], ['carDistance', Math.round(remaining) + ' m'],
        ['carDelay', v.delayTime.toFixed(1) + ' s'], ['carStatus', v.waiting ? 'Waiting for junction' : v.braking ? 'Braking' : v.speed < .5 ? 'Stopped' : 'Driving'],
        ['carProgress', `${v.index + 1} / ${v.route.length}`]]) {
        const e = el(id);
        if (e && e.textContent !== value)
            e.textContent = value;
    }
}
function vehicleInspector() {
    const v = selectedVehicleDetail;
    if (!v)
        return '<div class="info-box">Requesting vehicle route from the traffic simulation…</div>';
    const pair = odPairs.find(p => p.id === v.pairId), pathById = pathLookup;
    const roadsOnRoute = [...new Set(v.route.map(id => pathById.get(id)?.roadId).filter(Boolean))];
    const segments = roadsOnRoute.slice(0, 36).map(id => `<button data-action="focusRoad" data-road="${id}" class="relation-button">${id}</button>`).join('');
    return `<div class="info-box"><strong>Vehicle #${v.id}</strong> · ${pair?.name || v.pairId}<br>Destination pair: ${nodeDescription(pair?.sourceId)} → ${nodeDescription(pair?.targetId)}</div>
 <div class="car-facts"><div>Current speed<b id="carSpeed"></b></div><div>Status<b id="carStatus"></b></div><div>Current path<b id="carSegment"></b></div><div>Route segment<b id="carProgress"></b></div><div>Distance remaining<b id="carDistance"></b></div><div>Delay experienced<b id="carDelay"></b></div></div>
 <div class="panel-label" style="margin:12px 0 6px">PLANNED ROUTE</div><p class="muted">The cyan path on the map is this car's actual planned lane-and-intersection route. Its current position is ringed in yellow.</p>
 <div class="relation-list">${segments || 'No road segments'}${roadsOnRoute.length > 36 ? `<span>+${roadsOnRoute.length - 36} more</span>` : ''}</div><button class="inspector-action" data-action="clearVehicle">Close vehicle inspector</button>`;
}
function updateIntersectionMenu() {
    const menu = el('junctionMenu');
    if (!menu)
        return;
    const n = network.nodes.find(n => n.id === selectedJunction && n.isJunction);
    if (!n || !['select', 'junctions', 'lanes'].includes(tool)) {
        menu.hidden = true;
        menu.innerHTML = '';
        return;
    }
    menu.hidden = false;
    const links = junctionRoads(network, n.id);
    const priority = new Set(['priority', 'signal'].includes(n.control.type) ? priorityApproaches(network, n.id) : []);
    menu.innerHTML = `<div class="popup-head"><b>Intersection controls</b><button data-menu="close" title="Close">×</button></div>
 <div class="popup-modes">${[['stop', '4-way stop'], ['priority', 'Priority'], ['signal', 'Signals'], ['yield', 'Yield']].map(([type, label]) => `<button class="${n.control.type === type ? 'active' : ''}" data-menu="type" data-value="${type}">${label}</button>`).join('')}</div>
 <div class="popup-subtitle">${n.control.type === 'signal' ? 'FIRST GREEN AXIS' : n.control.type === 'priority' ? 'PRIORITY APPROACHES' : 'CHOOSE AN APPROACH TO ENABLE PRIORITY'}</div>
 <div class="popup-arms">${links.map(a => `<button data-menu="road" data-road="${a.roadId}" class="${priority.has(a.roadId) ? 'priority' : ''}" title="Set ${a.roadId} as priority road"><span> ${priority.has(a.roadId) ? '★' : '↗'} ${a.roadId}</span><small>${a.incoming} in · ${a.outgoing} out</small></button>`).join('')}</div>
 <button class="popup-pick ${priorityPick ? 'active' : ''}" data-menu="pick">${priorityPick ? 'Now click a connected road…' : '↖ Pick priority road on map (P)'}</button>
 <div class="popup-footer">Changes apply to real right-of-way rules</div>`;
}
function placeIntersectionMenu() {
    const menu = el('junctionMenu');
    if (!menu || menu.hidden)
        return;
    const n = network.nodes.find(n => n.id === selectedJunction);
    if (!n)
        return;
    const screen = render.screenOf(n.x, n.y);
    const x = Math.max(190, Math.min(window.innerWidth - 295, screen.x + 22));
    const y = Math.max(64, Math.min(window.innerHeight - 310, screen.y - 38));
    const transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    if (menu.style.transform !== transform)
        menu.style.transform = transform;
}
el('junctionMenu')?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b)
        return;
    if (b.dataset.menu === 'close') {
        selectedJunction = null;
        selectedLane = null;
        priorityPick = false;
        updateInspector();
        render.invalidateMap();
    }
    if (b.dataset.menu === 'type')
        setJunctionControl(b.dataset.value);
    if (b.dataset.menu === 'road')
        setJunctionPriority(b.dataset.road);
    if (b.dataset.menu === 'pick') {
        priorityPick = !priorityPick;
        updateIntersectionMenu();
        toast(priorityPick ? 'Click the connected road to prioritize' : 'Priority selection cancelled');
    }
});
function intersectionInspector(n) {
    const lanes = new Map(network.lanes.map(l => [l.id, l]));
    const cs = junctionCandidates(n.id), active = cs.filter(c => c.allowed), intersection = network.intersections.find(x => x.id === n.id);
    const rows = n.incoming.map(id => {
        const l = lanes.get(id), options = cs.filter(c => c.from === id);
        if (!l)
            return '';
        const open = id === selectedLane || (!selectedLane && id === n.incoming[0]);
        const status = l.closed ? 'CLOSED' : options.some(c => c.allowed) ? `${options.filter(c => c.allowed).length} routes` : 'NO EXIT';
        const buttons = options.map(c => {
            const b = lanes.get(c.to), arrow = { straight: '↑', left: '↰', right: '↱', uturn: '↶' }[c.movement];
            return `<div class="connector-option"><span><i class="link-swatch" style="background:${c.allowed ? movementColor(intersection.movements.indexOf(c.id)) : '#9ba8a3'}"></i><b class="turn-icon">${arrow}</b>${c.movement} → ${b?.roadId || '?'} / lane ${(b?.index || 0) + 1}</span><button ${l.closed || b?.closed ? 'disabled' : ''} class="${c.allowed ? 'allowed' : 'blocked'}" data-link="${c.id}">${c.allowed ? 'ALLOW' : 'BLOCK'}</button></div>`;
        }).join('');
        return `<details class="lane-group" data-lane-group="${id}" ${open ? 'open' : ''}><summary><b class="approach-tag">${l.roadId}</b> inbound lane ${l.index + 1}/${l.count} <small class="${status === 'NO EXIT' ? 'warning' : ''}">${status}</small></summary><div class="lane-group-content"><div class="lane-actions"><button data-action="focusLane" data-lane="${id}">Highlight</button><button data-action="blockLane" data-lane="${id}">Block all turns</button><button data-action="resetLane" data-lane="${id}">Auto</button><button data-action="toggleClosed" data-lane="${id}">${l.closed ? 'Reopen lane' : 'Close lane'}</button></div>${buttons || '<p class="muted">No outbound lanes at this node.</p>'}</div></details>`;
    }).join('');
    const ctrl = n.control;
    const relationLinks = junctionRoads(network, n.id).map(a => `<button class="relation-button ${a.roadId === ctrl.priorityRoad ? 'priority' : ''}" data-action="focusRoad" data-road="${a.roadId}">${a.roadId} · ${a.incoming} in / ${a.outgoing} out</button>`).join('');
    const signalRoads = phase => [...new Set(n.incoming.filter(id => n.signalGroups?.[id] === phase).map(id => lanes.get(id)?.roadId).filter(Boolean))].join(', ') || 'none';
    return `<div class="info-box"><strong>Intersection ${Math.round(n.x)}, ${Math.round(n.y)}</strong> · elevation ${n.z} m<br>${intersection?.approaches.length || 0} arms · ${n.incoming.length} inbound · ${n.outgoing.length} outbound · ${active.length} active links</div>
 ${intersection?.deadInbound.length || intersection?.unusedOutbound.length ? `<p class="junction-warning">${intersection.deadInbound.length} inbound lane(s) have no permitted exit; ${intersection.unusedOutbound.length} outbound lane(s) have no incoming connection. These may be intentionally restricted.</p>` : '<p class="muted">All inbound lanes have a permitted continuation where possible.</p>'}
 <div class="panel-label" style="margin:13px 0 8px">CONNECTED ROADS</div><div class="relation-list">${relationLinks}</div><p class="muted">Click a road above to inspect it. Priority axis: ${['priority', 'signal'].includes(ctrl.type) ? (priorityApproaches(network, n.id).join(', ') || 'none') : 'not active'}. Use the on-map menu to change it.</p>
 <div class="panel-label" style="margin:13px 0 8px">ALL LANE MOVEMENTS</div>
 <p class="muted" style="margin:0 0 8px">Each permitted turn is drawn as its own solid colored path and directional arrow. Drag any colored endpoint handle within the highlighted junction to reshape its approach and all connected turns.</p>
 <div class="portal-controls">${[...n.incoming.map(id => ({ id, which: 'end', type: 'Incoming' })), ...n.outgoing.map(id => ({ id, which: 'start', type: 'Outgoing' }))].map(({ id, which, type }) => `<div class="portal-row"><span><b class="portal-swatch ${which}"></b>${type} ${id}</span><button data-action="resetPortal" data-portal="${id}" data-end="${which}" ${!portals[id]?.[which] ? 'disabled' : ''}>Reset</button></div>`).join('')}</div>
 <div class="junction-lanes">${rows}</div>
 <button class="inspector-action" data-action="resetJunction">Reset every movement to automatic</button>
 <div class="panel-label" style="margin:14px 0 8px">RIGHT OF WAY</div>
 ${ctrl.type === 'signal' ? `<div class="signal-key"><span><i class="signal-light a"></i>Phase A: ${signalRoads(0)}</span><span><i class="signal-light b"></i>Phase B: ${signalRoads(1)}</span></div><p class="muted">Each approach has its own three-lamp head on the map. The phase changes from green → yellow → all-red before the other phase begins.</p>` : ''}
 <div class="road-editor"><label>Intersection control<select id="editControl"><option value="stop" ${ctrl.type === 'stop' ? 'selected' : ''}>All-way stop</option><option value="priority" ${ctrl.type === 'priority' ? 'selected' : ''}>Main road priority</option><option value="signal" ${ctrl.type === 'signal' ? 'selected' : ''}>Two-phase traffic signal</option><option value="yield" ${ctrl.type === 'yield' ? 'selected' : ''}>Yield / uncontrolled</option><option value="free" ${ctrl.type === 'free' ? 'selected' : ''}>Free</option></select></label>
 <label>Priority / first green road<select id="editPriority">${n.roadIds.map(id => `<option value="${id}" ${id === ctrl.priorityRoad ? 'selected' : ''}>${id}</option>`).join('')}</select></label>
 <label>Signal cycle (seconds)<input id="editCycle" type="number" min="12" max="120" value="${ctrl.cycle}"></label></div>
 <button class="inspector-action" data-action="applyJunction">Apply intersection control</button>
 <p class="muted">Movements with separate collision-free paths can cross simultaneously. New vehicles wait before the stop line if their destination lane is full.</p>`;
}
function chooseNode(p) {
    const n = nodeAt(p);
    if (!n)
        return toast('Click the center of a road endpoint or junction', true);
    if (picking === 'source') {
        if (!n.outgoing.some(id => !network.lanes.find(l => l.id === id)?.closed))
            return toast('Source node needs an outgoing open lane', true);
    }
    else if (!n.incoming.some(id => !network.lanes.find(l => l.id === id)?.closed))
        return toast('Target node needs an incoming open lane', true);
    if (picking === 'source' && n.id === targetId || picking === 'target' && n.id === sourceId)
        return toast('Source and target must be different nodes', true);
    mark();
    const pair = activePair();
    if (picking === 'source') {
        pair.sourceId = n.id;
        picking = 'target';
    }
    else
        pair.targetId = n.id;
    commit();
    el('actionHint').textContent = picking === 'target' ? 'Now choose a destination node.' : 'Click any node to change the source.';
    if (sourceId && targetId && !currentRoute)
        toast('No legal route connects those nodes; change lane links', true);
}
function updateInspector() {
    const body = el('inspectorBody');
    updateIntersectionMenu();
    if (tool === 'select' && selectedVehicleId !== null) {
        el('inspectorTitle').textContent = 'Vehicle #' + selectedVehicleId;
        body.innerHTML = vehicleInspector();
        updateCarMetrics();
        return;
    }
    if ((tool === 'junctions' || tool === 'lanes' || tool === 'select') && selectedJunction) {
        const n = network.nodes.find(x => x.id === selectedJunction && x.isJunction);
        if (n) {
            el('inspectorTitle').textContent = 'Intersection lane manager';
            body.innerHTML = intersectionInspector(n);
            return;
        }
    }
    if (tool === 'lanes' || tool === 'junctions') {
        el('inspectorTitle').textContent = 'Intersection manager';
        body.innerHTML = '<p class="muted">Click any intersection pavement. Each legal turn has a unique solid color and direction arrow. Drag the amber incoming or teal outgoing lane endpoint handles to reshape turning paths. Configure splits, merges and right-of-way here.</p>';
        return;
    }
    if (tool === 'endpoints') {
        el('inspectorTitle').textContent = 'Trip origin & destination';
        body.innerHTML = '<p class="muted">Click a road endpoint or intersection center to set the highlighted source or destination. All cars travel between those nodes using legal directed lanes and enabled connectors.</p><button class="inspector-action" data-action="pickSource">Choose source</button><button class="inspector-action" data-action="pickTarget">Choose destination</button><div class="info-box">If the destination cannot be reached, the traffic spawner stays disabled. No random fallback destinations are used.</div>';
        return;
    }
    if (tool === 'select' && selectedRoad) {
        const r = roads.find(r => r.id === selectedRoad);
        if (r) {
            el('inspectorTitle').textContent = 'Road properties';
            body.innerHTML = `<div class="info-box"><strong>${r.kind.toUpperCase()}</strong> &nbsp; ${r.id}<br>Curved geometry · ${Math.round(dist(r.p0, r.p3))} m end-to-end</div><div class="panel-label" style="margin:12px 0 6px">CONNECTED INTERSECTIONS</div><div class="relation-list">${roadJunctions(network, r.id).map(j => `<button class="relation-button" data-action="focusJunction" data-junction="${j.nodeId}">${Math.round(j.x)}, ${Math.round(j.y)} · ${j.feeds} entering / ${j.receives} leaving</button>`).join('') || '<span class="muted">No at-grade junctions connected</span>'}</div><p class="muted">Entering lanes feed into the intersection; leaving lanes depart from it. Click to inspect the junction.</p><div class="road-editor" style="margin-top:12px"><label>Forward lanes<input id="editForward" type="number" min="0" max="6" value="${r.forward}"></label><label>Reverse lanes<input id="editBackward" type="number" min="0" max="6" value="${r.backward}"></label><label>Speed (km/h)<input id="editSpeed" type="number" min="10" max="160" value="${r.speed}"></label><label>Lane width (m)<input id="editWidth" type="number" min="2.5" max="5" step="0.1" value="${r.width}"></label><label>Start height (m)<select id="editZ0"><option value="-6" ${r.z0 === -6 ? 'selected' : ''}>−6 tunnel</option><option value="0" ${r.z0 === 0 ? 'selected' : ''}>0 ground</option><option value="6" ${r.z0 === 6 ? 'selected' : ''}>+6 bridge</option></select></label><label>End height (m)<select id="editZ1"><option value="-6" ${r.z1 === -6 ? 'selected' : ''}>−6 tunnel</option><option value="0" ${r.z1 === 0 ? 'selected' : ''}>0 ground</option><option value="6" ${r.z1 === 6 ? 'selected' : ''}>+6 bridge</option></select></label></div><button class="inspector-action" data-action="apply">Apply changes</button><button class="inspector-action danger" data-action="delete">Delete road</button>`;
            return;
        }
    }
    el('inspectorTitle').textContent = 'Network overview';
    body.innerHTML = `<p class="muted">Construct roads freely, compile lanes automatically, and analyze generated traffic.</p><div class="fact-grid"><div class="fact">ROADS<b>${roads.length}</b></div><div class="fact">JUNCTIONS<b>${network.nodes.filter(n => n.arms >= 3).length}</b></div><div class="fact">LANES<b>${network.lanes.length}</b></div><div class="fact">LINKS<b>${network.connectors.length}</b></div></div><div class="info-box"><strong>Engineering note:</strong> Different elevations never intersect. At-grade 3+ arm junctions currently use a simplified all-way stop.</div><button class="inspector-action" data-action="demo">Load sample network</button><button class="inspector-action danger" data-action="clear">Clear map</button>`;
}
function deleteRoad() { if (!selectedRoad)
    return; mark(); roads = roads.filter(r => r.id !== selectedRoad); selectedRoad = null; commit(); toast('Road deleted'); }
el('inspectorBody').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b)
        return;
    if (b.dataset.link)
        return toggleLink(b.dataset.link);
    switch (b.dataset.action) {
        case 'focusLane':
            focusLane(b.dataset.lane);
            break;
        case 'focusRoad':
            focusRoad(b.dataset.road);
            break;
        case 'focusJunction':
            focusJunction(b.dataset.junction);
            break;
        case 'clearVehicle':
            selectedVehicleId = null;
            selectedVehicleDetail = null;
            selectedVehicleRoute = null;
            send({ type: 'SELECT_VEHICLE', id: null });
            updateInspector();
            render.invalidateMap();
            break;
        case 'blockLane':
            bulkLaneLinks(b.dataset.lane, 'block');
            break;
        case 'resetLane':
            bulkLaneLinks(b.dataset.lane, 'reset');
            break;
        case 'resetJunction':
            resetIntersection();
            break;
        case 'resetPortal': {
            const id = b.dataset.portal, side = b.dataset.end;
            if (!portals[id]?.[side])
                break;
            mark();
            delete portals[id][side];
            if (!Object.keys(portals[id]).length)
                delete portals[id];
            commit();
            toast('Endpoint restored');
            break;
        }
        case 'toggleClosed':
            if (b.dataset.lane)
                selectedLane = b.dataset.lane;
            toggleClosedLane();
            break;
        case 'applyJunction': {
            if (!selectedJunction)
                return;
            mark();
            intersectionControls[selectedJunction] = { type: el('editControl').value, priorityRoad: el('editPriority').value, cycle: Number(el('editCycle').value) };
            commit();
            toast('Junction rules updated');
            break;
        }
        case 'pickSource':
            picking = 'source';
            setTool('endpoints');
            break;
        case 'pickTarget':
            picking = 'target';
            setTool('endpoints');
            break;
        case 'apply': {
            const r = roads.find(r => r.id === selectedRoad);
            if (!r)
                return;
            const f = Number(el('editForward').value), n = Number(el('editBackward').value);
            if (f + n < 1)
                return toast('A road must have at least one lane', true);
            mark();
            r.forward = clamp(Math.round(f), 0, 6);
            r.backward = clamp(Math.round(n), 0, 6);
            r.speed = clamp(Number(el('editSpeed').value) || 40, 10, 160);
            r.width = clamp(Number(el('editWidth').value) || 3.5, 2.5, 5);
            r.z0 = Number(el('editZ0').value);
            r.z1 = Number(el('editZ1').value);
            commit();
            toast('Lane network updated');
            break;
        }
        case 'delete':
            deleteRoad();
            break;
        case 'demo':
            mark();
            roads = example();
            blocked.clear();
            forced.clear();
            closed.clear();
            portals = {};
            intersectionControls = {};
            odPairs = [{ id: 'pair1', name: 'Pair 1', sourceId: 'j:-3500:0:0', targetId: 'j:3600:0:0', rate: .8, enabled: true, colorIndex: 0 }];
            activePairId = 'pair1';
            nextPairNumber = 1;
            selectedRoad = null;
            selectedLane = null;
            commit();
            toast('Sample road network loaded');
            break;
        case 'clear':
            mark();
            roads = [];
            blocked.clear();
            forced.clear();
            closed.clear();
            portals = {};
            intersectionControls = {};
            odPairs = [{ id: 'pair1', name: 'Pair 1', sourceId: null, targetId: null, rate: .8, enabled: true, colorIndex: 0 }];
            activePairId = 'pair1';
            nextPairNumber = 1;
            selectedRoad = null;
            selectedLane = null;
            commit();
            toast('Map cleared');
            break;
    }
});
// A portal is a true endpoint of an incoming or outgoing directed lane.
// Editing it also regenerates all connector splines touching that endpoint.
function portalAt(p, junctionId) {
    if (!junctionId)
        return null;
    let found = null, best = Math.max(2.5, 11 / render.zoom);
    for (const lane of network.lanes) {
        const which = lane.endNode === junctionId ? 'end' : lane.startNode === junctionId ? 'start' : null;
        if (!which)
            continue;
        const point = which === 'end' ? lane.points.at(-1) : lane.points[0], d = dist(p, point);
        if (d < best) {
            best = d;
            found = { laneId: lane.id, which, point };
        }
    }
    return found;
}
function updatePortalDrag(p) {
    if (!portalDrag)
        return;
    const entity = network.intersections.find(n => n.id === portalDrag.junctionId);
    if (!entity)
        return;
    const radius = entity.radius * 1.5, dx = p.x - entity.center.x, dy = p.y - entity.center.y, d = Math.hypot(dx, dy), scale = d > radius ? radius / d : 1;
    const point = { x: entity.center.x + dx * scale, y: entity.center.y + dy * scale };
    (portals[portalDrag.laneId] ??= {})[portalDrag.which] = point;
    // During dragging compile preview geometry only; do not reset the simulation worker.
    network = compileNetwork(roads, blocked, forced, closed, intersectionControls, portals);
    pathLookup = new Map(network.paths.map(p => [p.id, p]));
    render.invalidateGeometry();
}
function handleAt(p) { const r = roads.find(r => r.id === selectedRoad); if (!r)
    return null; for (const [name, point] of [['p0', r.p0], ['p3', r.p3], ['mid', cubic(r, .5)]])
    if (dist(p, point) < Math.max(3, 10 / render.zoom))
        return name; return null; }
canvas.addEventListener('contextmenu', e => { e.preventDefault(); phase = 'none'; start = end = null; el('actionHint').textContent = 'Placement cancelled.'; });
canvas.addEventListener('pointerdown', e => {
    if (![0, 1].includes(e.button))
        return;
    canvas.setPointerCapture(e.pointerId);
    pointer = render.worldOf(e.clientX, e.clientY);
    if (tool === 'pan' || e.button === 1 || panKey) {
        panStart = { screen: { x: e.clientX, y: e.clientY }, camera: { ...render.camera } };
        return;
    }
    if (['select', 'lanes', 'junctions'].includes(tool)) {
        const hit = portalAt(pointer, selectedJunction);
        if (hit) {
            mark();
            portalDrag = { ...hit, junctionId: selectedJunction, before: JSON.stringify(portals[hit.laneId]?.[hit.which] || null) };
            selectedLane = hit.laneId;
            render.invalidateMap();
            return;
        }
    }
    if (tool === 'select') {
        if (priorityPick && selectedJunction) {
            const chosen = roadAt(pointer);
            if (chosen) {
                setJunctionPriority(chosen.id);
                return;
            }
            toast('Click a connected road', true);
            return;
        }
        const car = vehicleAt(pointer);
        if (car) {
            selectVehicle(car.id);
            return;
        }
        dragging = handleAt(pointer);
        if (dragging && selectedRoad) {
            previousRoad = structuredClone(roads.find(r => r.id === selectedRoad));
            mark();
        }
        else if (!chooseIntersection(pointer)) {
            selectedRoad = roadAt(pointer)?.id || null;
            selectedJunction = null;
            selectedLane = null;
            render.invalidateMap();
            updateInspector();
        }
        return;
    }
    if (tool === 'lanes') {
        const connection = connectorAt(pointer);
        if (connection)
            return toggleLink(connection);
        const l = laneAt(pointer, selectedJunction);
        if (l) {
            focusLane(l);
            return;
        }
        chooseIntersection(pointer);
        return;
    }
    if (tool === 'endpoints') {
        chooseNode(pointer);
        return;
    }
    if (tool === 'junctions') {
        const l = laneAt(pointer, selectedJunction);
        if (l) {
            focusLane(l);
            return;
        }
        chooseIntersection(pointer);
        return;
    }
    if (PRESETS[tool])
        place(pointer, e.shiftKey);
});
canvas.addEventListener('pointermove', e => {
    pointer = render.worldOf(e.clientX, e.clientY);
    el('coordinateStat').textContent = `X ${Math.round(pointer.x)} m · Y ${Math.round(pointer.y)} m`;
    if (panStart) {
        render.camera.x = panStart.camera.x - (e.clientX - panStart.screen.x) / render.zoom;
        render.camera.y = panStart.camera.y - (e.clientY - panStart.screen.y) / render.zoom;
        return;
    }
    if (portalDrag) {
        if (performance.now() - previewLast > 45) {
            updatePortalDrag(pointer);
            previewLast = performance.now();
        }
        return;
    }
    if (dragging && selectedRoad) {
        const r = roads.find(r => r.id === selectedRoad);
        if (!r)
            return;
        const p = snap(pointer, dragging === 'p3' ? r.z1 : r.z0, e.shiftKey);
        if (dragging === 'mid')
            [r.p1, r.p2] = controlBend(r.p0, r.p3, p);
        else {
            const mid = cubic(previousRoad, .5);
            r[dragging] = p;
            [r.p1, r.p2] = controlBend(r.p0, r.p3, mid);
        }
        render.invalidateGeometry();
    }
});
canvas.addEventListener('pointerup', () => { if (portalDrag) {
    updatePortalDrag(pointer);
    const now = JSON.stringify(portals[portalDrag.laneId]?.[portalDrag.which] || null);
    if (now !== portalDrag.before)
        commit();
    else
        undoStack.pop();
    portalDrag = null;
} if (dragging) {
    const changed = JSON.stringify(previousRoad) !== JSON.stringify(roads.find(r => r.id === selectedRoad));
    if (changed)
        commit();
    else
        undoStack.pop();
    dragging = null;
    previousRoad = null;
} panStart = null; });
canvas.addEventListener('pointercancel', () => { if (portalDrag) {
    const { laneId, which, before } = portalDrag;
    if (before === 'null') {
        delete portals[laneId]?.[which];
        if (!Object.keys(portals[laneId] || {}).length)
            delete portals[laneId];
    }
    else
        (portals[laneId] ??= {})[which] = JSON.parse(before);
    undoStack.pop();
    network = compileNetwork(roads, blocked, forced, closed, intersectionControls, portals);
    render.invalidateGeometry();
    portalDrag = null;
} panStart = null; dragging = null; });
canvas.addEventListener('wheel', e => { e.preventDefault(); render.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * .0012)); }, { passive: false });
window.addEventListener('resize', () => render.resize());
window.addEventListener('keydown', e => {
    const editing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if (e.code === 'Space' && !editing) {
        panKey = true;
        e.preventDefault();
    }
    if (editing)
        return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
    }
    if (e.key === 'Escape') {
        phase = 'none';
        start = end = null;
        selectedLane = null;
        selectedJunction = null;
        selectedVehicleId = null;
        selectedVehicleDetail = null;
        selectedVehicleRoute = null;
        priorityPick = false;
        send({ type: 'SELECT_VEHICLE', id: null });
        render.invalidateMap();
        el('helpBackdrop').classList.add('hidden');
        updateInspector();
    }
    if (e.key.toLowerCase() === 'p' && selectedJunction) {
        priorityPick = !priorityPick;
        updateIntersectionMenu();
        toast(priorityPick ? 'Click the road to give it priority' : 'Priority selection cancelled');
    }
    if (e.key.toLowerCase() === 'v')
        setTool('select');
    if (e.key.toLowerCase() === 'g') {
        settings.grid = !settings.grid;
        el('gridToggle').checked = settings.grid;
    }
    if (e.key.toLowerCase() === 'c') {
        settings.curve = !settings.curve;
        el('curveToggle').checked = settings.curve;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && selectedRoad && tool === 'select')
        deleteRoad();
});
window.addEventListener('keyup', e => { if (e.code === 'Space')
    panKey = false; });
window.addEventListener('blur', () => { panKey = false; panStart = null; });
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
el('gridToggle').onchange = e => settings.grid = e.target.checked;
el('snapToggle').onchange = e => settings.snap = e.target.checked;
el('curveToggle').onchange = e => settings.curve = e.target.checked;
el('fromElevation').onchange = e => settings.z0 = Number(e.target.value);
el('toElevation').onchange = e => settings.z1 = Number(e.target.value);
el('debugToggle').onchange = e => { debug = e.target.checked; render.invalidateMap(); };
el('qualitySelect').onchange = e => { settings.quality = e.target.value; render.setQuality(settings.quality); };
for (const [id, key] of [['headway', 'headway'], ['minGap', 'gap'], ['startDelay', 'startDelay']])
    el(id).addEventListener('input', e => { settings[key] = Number(e.target.value); sliderLabels(); send({ type: 'SET_SETTINGS', headway: settings.headway, gap: settings.gap, startDelay: settings.startDelay }); });
el('spawnRate').oninput = e => { settings.spawnRate = Number(e.target.value); const pair = activePair(); if (pair) {
    pair.rate = settings.spawnRate;
    send({ type: 'SET_PAIR_RATES', pairs: odPairs });
} sliderLabels(); updatePairPanel(); persist(); };
el('spawnBtn').onclick = () => { if (!currentRoute)
    return toast('Choose a reachable source and destination first', true); send({ type: 'SPAWN', pairId: activePairId, count: 25 }); };
for (const role of ['Source', 'Target'])
    el('pick' + role).onclick = () => { picking = role.toLowerCase(); setTool('endpoints'); };
el('runPause').onclick = () => { paused = !paused; send({ type: 'SET_RUNNING', running: !paused }); el('runPause').textContent = paused ? '▶' : 'Ⅱ'; };
document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { settings.simSpeed = Number(b.dataset.speed); send({ type: 'SET_SPEED', speed: settings.simSpeed }); document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('active', x === b)); });
el('saveBtn').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(asSave(), null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'traffic-sketch-map.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Saved map JSON'); };
el('loadBtn').onclick = () => el('fileInput').click();
el('fileInput').onchange = async (e) => { const f = e.target.files?.[0]; if (!f)
    return; try {
    loadData(JSON.parse(await f.text()));
}
catch (err) {
    toast(err.message, true);
} e.target.value = ''; };
el('helpBtn').onclick = () => el('helpBackdrop').classList.remove('hidden');
for (const id of ['helpClose', 'helpOk'])
    el(id).onclick = () => el('helpBackdrop').classList.add('hidden');
el('helpBackdrop').onclick = e => { if (e.target === el('helpBackdrop'))
    el('helpBackdrop').classList.add('hidden'); };
// Each pair is independent and can be assigned a different source, target and demand.
el('addPair').onclick = () => {
    if (odPairs.length >= 80)
        return toast('Maximum of 80 traffic pairs', true);
    mark();
    const id = 'pair' + (++nextPairNumber);
    odPairs.push({ id, name: 'Pair ' + nextPairNumber, sourceId: null, targetId: null, rate: .8, enabled: true, colorIndex: nextPairNumber - 1 });
    activePairId = id;
    commit();
    setTool('endpoints');
    picking = 'source';
    updatePairPanel();
    toast('Choose the new pair origin');
};
el('pairList').addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button)
        return;
    const id = button.dataset.pairSelect || button.dataset.pairRemove;
    if (button.dataset.pairSelect) {
        activePairId = id;
        syncActivePair();
        updatePairPanel();
        render.invalidateMap();
        return;
    }
    if (button.dataset.pairRemove) {
        if (odPairs.length <= 1)
            return;
        mark();
        odPairs = odPairs.filter(p => p.id !== id);
        if (activePairId === id)
            activePairId = odPairs[0].id;
        commit();
    }
});
el('pairList').addEventListener('change', e => {
    const id = e.target.dataset.pairRate || e.target.dataset.pairEnable;
    if (!id)
        return;
    const pair = odPairs.find(p => p.id === id);
    if (!pair)
        return;
    mark();
    if (e.target.dataset.pairRate) {
        pair.rate = clamp(Number(e.target.value) || 0, 0, 8);
    }
    else
        pair.enabled = e.target.checked;
    send({ type: 'SET_PAIR_RATES', pairs: odPairs });
    syncActivePair();
    updatePairPanel();
    persist();
});
el('pairName').addEventListener('change', e => {
    const pair = activePair();
    if (!pair)
        return;
    const name = String(e.target.value).trim().slice(0, 32) || pair.name;
    if (name !== pair.name) {
        mark();
        pair.name = name;
        updatePairPanel();
        persist();
    }
});
worker.onmessage = e => {
    const m = e.data;
    if (m.type !== 'SNAPSHOT')
        return;
    last = { received: performance.now(), vehicles: m.vehicles };
    if (selectedVehicleId !== null) {
        const detail = m.selectedVehicle;
        if (detail?.id === selectedVehicleId) {
            selectedVehicleDetail = detail;
            const key = detail.route.join('|');
            if (!selectedVehicleRoute || selectedVehicleRoute.key !== key) {
                selectedVehicleRoute = { key, ids: detail.route };
                render.invalidateMap();
            }
            if (performance.now() - lastCarPanel > 200) {
                if (!el('carSpeed'))
                    updateInspector();
                else
                    updateCarMetrics();
                lastCarPanel = performance.now();
            }
        }
        else if (!m.vehicles.some(v => v.id === selectedVehicleId)) {
            selectedVehicleId = null;
            selectedVehicleDetail = null;
            selectedVehicleRoute = null;
            updateInspector();
            render.invalidateMap();
        }
    }
    const s = m.stats;
    simTime = s.simTime;
    el('activeStat').textContent = s.active.toLocaleString();
    el('speedStat').innerHTML = s.averageSpeed.toFixed(1) + ' <span>km/h</span>';
    el('tripsStat').textContent = s.completed.toLocaleString();
    el('crossStat').textContent = String(s.passedJunctions || 0);
    el('delayStat').textContent = (s.averageVehicleDelay || 0).toFixed(1) + ' s';
    el('stoppedStat').textContent = s.queued;
    el('pendingStat').textContent = s.pendingDemand.toLocaleString();
    el('timeStat').textContent = s.completed ? format(s.averageTripTime) : '—';
    el('updateStat').textContent = s.updateMs.toFixed(1) + ' ms';
    el('simClock').textContent = format(s.simTime);
};
worker.onerror = e => { console.error(e); toast('Simulation worker error: ' + e.message, true); };
let fpsFrames = 0, fpsLast = performance.now(), simTime = 0;
function frame() {
    const age = paused ? 0 : Math.min(.095, Math.max(0, (performance.now() - last.received) / 1000)) * settings.simSpeed;
    render.render({ roads, network, tool, selectedRoad, selectedLane, selectedJunction, selectedVehicleId, selectedVehicleRoute, sourceId, targetId, odPairs, activePairId, picking, route: currentRoute, phase, start, end, pointer, grid: settings.grid, debug, vehicles: last.vehicles, age, simTime, paused });
    placeIntersectionMenu();
    const zoomText = Math.round(render.zoom * 100) + '%';
    if (el('zoomText').textContent !== zoomText)
        el('zoomText').textContent = zoomText;
    fpsFrames++;
    const fpsNow = performance.now();
    if (fpsNow - fpsLast > 1000) {
        el('fpsStat').textContent = Math.round(fpsFrames * 1000 / (fpsNow - fpsLast));
        fpsFrames = 0;
        fpsLast = fpsNow;
    }
    requestAnimationFrame(frame);
}
try {
    const raw = localStorage.getItem('traffic-sketch-autosave'), save = raw && JSON.parse(raw);
    if ([1, 2, 3, 4].includes(save?.version) && Array.isArray(save.roads) && save.roads.every(validRoad)) {
        roads = save.roads;
        blocked = new Set(save.blocked || []);
        forced = new Set(save.forced || []);
        closed = new Set(save.closed || []);
        portals = save.portals || {};
        intersectionControls = save.intersectionControls || {};
        settings = { ...defaults, ...save.settings };
        setPairsFromData(save);
        idCount = Math.max(0, ...roads.map(r => Number(r.id.slice(1)) || 0));
    }
    else {
        roads = example();
        odPairs = [{ id: 'pair1', name: 'Pair 1', sourceId: 'j:-3500:0:0', targetId: 'j:3600:0:0', rate: .8, enabled: true, colorIndex: 0 }];
    }
}
catch {
    roads = example();
    odPairs = [{ id: 'pair1', name: 'Pair 1', sourceId: 'j:-3500:0:0', targetId: 'j:3600:0:0', rate: .8, enabled: true, colorIndex: 0 }];
}
syncUI();
setTool('select');
rebuild();
requestAnimationFrame(frame);
