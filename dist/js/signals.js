/** Shared signal timing for simulation and rendering. All approaches on the
 * selected priority road form phase A; other roads form phase B. Each half
 * cycle ends with yellow and an all-red clearance interval. */
export function signalAspect(control, roadId, time, approachGroup = null) {
    if (!control || control.type !== 'signal')
        return 'off';
    const cycle = Math.max(12, Number(control.cycle) || 28);
    const half = cycle / 2;
    const t = ((time % cycle) + cycle) % cycle;
    const primary = approachGroup == null ? roadId === control.priorityRoad : approachGroup === 0;
    const phase = t < half ? 0 : 1;
    const within = t % half;
    if ((primary ? 0 : 1) !== phase)
        return 'red';
    if (within >= half - 1)
        return 'red'; // all-red clearance
    if (within >= half - 3)
        return 'yellow';
    return 'green';
}
