// @ts-nocheck
import { add, sub, mul, clamp, cubic, offset, dist, samples, nearestSeg, intersect, metrics, unit, cross, dot, at } from './geometry.js';
export const PRESETS = {
    street: { forward: 1, backward: 1, width: 3.5, speed: 40 },
    avenue: { forward: 2, backward: 2, width: 3.5, speed: 60 },
    oneway: { forward: 2, backward: 0, width: 3.5, speed: 60 },
    highway: { forward: 3, backward: 3, width: 3.6, speed: 100 }
};
const elev = (r, t) => r.z0 + (r.z1 - r.z0) * t;
const nearly = (a, b) => Math.abs(a - b) < 1e-7;
const direction = p => unit(sub(p.points.at(-1), p.points.at(-2)));
const startDirection = p => unit(sub(p.points[1], p.points[0]));
export function configureJunction(node, override = {}, incoming = [], outgoing = []) {
 const types = ['stop', 'priority', 'signal', 'yield', 'free'];
 const type = types.includes(override.type) ? override.type : (node.arms >= 3 ? 'stop' : 'free');
 const priorityRoad = node.roadIds.includes(override.priorityRoad) ? override.priorityRoad : node.roadIds[0];
 node.control = {type, priorityRoad, cycle: clamp(Number(override.cycle) || 28, 12, 120)};
 node.signalGroups = {};
 if (node.intersection) node.intersection.control = node.control;
 if (!node.isJunction || !['signal', 'priority'].includes(type)) return;

 // Separately drawn but opposing approaches share a phase.
 const seed = incoming.find(lane => lane.roadId === priorityRoad) ||
              outgoing.find(lane => lane.roadId === priorityRoad);
 const axis = seed ? (seed.endNode === node.id ? direction(seed) : startDirection(seed)) : {x:1, y:0};
 for (const lane of incoming) {
  node.signalGroups[lane.id] = Math.abs(dot(axis, direction(lane))) >= .75 ? 0 : 1;
 }
}
const junctionId = (p, z) => `j:${Math.round(p.x * 10)}:${Math.round(p.y * 10)}:${Math.round(z * 10)}`;
function closestToPolyline(p, list) {
    let best = { d: Infinity, t: 0, p };
    for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i], x = nearestSeg(p, a.p, b.p);
        if (x.d < best.d)
            best = { d: x.d, t: a.t + (b.t - a.t) * x.t, p: x.p };
    }
    return best;
}
function trimPosition(raw, node, fromStart) {
    if (!node?.isJunction)
        return fromStart ? 0 : raw.length;
    const pts = raw.points;
    // Locate the first intersection with the junction's circular clearance area.
    if (fromStart) {
        for (let i = 1; i < pts.length; i++)
            if (dist(pts[i], node) < node.radius - 1e-6)
                continue;
            else {
                const prev = dist(pts[i - 1], node), next = dist(pts[i], node);
                if (prev >= node.radius)
                    return 0;
                const f = clamp((node.radius - prev) / Math.max(.000001, next - prev), 0, 1);
                return raw.cumulative[i - 1] + (raw.cumulative[i] - raw.cumulative[i - 1]) * f;
            }
        return raw.length;
    }
    for (let i = pts.length - 2; i >= 0; i--) {
        const d0 = dist(pts[i], node), d1 = dist(pts[i + 1], node);
        if (d0 >= node.radius) {
            const f = clamp((d0 - node.radius) / Math.max(.000001, d0 - d1), 0, 1);
            return raw.cumulative[i] + (raw.cumulative[i + 1] - raw.cumulative[i]) * f;
        }
    }
    return 0;
}
function trimLane(points, start, end) {
    const raw = { points, ...metrics(points) };
    let a = trimPosition(raw, start, true), b = trimPosition(raw, end, false);
    a = clamp(a, 0, raw.length * .43);
    b = clamp(b, raw.length * .57, raw.length);
    if (b - a < 1) {
        a = raw.length * .44;
        b = raw.length * .56;
    }
    const out = [at(raw, a).point];
    for (let i = 1; i < points.length - 1; i++)
        if (raw.cumulative[i] > a + 1e-5 && raw.cumulative[i] < b - 1e-5)
            out.push(points[i]);
    out.push(at(raw, b).point);
    return out;
}
/** Bend the last few metres of a generated lane to a user-positioned junction
 * portal. The shared portal is the exact endpoint used by all turning links.
 * Untouched sections of the lane remain on the automatically generated road.
 */
