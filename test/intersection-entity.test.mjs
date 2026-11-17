import test from 'node:test';
import assert from 'node:assert/strict';
import {compileNetwork,findRoute} from '../dist/js/network.js';
import {controlStraight,controlBend,dist} from '../dist/js/geometry.js';
const p=(x,y)=>({x,y});
function road(id,a,b,f=1,rev=1,z0=0,z1=0,mid=null){const [p1,p2]=mid?controlBend(a,b,mid):controlStraight(a,b);
 return{id,kind:'street',p0:a,p1,p2,p3:b,forward:f,backward:rev,z0,z1,width:3.5,speed:50};}
const cross=()=>[road('EW',p(-130,0),p(130,0),3,3),road('NS',p(0,-130),p(0,130),2,2)];
function inPolygon(p,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
 const a=polygon[i],b=polygon[j];if(((a.y>p.y)!==(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x))inside=!inside;
 }return inside;}
test('intersection is a first-class entity covering all incoming/outgoing lanes and link candidates',()=>{
 const n=compileNetwork(cross()),center=n.intersections.find(i=>dist(i.center,p(0,0))<1);
 assert.ok(center,'center intersection should be selectable entity');assert.equal(center.approaches.length,4);
 assert.equal(center.incoming.length,10);assert.equal(center.outgoing.length,10);
 const incoming=new Set(center.approaches.flatMap(a=>a.incoming));
 const outgoing=new Set(center.approaches.flatMap(a=>a.outgoing));
 assert.deepEqual([...incoming].sort(),[...center.incoming].sort());
 assert.deepEqual([...outgoing].sort(),[...center.outgoing].sort());
 assert.equal(center.movements.length,100,'all 10x10 candidate movements represented');
 assert.deepEqual(center.activeMovements.sort(),n.connectors.filter(c=>c.nodeId===center.id).map(c=>c.id).sort());
 assert.equal(center.deadInbound.length,0);
});
test('every permissible turning path begins and ends precisely at a real lane endpoint',()=>{
 const net=compileNetwork(cross());const map=new Map(net.lanes.map(l=>[l.id,l]));
 for(const c of net.connectors){
  const from=map.get(c.from),to=map.get(c.to);
  assert.equal(from.endNode,c.nodeId);assert.equal(to.startNode,c.nodeId);
  assert.ok(dist(c.points[0],from.points.at(-1))<1e-9);
  assert.ok(dist(c.points.at(-1),to.points[0])<1e-9);
  assert.ok(c.length>0);
  const ent=net.intersections.find(i=>i.id===c.nodeId);
  // A connector's midpoint should lie on the same intersection's paved footprint.
  assert.ok(inPolygon(c.points[Math.floor(c.points.length/2)],ent.polygon)||
    dist(c.points[Math.floor(c.points.length/2)],ent.center)<1.5);
 }
});
test('blocking all exits produces explicit flagged dead end, never an invisible fallback route',()=>{
 const roads=cross(),net=compileNetwork(roads),intersection=net.intersections.find(i=>dist(i.center,p(0,0))<1);
 const lane=intersection.incoming[0],all=net.candidates.filter(c=>c.from===lane).map(c=>c.id);
 const blocked=compileNetwork(roads,all);
 const entity=blocked.intersections.find(i=>i.id===intersection.id);
 assert.ok(entity.deadInbound.includes(lane));
 assert.ok(blocked.connectors.every(c=>c.from!==lane));
 assert.ok(blocked.warnings.some(w=>w.includes('no exit')));
 const closed=compileNetwork(roads,[],[],[lane]);
 assert.ok(!closed.intersections.find(i=>i.id===intersection.id).deadInbound.includes(lane));
});
test('one-to-many and many-to-one movements remain separate continuous paths',()=>{
 const roads=[road('entry',p(-100,0),p(0,0),1,0),road('exit',p(0,0),p(120,0),3,0)];
 const net=compileNetwork(roads),junction=net.intersections[0];
 assert.equal(junction.incoming.length,1);assert.equal(junction.outgoing.length,3);
 const paths=net.connectors.filter(c=>c.nodeId===junction.id);
 assert.equal(paths.length,3);
 assert.equal(new Set(paths.map(c=>c.to)).size,3);
 const reversed=compileNetwork([road('entry',p(-100,0),p(0,0),3,0),road('exit',p(0,0),p(120,0),1,0)]);
 assert.equal(reversed.connectors.filter(c=>c.nodeId===reversed.intersections[0].id).length,3);
});
test('grade-separated intersections are independent entities',()=>{
 const low=road('low',p(-100,0),p(100,0),1,1);
 const top=road('top',p(0,-100),p(0,100),1,1,6,6);
 const connected=road('side',p(0,0),p(85,60),1,1);
 const n=compileNetwork([low,top,connected]);
 assert.equal(n.intersections.length,1);
 assert.equal(n.intersections[0].z,0);
 assert.ok(n.intersections[0].approaches.every(a=>a.roadId!=='top'));
});
