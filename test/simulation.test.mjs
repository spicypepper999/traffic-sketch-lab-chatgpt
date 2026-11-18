import test from 'node:test';
import assert from 'node:assert/strict';
import {compileNetwork,PRESETS} from '../dist/js/network.js';
import {controlStraight} from '../dist/js/geometry.js';
const road=(id,p0,p3)=>{const[p1,p2]=controlStraight(p0,p3);return {id,kind:'street',p0,p1,p2,p3,z0:0,z1:0,...PRESETS.street}};
const network=compileNetwork([road('east',{x:-120,y:0},{x:120,y:0}),road('south',{x:0,y:-120},{x:0,y:120})]);

test('fixed source/target are required; routed vehicles finish only at selected destination',async()=>{
 let step,stats,vehicles;globalThis.self={postMessage(m){if(m.type==='SNAPSHOT'){stats=m.stats;vehicles=m.vehicles;}}};
 globalThis.setInterval=cb=>{step=cb;};
 await import('../dist/js/sim-worker.js');
 self.onmessage({data:{type:'INIT',network}});
 self.onmessage({data:{type:'SET_SPAWN_RATE',rate:.8}});
 for(let i=0;i<40;i++)step();
 assert.equal(stats.created,0,'no random cars without defined origin and destination');
 self.onmessage({data:{type:'SET_TRIP',source:'j:-1200:0:0',target:'j:1200:0:0'}});
 assert.equal(stats.routeAvailable,true);assert.equal(stats.originId,'j:-1200:0:0');
 self.onmessage({data:{type:'SPAWN',count:1}});
 assert.equal(stats.pendingDemand,1);
 for(let i=0;i<3000;i++)step();
 assert.ok(stats.simTime>149&&stats.simTime<151);
 assert.ok(stats.created>4);
 assert.ok(stats.completed>1,'cars should pass intersection and reach target');
 assert.ok(stats.active>0);
 self.onmessage({data:{type:'SET_RUNNING',running:false}});
 const time=stats.simTime;for(let i=0;i<40;i++)step();assert.equal(stats.simTime,time);
 self.onmessage({data:{type:'SET_TRIP',source:'j:1200:0:0',target:'j:-1200:0:0'}});
 assert.equal(stats.created,0,'changing OD scenario resets traffic');
 assert.equal(stats.destinationId,'j:-1200:0:0');
});
test('red signal holds a secondary-road vehicle until its green phase',async()=>{
 const n=compileNetwork([road('a',{x:-120,y:0},{x:120,y:0}),road('b',{x:0,y:-120},{x:0,y:120})],
  [],[],[],{'j:0:0:0':{type:'signal',priorityRoad:'a',cycle:50}});
 let tick,vehicles=[],stats;
 globalThis.self={postMessage(m){if(m.type==='SNAPSHOT'){vehicles=m.vehicles;stats=m.stats;}}};
 globalThis.setInterval=fn=>{tick=fn};
 await import('../dist/js/sim-worker.js?signal-test');
 self.onmessage({data:{type:'INIT',network:n}});
 self.onmessage({data:{type:'SET_SPAWN_RATE',rate:0}});
 self.onmessage({data:{type:'SET_TRIP',source:'j:0:-1200:0',target:'j:0:1200:0'}});
 self.onmessage({data:{type:'SPAWN',count:1}});
 for(let i=0;i<440;i++)tick(); // 22s: secondary road is red
 assert.equal(vehicles.length,1);
 assert.equal(vehicles[0].pathId,'b:s0:f0','car must not enter intersection on red');
 assert.ok(vehicles[0].speed<.2,'car should be stopped at stop line');
 for(let i=0;i<260;i++)tick(); // 35s: secondary road has green
 assert.ok(vehicles[0].pathId==='b:s1:f0'||stats.completed>0,'car proceeds on green');
});

test('editing a signal releases a waiting driver and preserves the paused simulation',async()=>{
 const id='j:0:0:0';
 const n=compileNetwork([road('a',{x:-120,y:0},{x:120,y:0}),road('b',{x:0,y:-120},{x:0,y:120})],
  [],[],[],{[id]:{type:'signal',priorityRoad:'a',cycle:120}});
 let tick,frame;
 globalThis.self={postMessage(message){frame=message;}};
 globalThis.setInterval=fn=>{tick=fn;};
 await import('../dist/js/sim-worker.js?live-controls');
 const send=data=>self.onmessage({data});
 send({type:'INIT',network:n});
 send({type:'SET_TRIP',source:'j:0:-1200:0',target:'j:0:1200:0'});
 send({type:'SET_SPAWN_RATE',rate:0});
 send({type:'SPAWN',count:1});
 for(let i=0;i<440;i++)tick();
 send({type:'SELECT_VEHICLE',id:frame.vehicles[0].id});
 assert.ok(frame.selectedVehicle.waiting);
 send({type:'SET_RUNNING',running:false});
 const before=structuredClone(frame);
 send({type:'SET_JUNCTION_CONTROL',id,control:{type:'signal',priorityRoad:'b',cycle:120}});
 tick();tick();
 assert.deepEqual(frame,before);
 send({type:'SET_RUNNING',running:true});
 for(let i=0;i<480;i++)tick();
 assert.ok(frame.stats.simTime<60,'original signal would still be red');
 assert.equal(frame.stats.completed,1);
 assert.equal(frame.stats.created,1);
 assert.equal(frame.stats.passedJunctions,1);
});