function reshapePortal(points, point, atStart) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || points.length < 2)
        return points;
    const backward = atStart ? [...points].reverse() : points;
    const raw = { points: backward, ...metrics(backward) };
    const span = Math.min(24, raw.length * .38);
    if (span < .01)
        return points;
    const location = Math.max(0, raw.length - span), anchor = at(raw, location).point;
    const before = at(raw, Math.max(0, location - 1.5)).point;
    const orig = unit(sub(anchor, before));
    const travel = unit(sub(point, anchor));
    const finish = unit(add(mul(orig, .8), mul(travel, .2)));
    const d = dist(anchor, point), h = Math.max(.2, d * .36);
    const p1 = add(anchor, mul(orig, h)), p2 = sub(point, mul(finish, h));
    const prefix = [...backward.filter((_, i) => raw.cumulative[i] < location - 1e-5), anchor];
    for (let i = 1; i <= 14; i++) {
        const t = i / 14, k = 1 - t;
        prefix.push(add(add(mul(anchor, k * k * k), mul(p1, 3 * k * k * t)), add(mul(p2, 3 * k * t * t), mul(point, t * t * t))));
    }
    return atStart ? prefix.reverse() : prefix;
}
function buildConnector(a, b, node) {
    const p0 = a.points.at(-1), p3 = b.points[0], di = direction(a), dj = startDirection(b);
    const turn = Math.atan2(cross(di, dj), dot(di, dj));
    const d = dist(p0, p3), h = clamp(d * .38, 1.5, Math.max(3, d * .7));
    const p1 = add(p0, mul(di, h)), p2 = sub(p3, mul(dj, h));
    const n = clamp(Math.ceil(d / 1.4), 12, 60);
    const points = Array.from({ length: n + 1 }, (_, i) => { const t = i / n, k = 1 - t; return add(add(mul(p0, k * k * k), mul(p1, 3 * k * k * t)), add(mul(p2, 3 * k * t * t), mul(p3, t * t * t))); });
    const ab = Math.abs(turn), movement = ab > 2.55 ? 'uturn' : ab < .48 ? 'straight' : turn > 0 ? 'right' : 'left';
    const turnSpeed = movement === 'straight' ? 100 : movement === 'uturn' ? 5 : movement === 'right' ? 9 : 11;
    return { id: `${a.id}->${b.id}`, kind: 'connector', nodeId: node.id, from: a.id, to: b.id, turn, movement,
        points, ...metrics(points), speed: Math.min(a.speed, b.speed, turnSpeed), allowed: false, defaultAllowed: false, candidate: true };
}
function defaultMovement(a, b, c) {
    // An ordinary road continuation always retains its matching lane.
    if (c.movement === 'uturn')
        return false;
    if (a.roadId === b.roadId && a.direction !== b.direction)
        return false;
    if (a.sectionId === b.sectionId)
        return false;
    if (a.roadId === b.roadId && a.direction === b.direction) {
        return b.index === Math.min(b.count - 1, Math.round(a.index * (b.count - 1) / Math.max(1, a.count - 1)));
    }
    if (c.movement === 'straight') {
        // For lane drops/additions, automatically cover all outgoing AND incoming lanes.
        const aToB = Math.round(a.index * (b.count - 1) / Math.max(1, a.count - 1));
        const bToA = Math.round(b.index * (a.count - 1) / Math.max(1, b.count - 1));
        return a.index === bToA || b.index === aToB;
    }
    if (c.movement === 'right')
        return a.index === a.count - 1 && b.index === b.count - 1;
    if (c.movement === 'left')
        return a.index === 0 && b.index === 0;
    return false;
}
/** Convex paved footprint enclosing every active lane movement and approach portal.
 * Geometry is generated from the same lane endpoints used by the route graph;
 * the renderer never invents phantom interior lanes.
 */
