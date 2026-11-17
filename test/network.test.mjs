import test from 'node:test';
import assert from 'node:assert/strict';
import {compileNetwork,findRoute,PRESETS} from '../dist/js/network.js';
import {controlStraight,controlBend,dist,at} from '../dist/js/geometry.js';

const point=(x,y)=>({x,y});
const road=(id,p0,p3,z0=0,z1=0,forward=1,backward=1,mid=null)=>{
 const [p1,p2]=mid?controlBend(p0,p3,mid):controlStraight(p0,p3);
 return {id,kind:'street',p0,p1,p2,p3,z0,z1,forward,backward,width:3.5,speed:40};
};
const a=road('a',point(-100,0),point(100,0));
const b=road('b',point(0,-100),point(0,100));
const cross=()=>compileNetwork([a,b]);

test('four-way junction generates trimmed lane approaches with seamless connector ends',()=>{
 const n=cross(),junction=n.nodes.find(n=>Math.hypot(n.x,n.y)<1);
 assert.equal(n.lanes.length,8);assert.equal(junction.arms,4);assert.equal(junction.control.type,'stop');
 assert.ok(n.connectors.length>=8);
 for(const c of n.connectors){
  const from=n.lanes.find(l=>l.id===c.from),to=n.lanes.find(l=>l.id===c.to);
  assert.ok(dist(from.points.at(-1),c.points[0])<1e-8);
  assert.ok(dist(c.points.at(-1),to.points[0])<1e-8);
  assert.equal(c.nodeId,junction.id);
 }
 for(const lane of n.lanes.filter(l=>l.endNode===junction.id)){
  assert.ok(dist(lane.points.at(-1),junction)>junction.radius-1.2,'lane must end at junction clearance boundary');
 }
});
test('all default connectors disallow reversing direction and U-turns',()=>{
 const n=cross();assert.ok(n.candidates.some(c=>c.movement==='uturn'));
 assert.ok(n.connectors.every(c=>c.movement!=='uturn'));
 for(const c of n.connectors){
  const a=n.lanes.find(l=>l.id===c.from),b=n.lanes.find(l=>l.id===c.to);
  assert.notEqual(a.sectionId,b.sectionId);
 }
});
test('grade-separated crossing does not connect roads or create phantom junctions',()=>{
 const n=compileNetwork([a,{...b,z0:6,z1:6}]);
 assert.equal(n.lanes.length,4);assert.equal(n.nodes.length,4);
 assert.equal(n.connectors.length,0);
});
test('ramp endpoints attach at appropriate height',()=>{
 const hi=road('hi',point(-100,70),point(100,70),6,6),ramp=road('ramp',point(0,70),point(0,0),6,0,1,0);
 const n=compileNetwork([hi,a,ramp]);
 assert.ok(n.nodes.find(n=>n.z===6&&Math.abs(n.y-70)<2&&Math.abs(n.x)<2)?.arms>=3);
 assert.ok(n.nodes.find(n=>n.z===0&&Math.abs(n.y)<2&&Math.abs(n.x)<2)?.arms>=3);
 assert.ok(n.connectors.some(c=>c.from.startsWith('ramp')&&c.to.startsWith('a')));
});
test('a single inbound lane can split into two and two lanes can merge into one',()=>{
 const w=road('wide',point(0,0),point(100,0),0,0,2,0);
 const t=road('thin',point(-100,0),point(0,0),0,0,1,0);
 const n=compileNetwork([w,t]);const cs=n.connectors.filter(c=>c.from.startsWith('thin'));
 assert.equal(cs.length,2);assert.equal(new Set(cs.map(c=>c.to)).size,2);
 const n2=compileNetwork([road('wide',point(-100,0),point(0,0),0,0,2,0),road('thin',point(0,0),point(100,0),0,0,1,0)]);
 assert.equal(n2.connectors.filter(c=>c.to.startsWith('thin')).length,2);
});
test('manual links are individually editable, including forced explicit U-turns',()=>{
 const n=cross(),allowed=n.connectors.find(c=>c.movement==='right'),uturn=n.candidates.find(c=>c.movement==='uturn');
 assert.ok(allowed&&uturn);
 const blocked=compileNetwork([a,b],[allowed.id]);assert.ok(!blocked.allowedKeys.includes(allowed.id));
 const forced=compileNetwork([a,b],[],[uturn.id]);assert.ok(forced.allowedKeys.includes(uturn.id));
 const closed=compileNetwork([a,b],[],[uturn.id],[uturn.from]);
 assert.ok(!closed.allowedKeys.includes(uturn.id),'closed lane overrides even forced movement');
 assert.ok(!closed.connectors.some(c=>c.from===uturn.from||c.to===uturn.from));
});
test('route planner follows explicit origin and target nodes and respects blocked links',()=>{
 const source='j:-1000:0:0',target='j:1000:0:0';const n=cross();
 const route=findRoute(n,source,target);assert.ok(route);
 assert.equal(n.lanes.find(l=>l.id===route.ids[0]).startNode,source);
 assert.equal(n.lanes.find(l=>l.id===route.ids.at(-1)).endNode,target);
 const straight=n.connectors.find(c=>c.from==='a:s0:f0'&&c.to==='a:s1:f0');assert.ok(straight);
 const blocked=compileNetwork([a,b],[straight.id]);
 assert.equal(findRoute(blocked,source,target),null,'must not secretly turn around to bypass restriction');
 assert.equal(findRoute(n,source,source),null);
});
test('junction control persists in compiled junction metadata',()=>{
 const id='j:0:0:0',n=compileNetwork([a,b],[],[],[],{[id]:{type:'signal',priorityRoad:'b',cycle:44}});
 const j=n.nodes.find(n=>n.id===id);
 assert.equal(j.control.type,'signal');assert.equal(j.control.priorityRoad,'b');assert.equal(j.control.cycle,44);
});
test('curved roads keep all lanes spaced independently',()=>{
 const curved=road('curve',point(-100,0),point(100,0),0,0,2,2,point(0,80));
 const n=compileNetwork([curved]);assert.equal(n.lanes.length,4);
 const p=at(n.lanes[0],n.lanes[0].length*.5).point,q=at(n.lanes[1],n.lanes[1].length*.5).point;
 assert.ok(Math.abs(dist(p,q)-3.5)<1.2);
});
test('a three-lane T-intersection approach receives a legal default exit from every lane',()=>{
 const incoming=road('approach',point(0,100),point(0,0),0,0,3,0);
 const crossRoad=road('cross',point(-100,0),point(100,0),0,0,1,1);
 const n=compileNetwork([incoming,crossRoad]);
 const approach=n.lanes.filter(l=>l.roadId==='approach');
 assert.equal(approach.length,3);
 for(const l of approach){
  assert.ok(n.connectors.some(c=>c.from===l.id),`lane ${l.id} should not become a phantom dead end`);
 }
});
