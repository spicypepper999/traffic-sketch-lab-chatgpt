import test from 'node:test';
import assert from 'node:assert/strict';
import {compileNetwork,PRESETS,findRoute} from '../dist/js/network.js';
import {controlStraight,dist,nearestLine} from '../dist/js/geometry.js';
import {hitRoad,hitJunction} from '../dist/js/hit-test.js';
import {laneRibbon} from '../dist/js/road-surface.js';

function road(id,x0,y0,x1,y1,kind='street'){
 const p0={x:x0,y:y0},p3={x:x1,y:y1};const [p1,p2]=controlStraight(p0,p3);
 return {id,kind,p0,p1,p2,p3,z0:0,z1:0,...PRESETS[kind]};
}
const CROSS=[road('main',-130,0,130,0,'avenue'),road('side',0,-130,0,130)];

test('road selection finds edge of a six-lane highway and never confuses it with a nearby road',()=>{
 const roads=[road('highway',-220,0,220,0,'highway'),road('street',-220,-55,220,-55)];
 const n=compileNetwork(roads);
 assert.equal(hitRoad(n,roads,{x:0,y:9.7},1.25)?.id,'highway','outer highway lane inside pavement');
 assert.equal(hitRoad(n,roads,{x:0,y:-55},1.25)?.id,'street');
 assert.equal(hitRoad(n,roads,{x:0,y:43},1.25),null,'do not select a remote road');
});

test('intersection is hit inside its actual paved footprint, while far road sections are not',()=>{
 const network=compileNetwork(CROSS);
 assert.ok(hitJunction(network,{x:0,y:0},1.25));
 assert.equal(hitJunction(network,{x:-80,y:0},1.25),null);
 const j=network.intersections.find(n=>Math.hypot(n.center.x,n.center.y)<1);
 assert.ok(j&&j.incoming.length>=3);
});

test('rendered lane ribbons end at the actual compiled junction portals',()=>{
 const n=compileNetwork(CROSS),j=n.intersections.find(n=>Math.hypot(n.center.x,n.center.y)<1);
 assert.ok(j);
 for(const l of n.lanes){
  const r=CROSS.find(r=>r.id===l.roadId);
  const strip=laneRibbon(l,r.width);
  assert.equal(strip.left.length,l.points.length);
  assert.equal(strip.right.length,l.points.length);
  assert.equal(strip.polygon.length,2*l.points.length);
  for(const p of strip.polygon)assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
  const end=l.endNode===j.id?l.points.at(-1):l.startNode===j.id?l.points[0]:null;
  if(!end)continue;
  // The rendered lane ends at a portal outside the junction's center;
  // no visual continuation along the unsplit road centerline is permitted.
  assert.ok(dist(end,j.center)>j.radius*.45,`${l.id}: ribbon portal must be away from the center`);
  assert.ok(strip.polygon.some(p=>dist(p,end)<r.width),'ribbon cap surrounds lane portal');
 }
 for(const c of n.connectors){
  const from=n.lanes.find(l=>l.id===c.from),to=n.lanes.find(l=>l.id===c.to);
  assert.ok(dist(from.points.at(-1),c.points[0])<1e-8);
  assert.ok(dist(to.points[0],c.points.at(-1))<1e-8);
 }
});

test('two default orthogonal sample flows have legal routes through a shared junction',()=>{
 const n=compileNetwork([road('ew',-120,0,120,0),road('ns',0,-120,0,120)]);
 const ew=findRoute(n,'j:-1200:0:0','j:1200:0:0');
 const ns=findRoute(n,'j:0:-1200:0','j:0:1200:0');
 assert.ok(ew&&ns);
 assert.ok(ew.ids.some(id=>id.includes('->'))&&ns.ids.some(id=>id.includes('->')));
});

test('stationary followers in a stopped queue illuminate brake lamps',async()=>{
 const network=compileNetwork([road('main',-120,0,120,0),road('minor',0,-130,0,130)],[],[],[],{'j:0:0:0':{type:'signal',priorityRoad:'main',cycle:60}});
 let tick,latest;
 globalThis.self={postMessage(m){if(m.type==='SNAPSHOT')latest=m;}};
 globalThis.setInterval=fn=>{tick=fn};
 await import('../dist/js/sim-worker.js?queued-brake-light-test');
 self.onmessage({data:{type:'INIT',network}});
 self.onmessage({data:{type:'SET_PAIRS',pairs:[{id:'minor',sourceId:'j:0:-1300:0',targetId:'j:0:1300:0',rate:3,enabled:true,colorIndex:0}]}});
 for(let i=0;i<510;i++)tick(); // 25.5s: all minor approach signals still red
 const waiting=latest.vehicles.filter(v=>v.pathId==='minor:s0:f0'&&v.speed<.5);
 assert.ok(waiting.length>=3,`expected a queue, got ${waiting.length} stopped cars`);
 assert.ok(waiting.every(v=>v.braking),`stationary followers must keep brake lamps on`);
});