function convexHull(points) {
    const sorted = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        .sort((a, b) => a.x - b.x || a.y - b.y);
    if (sorted.length < 3)
        return sorted;
    const half = arr => { const out = []; for (const p of arr) {
        while (out.length > 1 && cross(sub(out.at(-1), out.at(-2)), sub(p, out.at(-1))) <= 0)
            out.pop();
        out.push(p);
    } return out; };
    const lo = half(sorted), hi = half([...sorted].reverse());
    lo.pop();
    hi.pop();
    return [...lo, ...hi];
}
function intersectionEntity(node, inbound, outbound, localCandidates, roadMap) {
    const groups = new Map();
    const addToGroup = (lane, direction) => {
        if (!groups.has(lane.sectionId))
            groups.set(lane.sectionId, { sectionId: lane.sectionId, roadId: lane.roadId, incoming: [], outgoing: [] });
        groups.get(lane.sectionId)[direction].push(lane.id);
    };
    for (const l of inbound)
        addToGroup(l, 'incoming');
    for (const l of outbound)
        addToGroup(l, 'outgoing');
    const laneById = new Map([...inbound, ...outbound].map(l => [l.id, l]));
    const approach = [...groups.values()].map(g => {
        const all = [...g.incoming, ...g.outgoing].map(id => laneById.get(id));
        const edge = all.map(l => l.endNode === node.id ? l.points.at(-1) : l.points[0]);
        const mid = edge.reduce((sum, p) => add(sum, p), { x: 0, y: 0 });
        const center = mul(mid, 1 / Math.max(1, edge.length));
        return { ...g, portal: center, width: (roadMap.get(g.roadId)?.width || 3.5) * Math.max(1, all.length) };
    });
    // Continuous paved surface: expands to all actual approach ends and active
    // curves. The physical footprint and network movements share exact geometry.
    const polygon = [{ x: node.x, y: node.y }];
    for (const l of [...inbound, ...outbound]) {
        const p = l.endNode === node.id ? l.points.at(-1) : l.points[0];
        const tangent = l.endNode === node.id ? direction(l) : startDirection(l);
        const side = { x: -tangent.y, y: tangent.x }, half = (roadMap.get(l.roadId)?.width || 3.5) * .54;
        polygon.push(add(p, mul(side, half)), sub(p, mul(side, half)), p);
    }
    for (const c of localCandidates)
        if (c.allowed) {
            // Bound the paved surface around the actual swept turning geometry.
            const width = (roadMap.get(laneById.get(c.from)?.roadId)?.width || 3.5) * .52;
            for (let i = 0; i < c.points.length; i += Math.max(1, Math.floor(c.points.length / 9))) {
                const a = c.points[Math.max(0, i - 1)], b = c.points[Math.min(c.points.length - 1, i + 1)], v = unit(sub(b, a)), side = { x: -v.y, y: v.x };
                polygon.push(add(c.points[i], mul(side, width)), sub(c.points[i], mul(side, width)));
            }
        }
    const surface = convexHull(polygon);
    const deadInbound = inbound.filter(l => !l.closed && !localCandidates.some(c => c.allowed && c.from === l.id)).map(l => l.id);
    const unusedOutbound = outbound.filter(l => !l.closed && !localCandidates.some(c => c.allowed && c.to === l.id)).map(l => l.id);
    return { id: node.id, nodeId: node.id, center: { x: node.x, y: node.y }, z: node.z,
        radius: node.radius, polygon: surface, approaches: approach,
        incoming: inbound.map(l => l.id), outgoing: outbound.map(l => l.id),
        movements: localCandidates.map(c => c.id), activeMovements: localCandidates.filter(c => c.allowed).map(c => c.id),
        deadInbound, unusedOutbound, control: node.control };
}
/** Compile centerline Bézier roads to an elevation-aware, directed lane graph.
 * Junctions trim approaching lanes; vehicles cross them only on explicit connectors.
 * Overrides operate on lane IDs; closed lanes can never be routed into or out of.
 */
