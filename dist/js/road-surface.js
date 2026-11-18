// @ts-nocheck
import { add, sub, mul, unit } from './geometry.js';
/** The drawn road surface uses the exact same trimmed lane polylines as traffic.
 * Road pavement cannot continue past a lane portal into an intersection.
 */
export function laneRibbon(lane, width, overlap = .035) {
    const pts = lane.points;
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
        let tangent;
        if (i === 0)
            tangent = sub(pts[1], pts[0]);
        else if (i === pts.length - 1)
            tangent = sub(pts[i], pts[i - 1]);
        else
            tangent = unit(add(unit(sub(pts[i], pts[i - 1])), unit(sub(pts[i + 1], pts[i]))));
        const n = unit({ x: -tangent.y, y: tangent.x });
        left.push(add(pts[i], mul(n, width / 2 + overlap)));
        right.push(sub(pts[i], mul(n, width / 2 + overlap)));
    }
    return { polygon: [...left, ...right.slice().reverse()], left, right };
}
