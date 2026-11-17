import test from 'node:test';
import assert from 'node:assert/strict';
import {compileNetwork,findRoute} from '../dist/js/network.js';
import {controlStraight,dist} from '../dist/js/geometry.js';

const point=(x,y)=>({x,y});
function road(id,a,b,f=1,back=1){const [p1,p2]=controlStraight(a,b);
 return {id,kind:'street',p0:a,p1,p2,p3:b,z0:0,z1:0,forward:f,backward:back,width:3.5,speed:40};}
const cross=()=>[road('EW',point(-100,0),point(100,0)),road('NS',point(0,-100),point(0,100))];
const centerOf=net=>net.intersections.find(i=>dist(i.center,point(0,0))<1);

test('moving an inbound lane portal changes its true endpoint AND all connected connector starts',()=>{
 const roads=cross(),original=compileNetwork(roads),j=centerOf(original);
 const id=j.incoming[0],l=original.lanes.find(l=>l.id===id),originalEnd=l.points.at(-1);
 const goal={x:originalEnd.x+2.4,y:originalEnd.y+3.2};
 const next=compileNetwork(roads,[],[],[],{}, {[id]:{end:goal}});
 const changed=next.lanes.find(l=>l.id===id);
 assert.ok(dist(changed.points.at(-1),goal)<1e-8);
 assert.ok(dist(changed.points.at(-2),goal)>0);
 assert.ok(next.connectors.some(c=>c.from===id));
 for(const c of next.candidates.filter(c=>c.from===id)){
  assert.ok(dist(c.points[0],goal)<1e-8,`connector ${c.id} must begin on edited portal`);
  assert.ok(dist(c.points.at(-1),next.lanes.find(l=>l.id===c.to).points[0])<1e-8);
 }
 const unaffected=next.lanes.find(l=>l.id!==id&&l.startNode!==j.id&&l.endNode!==j.id);
 if(unaffected)assert.ok(unaffected.length>0);
 const restored=compileNetwork(roads);
 assert.ok(dist(restored.lanes.find(l=>l.id===id).points.at(-1),originalEnd)<1e-8);
});

test('moving an outbound portal changes all incoming connector destinations and survives extra lane links',()=>{
 const roads=[road('A',point(-95,0),point(0,0),2,0),road('B',point(0,0),point(105,0),3,0)];
 const a=compileNetwork(roads),id=a.intersections[0].outgoing[0];
 const changed=compileNetwork(roads,[],[],[],{}, {[id]:{start:point(8,4)}});
 for(const c of changed.connectors.filter(c=>c.to===id))assert.ok(dist(c.points.at(-1),point(8,4))<1e-8);
 assert.ok(changed.connectors.filter(c=>c.to===id).length>=1);
});

test('two independent traffic pairs follow different source and destination nodes',async()=>{
 const net=compileNetwork(cross());
 const sourceA='j:-1000:0:0',destA='j:1000:0:0';
 const sourceB='j:0:-1000:0',destB='j:0:1000:0';
 assert.ok(findRoute(net,sourceA,destA));assert.ok(findRoute(net,sourceB,destB));
 let tick,snapshot;
 globalThis.self={postMessage(m){if(m.type==='SNAPSHOT')snapshot=m;}};
 globalThis.setInterval=cb=>{tick=cb};
 await import('../dist/js/sim-worker.js?multi-pair');
 self.onmessage({data:{type:'INIT',network:net}});
 self.onmessage({data:{type:'SET_PAIRS',pairs:[
  {id:'p1',sourceId:sourceA,targetId:destA,rate:1,enabled:true,colorIndex:0},
  {id:'p2',sourceId:sourceB,targetId:destB,rate:1,enabled:true,colorIndex:1}
 ]}});
 for(let i=0;i<500;i++)tick();
 assert.ok(snapshot.stats.pairStats.every(p=>p.created>0),'both pairs generate vehicles');
 assert.ok(snapshot.stats.pairStats.every(p=>p.routeAvailable));
 assert.ok(snapshot.vehicles.some(v=>v.pairId==='p1'));
 assert.ok(snapshot.vehicles.some(v=>v.pairId==='p2'));
 self.onmessage({data:{type:'SET_PAIR_RATES',pairs:[{id:'p1',rate:0,enabled:false},{id:'p2',rate:1,enabled:true}]}});
 assert.ok(snapshot.stats.created>0,'updating rates must not reset existing trips');
});