export function compileNetwork(roads, blockedInput = [], forcedInput = [], closedInput = [], controlInput = {}, portalInput = {}) {
    const blocked = new Set(blockedInput), forced = new Set(forcedInput), closed = new Set(closedInput);
    const cuts = new Map(), sampleMap = new Map(), bounds = new Map(), nodes = [], lanes = [], connectors = [], candidates = [], warnings = [];
    for (const r of roads) {
        cuts.set(r.id, [{ t: 0, p: r.p0, z: r.z0 }, { t: 1, p: r.p3, z: r.z1 }]);
        const d = dist(r.p0, r.p1) + dist(r.p1, r.p2) + dist(r.p2, r.p3);
        const pts = samples(r, clamp(Math.ceil(d / 3), 30, 280));
        sampleMap.set(r.id, pts);
        bounds.set(r.id, { minX: Math.min(...pts.map(x => x.p.x)), maxX: Math.max(...pts.map(x => x.p.x)),
            minY: Math.min(...pts.map(x => x.p.y)), maxY: Math.max(...pts.map(x => x.p.y)) });
    }
    for (let i = 0; i < roads.length; i++)
        for (let j = i + 1; j < roads.length; j++) {
            const a = roads[i], b = roads[j], as = sampleMap.get(a.id), bs = sampleMap.get(b.id);
            const ba = bounds.get(a.id), bb = bounds.get(b.id);
            if (ba.maxX + 2 < bb.minX || bb.maxX + 2 < ba.minX || ba.maxY + 2 < bb.minY || bb.maxY + 2 < ba.minY)
                continue;
            if (Math.max(a.z0, a.z1) + 1.2 < Math.min(b.z0, b.z1) || Math.max(b.z0, b.z1) + 1.2 < Math.min(a.z0, a.z1))
                continue;
            for (let m = 1; m < as.length; m++)
                for (let n = 1; n < bs.length; n++) {
                    const q = intersect(as[m - 1].p, as[m].p, bs[n - 1].p, bs[n].p);
                    if (!q)
                        continue;
                    const ta = as[m - 1].t + (as[m].t - as[m - 1].t) * q.ta, tb = bs[n - 1].t + (bs[n].t - bs[n - 1].t) * q.tb;
                    if (Math.abs(elev(a, ta) - elev(b, tb)) > 1.2)
                        continue;
                    cuts.get(a.id).push({ t: ta, p: q.p, z: elev(a, ta) });
                    cuts.get(b.id).push({ t: tb, p: q.p, z: elev(b, tb) });
                }
            // Endpoint-to-interior connections create valid T junctions.
            for (const [r, other, ss] of [[a, b, bs], [b, a, as]])
                for (const t of [0, 1]) {
                    const p = cubic(r, t), q = closestToPolyline(p, ss);
                    if (q.d < 1.6 && Math.abs(elev(r, t) - elev(other, q.t)) < 1.2) {
                        cuts.get(r.id).push({ t, p, z: elev(r, t) });
                        cuts.get(other.id).push({ t: q.t, p: q.p, z: elev(other, q.t) });
                    }
                }
        }
    const cutsByRoad = new Map(), sections = new Map();
    for (const r of roads) {
        const sorted = cuts.get(r.id).sort((a, b) => a.t - b.t), filtered = [];
        for (const c of sorted)
            if (!filtered.length || c.t - filtered.at(-1).t > .0025)
                filtered.push(c);
        for (const c of filtered) {
            let node = nodes.find(n => Math.abs(n.z - c.z) < 1.2 && dist(n, c.p) < 1.75);
            if (!node) {
                node = { id: junctionId(c.p, c.z), x: c.p.x, y: c.p.y, z: c.z, arms: 0, roadIds: [], radius: 0, isJunction: false };
                nodes.push(node);
            }
            c.nodeId = node.id;
        }
        cutsByRoad.set(r.id, filtered);
        for (let i = 0; i < filtered.length - 1; i++) {
            const a = filtered[i], b = filtered[i + 1];
            if (dist(cubic(r, a.t), cubic(r, b.t)) < 1.5) {
                warnings.push('Very short road section on ' + r.id);
                continue;
            }
            const sectionId = r.id + ':s' + i;
            for (const nodeId of [a.nodeId, b.nodeId]) {
                if (!sections.has(nodeId))
                    sections.set(nodeId, new Set());
                sections.get(nodeId).add(sectionId);
            }
        }
    }
    const roadMap = new Map(roads.map(r => [r.id, r]));
    for (const n of nodes) {
        const touches = roads.filter(r => cutsByRoad.get(r.id).some(c => c.nodeId === n.id));
        n.roadIds = touches.map(r => r.id);
        n.arms = sections.get(n.id)?.size || 0;
        n.isJunction = n.arms >= 3 || (n.arms >= 2 && n.roadIds.length >= 2);
        // Radius covers the complete road cross-section, preserving a continuous paved surface.
        const w = Math.max(0, ...touches.map(r => r.width * Math.max(r.forward, r.backward)));
        n.radius = n.isJunction ? clamp(w + 2.5, 6, 31) : 0;
    }
    const nodesById = new Map(nodes.map(n => [n.id, n]));
    for (const r of roads) {
        const cutList = cutsByRoad.get(r.id);
        for (let i = 0; i < cutList.length - 1; i++) {
            const a = cutList[i], b = cutList[i + 1];
            if (dist(cubic(r, a.t), cubic(r, b.t)) < 1.5)
                continue;
            const sectionId = r.id + ':s' + i;
            const steps = clamp(Math.ceil((b.t - a.t) * (sampleMap.get(r.id).length - 1) * 1.3), 12, 320);
            for (const dr of [1, -1]) {
                const count = dr === 1 ? r.forward : r.backward;
                for (let index = 0; index < count; index++) {
                    const pts = Array.from({ length: steps + 1 }, (_, j) => offset(r, (dr === 1 ? a.t : b.t) + dr * (b.t - a.t) * j / steps, dr * r.width * (index + .5)));
                    const startNode = dr === 1 ? a.nodeId : b.nodeId, endNode = dr === 1 ? b.nodeId : a.nodeId;
                    const laneId = `${sectionId}:${dr === 1 ? 'f' : 'b'}${index}`;
                    const override = portalInput[laneId] || {};
                    let points = trimLane(pts, nodesById.get(startNode), nodesById.get(endNode));
                    // Every connector still attaches at the actual, possibly edited portal.
                    if (nodesById.get(startNode)?.isJunction)
                        points = reshapePortal(points, override.start, true);
                    if (nodesById.get(endNode)?.isJunction)
                        points = reshapePortal(points, override.end, false);
                    const l = { id: laneId, kind: 'lane', roadId: r.id, sectionId, direction: dr, index, count,
                        points, ...metrics(points), speed: r.speed / 3.6, startNode, endNode, closed: false,
                        portalEdited: !!((override.start && nodesById.get(startNode)?.isJunction) || (override.end && nodesById.get(endNode)?.isJunction)) };
                    l.closed = closed.has(l.id);
                    lanes.push(l);
                }
            }
        }
    }
    const incoming = new Map(), outgoing = new Map();
    for (const l of lanes) {
        if (!incoming.has(l.endNode))
            incoming.set(l.endNode, []);
        if (!outgoing.has(l.startNode))
            outgoing.set(l.startNode, []);
        incoming.get(l.endNode).push(l);
        outgoing.get(l.startNode).push(l);
    }
    for (const n of nodes) {
        n.incoming = (incoming.get(n.id) || []).map(l => l.id);
        configureJunction(n, controlInput[n.id] || {}, incoming.get(n.id), outgoing.get(n.id));
        n.outgoing = (outgoing.get(n.id) || []).map(l => l.id);
        for (const a of incoming.get(n.id) || [])
            for (const b of outgoing.get(n.id) || []) {
                if (a.id === b.id)
                    continue;
                const c = buildConnector(a, b, n);
                c.defaultAllowed = defaultMovement(a, b, c);
                candidates.push(c);
            }
    }
    // Complete default lane coverage at junctions. Three-lane approaches at a T,
    // or roads that change lane count, must not silently generate orphan lanes.
    // Do this BEFORE user overrides: an intentionally blocked movement stays blocked.
    const byLane = new Map(lanes.map(l => [l.id, l]));
    const permittedFallback = c => c.movement !== 'uturn' && !byLane.get(c.from)?.closed && !byLane.get(c.to)?.closed;
    const normalizedIndex = l => l.count === 1 ? .5 : l.index / (l.count - 1);
    const cost = c => {
        const a = byLane.get(c.from), b = byLane.get(c.to);
        return Math.abs(c.turn) * 10 + Math.abs(normalizedIndex(a) - normalizedIndex(b)) * 1.5 +
            (c.movement === 'right' ? 0 : .08);
    };
    for (const n of nodes) {
        const local = candidates.filter(c => c.nodeId === n.id && permittedFallback(c));
        for (const l of (incoming.get(n.id) || []).filter(l => !l.closed)) {
            if (local.some(c => c.from === l.id && c.defaultAllowed))
                continue;
            const best = local.filter(c => c.from === l.id).sort((a, b) => cost(a) - cost(b))[0];
            if (best)
                best.defaultAllowed = true;
        }
        for (const l of (outgoing.get(n.id) || []).filter(l => !l.closed)) {
            if (local.some(c => c.to === l.id && c.defaultAllowed))
                continue;
            const best = local.filter(c => c.to === l.id).sort((a, b) => cost(a) - cost(b))[0];
            if (best)
                best.defaultAllowed = true;
        }
    }
    for (const c of candidates) {
        const a = byLane.get(c.from), b = byLane.get(c.to);
        c.allowed = !a.closed && !b.closed && ((c.defaultAllowed && !blocked.has(c.id)) || forced.has(c.id));
        if (c.allowed)
            connectors.push(c);
    }
    // Precompute movement conflict geometry once when the network is edited.
    // Different entrances may traverse the junction at the same time only if
    // vehicle-width corridors have adequate separation. Their source/target
    // lanes are included in conflict checks, preventing unsafe merges.
    const nearPaths = (a, b, limit = 3.15) => {
        const aBox = { minX: Math.min(...a.points.map(p => p.x)), maxX: Math.max(...a.points.map(p => p.x)), minY: Math.min(...a.points.map(p => p.y)), maxY: Math.max(...a.points.map(p => p.y)) };
        const bBox = { minX: Math.min(...b.points.map(p => p.x)), maxX: Math.max(...b.points.map(p => p.x)), minY: Math.min(...b.points.map(p => p.y)), maxY: Math.max(...b.points.map(p => p.y)) };
        if (aBox.maxX + limit < bBox.minX || bBox.maxX + limit < aBox.minX || aBox.maxY + limit < bBox.minY || bBox.maxY + limit < aBox.minY)
            return false;
        for (let i = 1; i < a.points.length; i++)
            for (let j = 1; j < b.points.length; j++) {
                const a0 = a.points[i - 1], a1 = a.points[i], b0 = b.points[j - 1], b1 = b.points[j];
                if (intersect(a0, a1, b0, b1) || nearestSeg(a0, b0, b1).d < limit || nearestSeg(a1, b0, b1).d < limit || nearestSeg(b0, a0, a1).d < limit || nearestSeg(b1, a0, a1).d < limit)
                    return true;
            }
        return false;
    };
    for (const c of connectors)
        c.conflicts = [];
    const movementsByNode = new Map();
    for (const c of connectors) {
        if (!movementsByNode.has(c.nodeId))
            movementsByNode.set(c.nodeId, []);
        movementsByNode.get(c.nodeId).push(c);
    }
    for (const local of movementsByNode.values())
        for (let i = 0; i < local.length; i++)
            for (let j = i + 1; j < local.length; j++) {
                const a = local[i], b = local[j];
                if (a.from === b.from || a.to === b.to || nearPaths(a, b)) {
                    a.conflicts.push(b.id);
                    b.conflicts.push(a.id);
                }
            }
    const intersections = [];
    for (const n of nodes)
        if (n.isJunction) {
            const entity = intersectionEntity(n, incoming.get(n.id) || [], outgoing.get(n.id) || [], candidates.filter(c => c.nodeId === n.id), roadMap);
            n.intersection = entity;
            intersections.push(entity);
            if (entity.deadInbound.length)
                warnings.push(`${entity.deadInbound.length} incoming lanes have no exit at ${n.id} (possibly intentionally blocked)`);
        }
    const paths = [...lanes, ...connectors];
    return { nodes, intersections, lanes, connectors, candidates, paths, allowedKeys: connectors.map(c => c.id), warnings };
}
/** Deterministic fastest legal route from a selected source node to a target node.
 * No random endpoints, implicit reverse driving, or U-turn unless explicitly enabled.
 */
