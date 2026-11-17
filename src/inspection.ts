// @ts-nocheck
// Relationship index derived from the authoritative compiled lane network.
// Only lanes physically touching a junction count; geometric road crossings at
// different elevations never create connections.
export function roadJunctions(network, roadId) {
  const nodes = new Map(network.nodes.filter(n => n.isJunction).map(n => [n.id, n]));
  const links = new Map();
  for (const lane of network.lanes) {
    if (lane.roadId !== roadId) continue;
    for (const [nodeId, kind] of [[lane.endNode, 'feeds'], [lane.startNode, 'receives']]) {
      if (!nodes.has(nodeId)) continue;
      const entry = links.get(nodeId) || {nodeId, feeds: 0, receives: 0, x: nodes.get(nodeId).x, y: nodes.get(nodeId).y};
      entry[kind]++;
      links.set(nodeId, entry);
    }
  }
  return [...links.values()].sort((a,b) => (b.feeds+b.receives)-(a.feeds+a.receives) || a.nodeId.localeCompare(b.nodeId));
}
export function junctionRoads(network, nodeId) {
  const result = new Map();
  for (const lane of network.lanes) {
    if (lane.startNode !== nodeId && lane.endNode !== nodeId) continue;
    const entry = result.get(lane.roadId) || {roadId: lane.roadId, incoming: 0, outgoing: 0};
    if (lane.endNode === nodeId) entry.incoming++;
    if (lane.startNode === nodeId) entry.outgoing++;
    result.set(lane.roadId, entry);
  }
  return [...result.values()].sort((a,b) => a.roadId.localeCompare(b.roadId));
}
export function priorityApproaches(network, nodeId) {
  const node = network.nodes.find(n => n.id === nodeId);
  if (!node) return [];
  return [...new Set(network.lanes.filter(l => l.endNode === nodeId && node.signalGroups?.[l.id] === 0).map(l => l.roadId))];
}
