// @ts-nocheck
import { dist, nearestLine } from './geometry.js';
/** World-space hit tests based on visible pavement, not only the centerline.
 * screenTolerance is expressed in screen pixels, so selection stays usable
 * at all zoom levels and on roads with multiple lanes.
 */
export function hitRoad(network, roads, p, zoom = 1, screenTolerance = 8) {
    const byId = new Map(roads.map(r => [r.id, r]));
    let best = null, score = Infinity;
    for (const lane of network.lanes) {
        const r = byId.get(lane.roadId);
        if (!r)
            continue;
        const d = nearestLine(p, lane.points).d;
        const max = r.width / 2 + screenTolerance / Math.max(.1, zoom);
        if (d > max)
            continue;
        const normalized = Math.max(0, d - r.width / 2);
        if (normalized < score) {
            score = normalized;
            best = r;
        }
    }
    return best;
}
export function hitJunction(network, p, zoom = 1) {
    const contains = (poly) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
                inside = !inside;
        }
        return inside;
    };
    let match = null, best = Infinity;
    for (const n of network.intersections) {
        const d = dist(p, n.center);
        if (d < Math.max(6, 11 / Math.max(.1, zoom)) || contains(n.polygon)) {
            if (d < best) {
                best = d;
                match = n;
            }
        }
    }
    return match;
}
