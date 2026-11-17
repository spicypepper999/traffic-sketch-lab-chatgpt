// @ts-nocheck
import { add, sub, mul, mix, clamp, dist, samples, offset, cubic, at } from './geometry.js';
import { movementColor, pairColor } from './colors.js';
import { signalAspect } from './signals.js';
const colors = ['#edc775', '#e5a191', '#b9d8bd', '#faf5e2', '#aec5e2', '#d4afd9'];
const rgba = { allowed: '#3cdd97', blocked: '#ee8479', selected: '#ffe08a', incoming: '#ffca74', outgoing: '#76e8d3' };
function path2d(points, close = false) { if (typeof Path2D === 'undefined')
    return null; const p = new Path2D(); if (points.length) {
    p.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++)
        p.lineTo(points[i].x, points[i].y);
    if (close)
        p.closePath();
} return p; }
function bounds(points) { let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
} return { minX, minY, maxX, maxY }; }
export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });
        this.camera = { x: 0, y: 0 };
        this.zoom = 1.25;
        this.quality = 'fast';
        this.dirty = true;
        this.paintState = null;
        this.roadCache = new Map();
        this.pathMap = new Map();
        this.pathCache = new Map();
        this.network = null;
        this.roads = null;
        this.base = document.createElement('canvas');
        // The static layer is deliberately a separate canvas. Cars never cause road repaints.
        if (this.base?.getContext && canvas.parentNode?.insertBefore) {
            this.base.className = 'world-static';
            canvas.parentNode.insertBefore(this.base, canvas);
            this.baseCtx = this.base.getContext('2d', { alpha: false });
            this.separate = !!this.baseCtx;
        }
        else {
            this.base = canvas;
            this.baseCtx = this.ctx;
            this.separate = false;
        }
        this.resize();
    }
    setQuality(q) { this.quality = q === 'balanced' ? 'balanced' : 'fast'; this.resize(); }
    resize() {
        this.w = this.canvas.clientWidth;
        this.h = this.canvas.clientHeight;
        this.dpr = this.quality === 'fast' ? 1 : Math.min(1.5, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
        for (const canvas of this.separate ? [this.canvas, this.base] : [this.canvas]) {
            canvas.width = Math.ceil(this.w * this.dpr);
            canvas.height = Math.ceil(this.h * this.dpr);
        }
        this.invalidateMap();
    }
    invalidateMap() { this.dirty = true; this.paintState = null; }
    invalidateGeometry() { this.roads = null; this.invalidateMap(); }
    screenOf(x, y) { const r = this.canvas.getBoundingClientRect(); return { x: r.left + this.w / 2 + (x - this.camera.x) * this.zoom, y: r.top + this.h / 2 + (y - this.camera.y) * this.zoom }; }
    worldOf(x, y) { const r = this.canvas.getBoundingClientRect(); return { x: this.camera.x + (x - r.left - this.w / 2) / this.zoom, y: this.camera.y + (y - r.top - this.h / 2) / this.zoom }; }
    zoomAt(x, y, f) { const before = this.worldOf(x, y); this.zoom = clamp(this.zoom * f, .18, 8); const after = this.worldOf(x, y); this.camera.x += before.x - after.x; this.camera.y += before.y - after.y; }
    setWorld() { const c = this.ctx, k = this.zoom * this.dpr; c.setTransform(k, 0, 0, k, this.dpr * (this.w / 2 - this.camera.x * this.zoom), this.dpr * (this.h / 2 - this.camera.y * this.zoom)); }
    visible(bb, extra = 25) {
        if (!bb)
            return true;
        const x = this.camera.x, y = this.camera.y, hw = this.w / this.zoom / 2 + extra, hh = this.h / this.zoom / 2 + extra;
        return bb.minX <= x + hw && bb.maxX >= x - hw && bb.minY <= y + hh && bb.maxY >= y - hh;
    }
    line(points, color, width, dash = []) { if (!points || points.length < 2)
        return; const c = this.ctx; c.beginPath(); c.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length; i++)
        c.lineTo(points[i].x, points[i].y); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash(dash); c.stroke(); c.setLineDash([]); }
    strokePath(id, points, color, width, dash = []) { const c = this.ctx, p = this.pathCache.get(id); if (!p) {
        this.line(points, color, width, dash);
        return;
    } c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash(dash); c.stroke(p); c.setLineDash([]); }
    fillPath(path, pts, color) { const c = this.ctx; c.fillStyle = color; if (path)
        c.fill(path);
    else {
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++)
            c.lineTo(pts[i].x, pts[i].y);
        c.closePath();
        c.fill();
    } }
    refreshScene(o) {
        if (this.roads !== o.roads || this.network !== o.network) {
            this.roads = o.roads;
            this.network = o.network;
            this.roadCache.clear();
            this.pathCache.clear();
            this.pathMap = new Map([...o.network.lanes, ...o.network.connectors].map(p => [p.id, p]));
            for (const r of o.roads) {
                const n = clamp(Math.ceil(dist(r.p0, r.p3) / 5), 24, 120), positive = [], negative = [], dividers = [];
                for (let i = 0; i <= n; i++)
                    positive.push(offset(r, i / n, r.forward * r.width));
                for (let i = 0; i <= n; i++)
                    negative.push(offset(r, 1 - i / n, -r.backward * r.width));
                const perimeter = [...positive, ...negative];
                for (let k = -r.backward + 1; k < r.forward; k++) {
                    const pts = Array.from({ length: n + 1 }, (_, i) => offset(r, i / n, k * r.width));
                    dividers.push({ pts, path: path2d(pts), center: k === 0 && r.forward && r.backward });
                }
                this.roadCache.set(r.id, { path: path2d(perimeter, true), pts: perimeter, bb: bounds(perimeter), dividers });
            }
            for (const p of this.pathMap.values())
                this.pathCache.set(p.id, path2d(p.points));
            for (const n of o.network.intersections || [])
                n._shape = path2d(n.polygon, true);
            this.invalidateMap();
        }
    }
    grid(show) {
        const c = this.ctx;
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.fillStyle = '#e8e7df';
        c.fillRect(0, 0, this.w, this.h);
        if (!show)
            return;
        this.setWorld();
        const step = this.zoom > .8 ? 20 : this.zoom > .35 ? 50 : 100, major = step * 5;
        const a = { x: this.camera.x - this.w / this.zoom / 2, y: this.camera.y - this.h / this.zoom / 2 }, b = { x: this.camera.x + this.w / this.zoom / 2, y: this.camera.y + this.h / this.zoom / 2 };
        for (const [space, color, width] of [[step, '#d7d7cd', .5], [major, '#c7c8bc', 1]]) {
            c.beginPath();
            for (let x = Math.floor(a.x / space) * space; x <= b.x; x += space) {
                c.moveTo(x, a.y);
                c.lineTo(x, b.y);
            }
            for (let y = Math.floor(a.y / space) * space; y <= b.y; y += space) {
                c.moveTo(a.x, y);
                c.lineTo(b.x, y);
            }
            c.strokeStyle = color;
            c.lineWidth = width / this.zoom;
            c.stroke();
        }
    }
    road(r, shadow = false) {
        const obj = this.roadCache.get(r.id);
        if (!obj || !this.visible(obj.bb))
            return;
        const c = this.ctx;
        if (shadow) {
            c.save();
            c.translate(3, 3.5);
            this.fillPath(obj.path, obj.pts, '#8c96905e');
            c.restore();
            return;
        }
        const underground = (r.z0 + r.z1) < 0;
        this.fillPath(obj.path, obj.pts, underground ? '#707b7899' : '#586368');
        c.strokeStyle = '#e6e7dc';
        c.lineWidth = .6;
        c.setLineDash(underground ? [3, 3] : []);
        if (obj.path)
            c.stroke(obj.path);
        else
            this.line(obj.pts, '#e6e7dc', .6);
        c.setLineDash([]);
        for (const d of obj.dividers) {
            c.lineWidth = d.center ? .32 : .23;
            c.strokeStyle = d.center ? '#dfcb83' : '#c3cdca';
            c.setLineDash(d.center ? [] : [3.5, 5]);
            if (d.path)
                c.stroke(d.path);
            else
                this.line(d.pts, c.strokeStyle, c.lineWidth, d.center ? [] : [3.5, 5]);
        }
        c.setLineDash([]);
    }
    arrow(path, s, color, size = 3.5) { if (!path?.length)
        return; const c = this.ctx, p = at(path, clamp(s, 0, path.length)); c.save(); c.translate(p.point.x, p.point.y); c.rotate(p.angle); c.fillStyle = color; c.beginPath(); c.moveTo(size * .65, 0); c.lineTo(-size * .55, -size * .44); c.lineTo(-size * .25, 0); c.lineTo(-size * .55, size * .44); c.closePath(); c.fill(); c.restore(); }
    nodeBadge(n, label, color) { const c = this.ctx, r = 11 / this.zoom; c.save(); c.beginPath(); c.arc(n.x, n.y, r, 0, 2 * Math.PI); c.fillStyle = color; c.fill(); c.lineWidth = 2 / this.zoom; c.strokeStyle = '#f8f8ed'; c.stroke(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold ${12 / this.zoom}px system-ui,sans-serif`; c.fillText(label, n.x, n.y + .4 / this.zoom); c.restore(); }
    drawStatic(o) {
        this.grid(o.grid);
        this.setWorld();
        const c = this.ctx;
        const entries = [...o.roads.map(r => ({ kind: 'road', z: (r.z0 + r.z1) / 2, item: r })), ...(o.network.intersections || []).map(n => ({ kind: 'intersection', z: n.z + .01, item: n }))].sort((a, b) => a.z - b.z);
        for (const r of o.roads)
            if (Math.max(r.z0, r.z1) > 0)
                this.road(r, true);
        for (const entry of entries) {
            if (entry.kind === 'road') {
                this.road(entry.item);
                continue;
            }
            const n = entry.item;
            if (!this.visible(bounds(n.polygon)))
                continue;
            const color = n.z < -.5 ? '#697875' : n.z > .5 ? '#606f70' : '#586368';
            this.fillPath(n._shape, n.polygon, color);
        }
        // All visible movement guides come from the *actual* legal lane graph.
        // Never extend a road's painted lane markings across a junction center.
        {
            for (const lane of o.network.lanes) {
                if (lane.closed || !this.visible(bounds([lane.points[0], lane.points.at(-1)])))
                    continue;
                this.arrow(lane, Math.max(2, lane.length - 13), '#f7f8e0b0', 3.25);
            }
            for (const junction of o.network.intersections || []) {
                if (!this.visible(bounds(junction.polygon)))
                    continue;
                const focus = o.selectedJunction === junction.id;
                const show = focus || this.zoom > 1.0;
                if (!show)
                    continue;
                for (const id of junction.activeMovements) {
                    const path = this.pathMap.get(id);
                    if (!path)
                        continue;
                    const color = focus ? movementColor(junction.movements.indexOf(id)) : '#b7cfba83';
                    // Each legal movement has a solid, unique, stable color; never dashed.
                    this.strokePath(id, path.points, color, focus ? 2.4 : .42, []);
                    if ((focus || this.zoom > 1.4) && path.length > 1)
                        this.arrow(path, path.length * .52, color, focus ? 4.2 : 2.2);
                }
            }
        }
        if (o.tool === 'select' && o.selectedRoad) {
            const r = o.roads.find(r => r.id === o.selectedRoad);
            if (r) {
                const shape = this.roadCache.get(r.id);
                if (shape) {
                    c.strokeStyle = '#ffe67a';
                    c.lineWidth = 2.4 / this.zoom;
                    if (shape.path)
                        c.stroke(shape.path);
                    else
                        this.line(shape.pts, '#ffe67a', 2.4 / this.zoom);
                }
                this.line(samples(r, 45).map(s => s.p), '#8ad5c9', .9);
                for (const [i, p] of [r.p0, r.p3, cubic(r, .5)].entries()) {
                    c.beginPath();
                    c.arc(p.x, p.y, 5 / this.zoom, 0, Math.PI * 2);
                    c.fillStyle = i === 2 ? '#f0c47e' : '#c6eadd';
                    c.fill();
                    c.lineWidth = 1.1 / this.zoom;
                    c.strokeStyle = '#426368';
                    c.stroke();
                }
            }
        }
        if (o.route && (o.tool === 'endpoints' || o.debug))
            for (const id of o.route.ids) {
                const p = this.pathMap.get(id);
                if (!p)
                    continue;
                this.strokePath(id, p.points, '#49d9e0a5', p.kind === 'connector' ? 2 : 1.45);
                this.arrow(p, p.length * .7, '#e5ffff', 4);
            }
        // A selected car's actual directed lane/connector route is highlighted once
        // on the cached static canvas, not redrawn on every vehicle frame.
        if (o.selectedVehicleRoute?.ids)
            for (const id of o.selectedVehicleRoute.ids) {
                const p = this.pathMap.get(id);
                if (!p)
                    continue;
                this.strokePath(id, p.points, '#238ca6ad', p.kind === 'connector' ? 2.9 : 2.1);
                if (p.length > 4)
                    this.arrow(p, p.length * .62, '#ecffff', 3.2);
            }
        const selectedEntity = o.network.intersections?.find(n => n.id === o.selectedJunction);
        // Highlight the whole selected intersection even in ordinary Select mode.
        if (selectedEntity) {
            c.strokeStyle = '#ffdd74';
            c.lineWidth = 3 / this.zoom;
            c.setLineDash([]);
            if (selectedEntity._shape)
                c.stroke(selectedEntity._shape);
            else
                this.line(selectedEntity.polygon, '#ffdd74', 3 / this.zoom);
            const entities = new Map(o.network.lanes.map(l => [l.id, l]));
            // Drag handles are positioned on actual compiled lane termini, never on
            // decorative markings. The adjoining connector shares exactly this point.
            for (const [laneId, side, color] of [
                ...selectedEntity.incoming.map(id => [id, 'end', rgba.incoming]),
                ...selectedEntity.outgoing.map(id => [id, 'start', rgba.outgoing])
            ]) {
                const lane = entities.get(laneId);
                if (!lane)
                    continue;
                const point = side === 'end' ? lane.points.at(-1) : lane.points[0];
                c.beginPath();
                c.arc(point.x, point.y, Math.max(1.5, 5 / this.zoom), 0, Math.PI * 2);
                c.fillStyle = color;
                c.fill();
                c.lineWidth = 1.4 / this.zoom;
                c.strokeStyle = lane.portalEdited ? '#fff' : '#2e5853';
                c.stroke();
            }
        }
        if (selectedEntity && ['priority', 'signal'].includes(selectedEntity.control?.type)) {
            // The marked approach is the priority axis (both aligned directions, even
            // when opposite approaches have different road IDs). Clicks are handled in
            // the editor's explicit priority-picking mode.
            const node = o.network.nodes.find(n => n.id === selectedEntity.id);
            for (const id of selectedEntity.incoming) {
                const lane = this.pathMap.get(id);
                if (!lane)
                    continue;
                const main = node?.signalGroups?.[id] === 0;
                const startDistance = Math.max(0, lane.length - 24);
                const stroke = [at(lane, startDistance).point, ...lane.points.filter((_, i) => lane.cumulative[i] > startDistance)];
                const color = main ? '#fcd16c' : '#95dbc1';
                this.line(stroke, color, main ? 2.4 : 1.15);
                if (main)
                    this.arrow(lane, Math.max(0, lane.length - 8), '#fff4b9', 4.4);
            }
        }
        if (o.selectedRoad) {
            const junctionIds = new Set(o.network.lanes.filter(l => l.roadId === o.selectedRoad).flatMap(l => [l.startNode, l.endNode]));
            for (const n of o.network.nodes)
                if (n.isJunction && junctionIds.has(n.id))
                    this.nodeBadge(n, 'J', '#5ba18f');
        }
        if (o.tool === 'lanes' || o.tool === 'junctions' || o.debug) {
            const entity = selectedEntity;
            for (const lane of o.network.lanes) {
                if (!this.visible(bounds([lane.points[0], lane.points.at(-1)])))
                    continue;
                const related = entity && (lane.startNode === entity.id || lane.endNode === entity.id);
                const selected = o.selectedLane === lane.id;
                const color = lane.closed ? '#f08b84' : selected ? rgba.selected : related ? (lane.endNode === entity.id ? rgba.incoming : rgba.outgoing) : '#9cdbcb9a';
                this.strokePath(lane.id, lane.points, color, selected ? 2.6 : related ? 1.4 : .65, lane.closed ? [2, 2] : []);
                if (lane.length > 3 && this.zoom > .35)
                    this.arrow(lane, lane.length * .75, color, selected ? 5 : related ? 3.8 : 2.7);
            }
            if (o.selectedLane) {
                const selected = o.network.lanes.find(l => l.id === o.selectedLane);
                for (const con of o.network.candidates) {
                    if (con.from !== o.selectedLane)
                        continue;
                    const col = con.allowed ? movementColor(entity?.movements.indexOf(con.id) ?? 0) : rgba.blocked;
                    this.strokePath(con.id, con.points, col, con.allowed ? 2.5 : 1.35, []);
                    this.arrow(con, con.length * .64, col, con.allowed ? 5 : 4);
                }
            }
            for (const l of o.network.lanes)
                if (l.closed) {
                    for (const portion of [.42, .7]) {
                        const p = at(l, l.length * portion);
                        const u = { x: Math.cos(p.angle + Math.PI / 4) * 2.8, y: Math.sin(p.angle + Math.PI / 4) * 2.8 };
                        this.line([sub(p.point, u), add(p.point, u)], '#f5a9a4', 1.5);
                    }
                }
        }
        if (o.tool === 'junctions' || o.tool === 'lanes')
            for (const n of o.network.nodes.filter(n => n.isJunction)) {
                const focus = n.id === o.selectedJunction;
                c.beginPath();
                c.arc(n.x, n.y, Math.max(3, focus ? 7 / this.zoom : 4 / this.zoom), 0, Math.PI * 2);
                c.fillStyle = focus ? '#ffcf69' : n.control.type === 'signal' ? '#b5bf76' : '#86c8b8';
                c.fill();
                c.lineWidth = 1 / this.zoom;
                c.strokeStyle = '#355951';
                c.stroke();
            }
        if (o.tool === 'endpoints')
            for (const n of o.network.nodes) {
                c.beginPath();
                c.arc(n.x, n.y, Math.max(3, 5 / this.zoom), 0, Math.PI * 2);
                c.fillStyle = '#bcd9d2';
                c.fill();
            }
        // Show all OD pairs concurrently; markers are colored by pair identity.
        for (const [i, pair] of (o.odPairs || []).entries()) {
            const color = pairColor(pair.colorIndex);
            for (const [id, label] of [[pair.sourceId, 'S'], [pair.targetId, 'T']]) {
                if (!id)
                    continue;
                const node = o.network.nodes.find(n => n.id === id);
                if (!node)
                    continue;
                this.nodeBadge(node, `${label}${i + 1}`, color);
            }
        }
    }
    drawDynamic(o) {
        const c = this.ctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.setWorld();
        const x = this.camera.x, y = this.camera.y, hw = this.w / this.zoom / 2 + 5, hh = this.h / this.zoom / 2 + 5;
        for (const v of o.vehicles) {
            const p = this.pathMap.get(v.pathId);
            if (!p)
                continue;
            const pos = at(p, Math.min(p.length, v.s + v.speed * o.age));
            if (Math.abs(pos.point.x - x) > hw || Math.abs(pos.point.y - y) > hh)
                continue;
            c.save();
            c.translate(pos.point.x, pos.point.y);
            c.rotate(pos.angle);
            const selected = o.selectedVehicleId === v.id;
            if (selected) {
                c.strokeStyle = '#ffcc52';
                c.lineWidth = Math.max(.65, 1.8 / this.zoom);
                c.beginPath();
                c.ellipse(0, 0, v.length / 2 + 2.1, 3.1, 0, 0, Math.PI * 2);
                c.stroke();
            }
            const w = 2.1;
            c.fillStyle = pairColor(v.color);
            c.fillRect(-v.length / 2, -w / 2, v.length, w);
            if (this.zoom > .7) {
                c.fillStyle = '#3b6469';
                c.fillRect(.15, -w / 2 + .18, 1.1, w - .36);
            }
            // Two rear lamps: brighter when braking, stopped at a red light, or queued.
            // These are drawn in the car's local coordinate system (negative X = rear).
            c.fillStyle = v.braking ? '#ff3434' : '#903c42';
            const lampWidth = Math.max(.45, 1 / this.zoom), lampHeight = Math.max(.4, .65 / this.zoom);
            c.fillRect(-v.length / 2 - .08, -w / 2, lampWidth, lampHeight);
            c.fillRect(-v.length / 2 - .08, w / 2 - lampHeight, lampWidth, lampHeight);
            if (v.braking && this.zoom > 1) {
                c.fillStyle = '#ffb0a3';
                c.fillRect(-v.length / 2 - .1, -w / 2, .15, .25);
                c.fillRect(-v.length / 2 - .1, w / 2 - .25, .15, .25);
            }
            c.restore();
        }
        // Dynamic signal heads, on top of the static world (without invalidating
        // its cache). Each incoming lane has an independent, unambiguous indicator.
        // Road IDs identify which arm is governed; time uses the SAME phase function
        // as the worker rather than an approximate animation clock.
        if (o.network?.intersections) {
            const time = Number.isFinite(o.simTime) ? o.simTime + (o.paused ? 0 : o.age || 0) : 0;
            const laneById = new Map(o.network.lanes.map(l => [l.id, l]));
            for (const junction of o.network.intersections) {
                if (junction.control?.type !== 'signal' || !this.visible(bounds(junction.polygon)))
                    continue;
                const junctionNode = o.network.nodes.find(n => n.id === junction.id);
                for (const id of junction.incoming) {
                    const lane = laneById.get(id);
                    if (!lane || lane.closed)
                        continue;
                    const aspect = signalAspect(junction.control, lane.roadId, time, junctionNode?.signalGroups?.[lane.id]);
                    const p = at(lane, Math.max(0, lane.length - 2.8)), normal = { x: -Math.sin(p.angle), y: Math.cos(p.angle) };
                    const pos = add(p.point, mul(normal, 2.25));
                    c.save();
                    c.translate(pos.x, pos.y);
                    c.fillStyle = '#202d32';
                    c.strokeStyle = '#a2b2a9';
                    c.lineWidth = .45;
                    const tiny = this.zoom < .85;
                    if (tiny) {
                        c.beginPath();
                        c.arc(0, 0, 1.6, 0, Math.PI * 2);
                        c.fill();
                        c.fillStyle = aspect === 'green' ? '#49ed8d' : aspect === 'yellow' ? '#ffcf52' : '#ff6060';
                        c.beginPath();
                        c.arc(0, 0, 1.05, 0, Math.PI * 2);
                        c.fill();
                    }
                    else {
                        c.beginPath();
                        c.roundRect(-1.35, -3.8, 2.7, 7.6, .6);
                        c.fill();
                        c.stroke();
                        for (const [state, y, color] of [['red', -2.45, '#ff5555'], ['yellow', 0, '#ffd251'], ['green', 2.45, '#53ed8d']]) {
                            c.fillStyle = aspect === state ? color : '#34443e';
                            c.beginPath();
                            c.arc(0, y, .89, 0, Math.PI * 2);
                            c.fill();
                        }
                        // Show the governing road ID once per approach at readable zoom.
                        if (this.zoom > 1.2 && lane.index === 0) {
                            c.font = 'bold 2.8px system-ui,sans-serif';
                            c.textBaseline = 'middle';
                            c.textAlign = 'left';
                            c.fillStyle = '#f4f7e9';
                            c.fillText(lane.roadId, 2.5, 0);
                        }
                    }
                    // A distinct stop bar makes the signal's controlled approach apparent.
                    c.restore();
                    const line = at(lane, Math.max(0, lane.length - 3.2));
                    const crossVec = { x: -Math.sin(line.angle), y: Math.cos(line.angle) };
                    this.line([add(line.point, mul(crossVec, 1.45)), sub(line.point, mul(crossVec, 1.45))], aspect === 'green' ? '#8ce5ba' : aspect === 'yellow' ? '#eccc65' : '#e69b8d', .55);
                }
            }
        }
        if (o.phase !== 'none' && o.start) {
            const p0 = o.start, p3 = o.phase === 'end' ? o.pointer : o.end;
            if (p3) {
                const mid = o.phase === 'bend' ? o.pointer : mix(p0, p3, .5), q = sub(mul(mid, 2), mul(add(p0, p3), .5)), p1 = add(p0, mul(sub(q, p0), 2 / 3)), p2 = add(p3, mul(sub(q, p3), 2 / 3));
                const pts = Array.from({ length: 32 }, (_, i) => { const t = i / 31, k = 1 - t; return add(add(mul(p0, k * k * k), mul(p1, 3 * k * k * t)), add(mul(p2, 3 * k * t * t), mul(p3, t * t * t))); });
                this.line(pts, '#377f8c', 1.6, [5, 4]);
            }
            c.fillStyle = '#ffd591';
            c.beginPath();
            c.arc(p0.x, p0.y, 3, 0, Math.PI * 2);
            c.fill();
        }
        if (o.tool !== 'pan') {
            c.beginPath();
            c.arc(o.pointer.x, o.pointer.y, 4 / this.zoom, 0, Math.PI * 2);
            c.lineWidth = 1 / this.zoom;
            c.strokeStyle = '#6ca9a9';
            c.stroke();
        }
    }
    render(o) {
        this.refreshScene(o);
        const scene = [this.camera.x, this.camera.y, this.zoom, o.grid, o.tool, o.selectedRoad, o.selectedLane, o.selectedJunction, o.selectedVehicleRoute, o.sourceId, o.targetId, o.activePairId, o.odPairs, o.debug, o.route, this.network, this.roads];
        const changed = this.dirty || !this.paintState || scene.some((v, i) => v !== this.paintState.scene[i]);
        if (changed) {
            const now = performance.now(), last = this.paintState;
            // During navigation, reuse the static bitmap with a cheap CSS transform and
            // refresh no faster than 30 Hz. Cars remain a separate 60 FPS overlay.
            const onlyCamera = last && !this.dirty && scene.slice(3).every((v, i) => v === last.scene[i + 3]);
            const postpone = this.separate && onlyCamera && now - last.at < 32;
            if (postpone) {
                const old = last.camera, z = this.zoom / old.zoom, dx = (old.x - this.camera.x) * this.zoom, dy = (old.y - this.camera.y) * this.zoom;
                this.base.style.transform = `translate(${dx}px,${dy}px) scale(${z})`;
            }
            else {
                const prev = this.ctx;
                this.ctx = this.baseCtx;
                this.drawStatic(o);
                this.ctx = prev;
                if (this.separate)
                    this.base.style.transform = 'none';
                this.paintState = { scene, camera: { ...this.camera, zoom: this.zoom }, at: now };
                this.dirty = false;
            }
        }
        if (this.separate)
            this.drawDynamic(o);
        else {
            this.setWorld();
            this.drawDynamic(o);
        }
    }
}
