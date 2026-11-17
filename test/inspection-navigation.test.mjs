import test from 'node:test';
import assert from 'node:assert/strict';
import {compileNetwork} from '../dist/js/network.js';
import {roadJunctions,junctionRoads,priorityApproaches} from '../dist/js/inspection.js';
import {controlStraight} from '../dist/js/geometry.js';
const p=(x,y)=>({x,y});
function road(id,a,b,z=0){const [p1,p2]=controlStraight(a,b);return {id,kind:'street',p0:a,p1,p2,p3:b,z0:z,z1:z,forward:1,backward:1,width:3.5,speed:40}}
const junction='j:0:0:0';
test('road-to-junction and junction-to-road links are reciprocal, with accurate lane counts',()=>{
 const net=compileNetwork([road('EW',p(-100,0),p(100,0)),road('NS',p(0,-100),p(0,100))]);
 const intersections=roadJunctions(net,'EW');
 assert.equal(intersections.length,1);
 assert.equal(intersections[0].nodeId,junction);
 assert.equal(intersections[0].feeds,2);
 assert.equal(intersections[0].receives,2);
 const roads=junctionRoads(net,junction);
 assert.deepEqual(roads.map(r=>r.roadId),['EW','NS']);
 assert.deepEqual(roads.map(({incoming,outgoing})=>[incoming,outgoing]),[[2,2],[2,2]]);
});
test('an overpass is not listed as feeding the ground-level junction',()=>{
 const net=compileNetwork([road('ground',p(-100,0),p(100,0)),road('side',p(0,-100),p(0,100)),road('bridge',p(-100,-30),p(100,30),6)]);
 assert.deepEqual(roadJunctions(net,'bridge'),[]);
 assert.deepEqual(junctionRoads(net,junction).map(a=>a.roadId),['ground','side']);
});
test('priority on a four-arm intersection also covers the physically opposite approach',()=>{
 const roads=[road('west',p(-100,0),p(0,0)),road('east',p(100,0),p(0,0)),road('north',p(0,-100),p(0,0)),road('south',p(0,100),p(0,0))];
 for(const seed of ['west','north']){
  const net=compileNetwork(roads,[],[],[],{[junction]:{type:'priority',priorityRoad:seed}});
  const node=net.nodes.find(n=>n.id===junction);
  assert.equal(node.control.type,'priority');
  const result=priorityApproaches(net,junction).sort();
  assert.deepEqual(result,seed==='west'?['east','west']:['north','south']);
  for(const id of node.incoming){const lane=net.lanes.find(l=>l.id===id);
   assert.equal(node.signalGroups[id],result.includes(lane.roadId)?0:1);
  }
 }
});