function heapPush(heap, item) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent][0] <= item[0])
            break;
        heap[i] = heap[parent];
        i = parent;
    }
    heap[i] = item;
}
function heapPop(heap) {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
            let j = i * 2 + 1;
            if (j + 1 < heap.length && heap[j + 1][0] < heap[j][0])
                j++;
            if (heap[j][0] >= last[0])
                break;
            heap[i] = heap[j];
            i = j;
        }
        heap[i] = last;
    }
    return first;
}
export function findRoute(network, sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId)
        return null;
    const lanes = network.lanes.filter(l => !l.closed), connectors = network.connectors;
    const paths = new Map([...lanes, ...connectors].map(p => [p.id, p]));
    const outgoing = new Map(lanes.map(l => [l.id, []]));
    for (const c of connectors) {
        outgoing.get(c.from)?.push(c.id);
        outgoing.set(c.id, [c.to]);
    }
    const best = new Map(), prev = new Map(), open = [];
    for (const l of lanes)
        if (l.startNode === sourceId) {
            const cost = l.length / Math.max(2, l.speed);
            best.set(l.id, cost);
            heapPush(open, [cost, l.id]);
        }
    let target = null, iterations = 0;
    while (open.length && iterations++ < 200000) {
        const [cost, id] = heapPop(open);
        if (cost > (best.get(id) ?? Infinity) + 1e-7)
            continue;
        const p = paths.get(id);
        if (p.kind === 'lane' && p.endNode === targetId) {
            target = id;
            break;
        }
        for (const id2 of outgoing.get(id) || []) {
            const q = paths.get(id2);
            if (!q)
                continue;
            const nc = cost + q.length / Math.max(2, q.speed) + (q.kind === 'connector' ? q.movement === 'uturn' ? 20 : q.movement === 'straight' ? 0 : 1.2 : 0);
            if (nc < (best.get(id2) ?? Infinity)) {
                best.set(id2, nc);
                prev.set(id2, id);
                heapPush(open, [nc, id2]);
            }
        }
    }
    if (!target)
        return null;
    const ids = [target];
    while (prev.has(ids[0]))
        ids.unshift(prev.get(ids[0]));
    return { ids, travelTime: best.get(target), distance: ids.reduce((s, id) => s + paths.get(id).length, 0), sourceId, targetId };
}
