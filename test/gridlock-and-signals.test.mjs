import test from 'node:test';
import assert from 'node:assert/strict';
import {compileNetwork} from '../dist/js/network.js';
import {controlStraight} from '../dist/js/geometry.js';
import {signalAspect} from '../dist/js/signals.js';
const point=(x,y)=>({x,y});
function road(id,a,b){const [p1,p2]=controlStraight(a,b);return {id,kind:'street',p0:a,p1,p2,p3:b,z0:0,z1:0,forward:1,backward:1,width:3.5,speed:40}}

test('green/yellow/all-red timing is shared by the traffic simulator and renderer',()=>{
 const c={type:'signal',priorityRoad:'A',cycle:24};
 assert.equal(signalAspect(c,'A',0),'green');
 assert.equal(signalAspect(c,'A',9.4),'yellow');
 assert.equal(signalAspect(c,'A',11.3),'red');
 assert.equal(signalAspect(c,'B',11.3),'red'); // clearance
 assert.equal(signalAspect(c,'B',12.2),'green');
 assert.equal(signalAspect(c,'B',21.2),'yellow');
 assert.equal(signalAspect(c,'B',23.2),'red');
 assert.equal(signalAspect(c,'other',0.2,0),'green','per-approach phase must override road IDs');
 assert.equal(signalAspect(c,'A',12.2,1),'green');
});

test('four separate road segments form two opposing signal groups by physical axis',()=>{
 const roads=[
  road('west',point(-100,0),point(0,0)),
  road('east',point(100,0),point(0,0)),
  road('north',point(0,-100),point(0,0)),
  road('south',point(0,100),point(0,0))];
 const n=compileNetwork(roads,[],[],[],{'j:0:0:0':{type:'signal',priorityRoad:'west',cycle:28}});
 const j=n.nodes.find(n=>n.id==='j:0:0:0');
 assert.ok(j,'intersection must be generated from four road arms');
 for(const id of j.incoming){
  const lane=n.lanes.find(l=>l.id===id);
  assert.equal(j.signalGroups[id],['west','east'].includes(lane.roadId)?0:1,lane.roadId);
 }
});

test('parallel, physically separated straight movements do not conflict; perpendicular movements do',()=>{
 const n=compileNetwork([road('EW',point(-100,0),point(100,0)),road('NS',point(0,-100),point(0,100))]);
 const a=n.connectors.find(c=>c.from==='EW:s0:f0'&&c.to==='EW:s1:f0');
 const opposite=n.connectors.find(c=>c.from==='EW:s1:b0'&&c.to==='EW:s0:b0');
 const crossing=n.connectors.find(c=>c.from==='NS:s0:f0'&&c.to==='NS:s1:f0');
 assert.ok(a&&opposite&&crossing);
 assert.ok(!a.conflicts.includes(opposite.id),'opposite-direction traffic in separate lanes must both flow');
 assert.ok(a.conflicts.includes(crossing.id),'perpendicular movements require a conflict reservation');
});

test('saturated four-way signal does not immobilize cars inside junctions',async()=>{
 const network=compileNetwork([road('EW',point(-140,0),point(140,0)),road('NS',point(0,-140),point(0,140))],[],[],[],
  {'j:0:0:0':{type:'signal',priorityRoad:'EW',cycle:24}});
 let tick,snapshot;
 globalThis.self={postMessage(m){if(m.type==='SNAPSHOT')snapshot=m;}};
 globalThis.setInterval=cb=>tick=cb;
 await import('../dist/js/sim-worker.js?gridlock-regression-05');
 self.onmessage({data:{type:'INIT',network}});
 self.onmessage({data:{type:'SET_PAIRS',pairs:[
  {id:'west',sourceId:'j:-1400:0:0',targetId:'j:1400:0:0',rate:.8,colorIndex:0},
  {id:'east',sourceId:'j:1400:0:0',targetId:'j:-1400:0:0',rate:.8,colorIndex:1},
  {id:'north',sourceId:'j:0:-1400:0',targetId:'j:0:1400:0',rate:.8,colorIndex:2},
  {id:'south',sourceId:'j:0:1400:0',targetId:'j:0:-1400:0',rate:.8,colorIndex:3}
 ]}});
 const last=new Map();let longestStill=0,multiple=0,brakingSeen=false;
 for(let t=0;t<3200;t++){
  tick();if(t%2===0)continue;
  let junctionUsers=0;
  const active=new Set();
  for(const v of snapshot.vehicles){
   if(v.braking)brakingSeen=true;
   if(!v.pathId.includes('->'))continue;
   active.add(v.id);junctionUsers++;
   const old=last.get(v.id),still=old&&Math.abs(old.position-v.s)<.005?old.still+1:0;
   longestStill=Math.max(longestStill,still);
   last.set(v.id,{position:v.s,still});
  }
  for(const id of last.keys())if(!active.has(id))last.delete(id);
  if(junctionUsers>=2)multiple++;
 }
 assert.ok(snapshot.stats.pairStats.every(p=>p.completed>=2),
  `all four directions must make progress: ${JSON.stringify(snapshot.stats.pairStats)}`);
 assert.ok(multiple>0,'compatible opposite movements should cross simultaneously');
 assert.ok(longestStill<50,`vehicle stopped within junction for ${(longestStill*.1).toFixed(1)} seconds`);
 assert.ok(brakingSeen,'braking indicators need real braking state in snapshots');
 assert.ok(snapshot.stats.passedJunctions>=12,'intersection throughput must be tracked');
 assert.ok(snapshot.stats.averageVehicleDelay>=0);
});
