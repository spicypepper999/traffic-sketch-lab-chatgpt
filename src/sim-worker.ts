// @ts-nocheck
import {clamp} from './geometry.js';
import {configureJunction,findRoute} from './network.js';
import {signalAspect} from './signals.js';

const DT=.05;
let running=true,speedMult=1,legacyRate=.8,headway=1.5,gapMin=2.5,delay=.7;
let network={nodes:[],lanes:[],connectors:[]},paths=new Map(),vehicles=[],reservations=new Map(),junctions=new Map(),conflicts=new Map();
let pairs=[],routes=new Map(),accumulators=new Map(),pending=new Map(),pairCounts=new Map(),spawnRound=0;
let selectedVehicleId=null;
let nextId=1,time=0,created=0,completed=0,totalTrip=0,stepAccumulator=0,updateMs=0,ticks=0,passedJunctions=0;
const validRate=n=>clamp(Number(n)||0,0,40);
function reset(){selectedVehicleId=null;vehicles=[];reservations.clear();nextId=1;time=0;created=0;completed=0;totalTrip=0;stepAccumulator=0;spawnRound=0;passedJunctions=0;
 accumulators=new Map(pairs.map(p=>[p.id,0]));pending=new Map(pairs.map(p=>[p.id,0]));pairCounts=new Map(pairs.map(p=>[p.id,{created:0,completed:0}]));}
function prepareRoutes(){routes=new Map(pairs.map(p=>[p.id,findRoute(network,p.sourceId,p.targetId)]));}
function initialize(n){network=n;paths=new Map([...n.lanes,...n.connectors].map(p=>[p.id,p]));junctions=new Map(n.nodes.map(node=>[node.id,node]));conflicts=new Map((n.connectors||[]).map(c=>[c.id,new Set(c.conflicts||[])]));prepareRoutes();reset();snapshot();}
function setPairs(input){
 pairs=(Array.isArray(input)?input:[]).filter(p=>p&&typeof p.id==='string').slice(0,80).map((p,i)=>({
  id:p.id,sourceId:p.sourceId||null,targetId:p.targetId||null,
  rate:validRate(p.rate),enabled:p.enabled!==false,colorIndex:Number.isFinite(p.colorIndex)?p.colorIndex:i
 }));
 prepareRoutes();reset();snapshot();
}
function updatePairRates(input){
 for(const item of Array.isArray(input)?input:[]){const pair=pairs.find(p=>p.id===item.id);if(pair){pair.rate=validRate(item.rate);pair.enabled=item.enabled!==false;}}
 snapshot();
}
function spawn(pair){
 const trip=routes.get(pair.id);
 if(!trip||vehicles.length>=5000)return false;
 const id=trip.ids[0],lane=paths.get(id);
 if(!lane||lane.closed||lane.length<3)return false;
 const minSpace=7+gapMin;
 if(vehicles.some(v=>v.route[v.index]===id&&v.s<minSpace))return false;
 vehicles.push({id:nextId++,route:trip.ids,index:0,s:0,v:0,length:4.6,
  color:pair.colorIndex%6,pairId:pair.id,departure:time,stopped:0,greenWait:0,braking:false,waiting:false,delayTime:0});
 created++;pairCounts.get(pair.id).created++;return true;
}
function stopPosition(v,path){return Math.max(0,path.length-v.length/2-.75)}
function conflicting(a,b){return a===b||conflicts.get(a)?.has(b)||conflicts.get(b)?.has(a)}
function outgoingHasRoom(v,connector,occupied){
 const exit=paths.get(connector.to);
 if(!exit||exit.closed)return false;
 // Leave a complete car length AND following gap on the exit. Critically,
 // this check happens before entering the junction, not at the exit portal.
 const arrivals=occupied.get(exit.id)||[];
 const space=v.length+gapMin+1.5;
 return !arrivals.some(other=>other.id!==v.id&&other.s<space);
}
function signalOrPriorityPermits(v,path,connector,node,occupied){
 const control=node.control||{type:'stop'},type=control.type;
 if(type==='signal'){
  if(signalAspect(control,path.roadId,time,node.signalGroups?.[path.id])!=='green'){
   v.greenWait=0;return false;
  }
  // A stopped driver reacts to the green indication rather than starting
  // instantaneously. Flowing cars need no extra pause.
  if(v.stopped>.15&&v.v<.8){v.greenWait+=DT;return v.greenWait>=delay;}
  return true;
 }
 if(type==='stop')return v.stopped>=delay;
 if(type==='priority'||type==='yield'){
  if(type==='priority'&&(node.signalGroups?.[path.id]===0||path.roadId===control.priorityRoad))return true;
  if(v.stopped<.35)return false;
  const active=network.lanes.filter(l=>l.endNode===node.id&&(node.signalGroups?.[l.id]===0||l.roadId===control.priorityRoad));
  return !active.some(l=>(occupied.get(l.id)||[]).some(car=>car.id!==v.id&&l.length-car.s<Math.max(22,car.v*2.1)));
 }
 return true;
}
function aheadOnRoute(v,occupied,leaders){
 const immediate=leaders.get(v.id);if(immediate)return immediate;
 // Follow cars on *successor* lane/connector paths as well. Prevents
 // nose-to-tail overlap as cars pass lane-connector boundaries.
 let offset=-v.s;
 for(let i=v.index;i<Math.min(v.route.length,v.index+4);i++){
  const path=paths.get(v.route[i]);if(!path)break;
  if(i>v.index){
   const arr=occupied.get(path.id)||[];
   const first=arr.find(x=>x.id!==v.id&&x.s>=0);
   if(first)return {v:first.v,gap:offset+first.s-first.length};
  }
  offset+=path.length;
  if(offset>110)break;
 }
 return null;
}
function step(){
 const before=performance.now();time+=DT;
 for(const p of pairs){if(!p.enabled||!routes.get(p.id))continue;
  const acc=(accumulators.get(p.id)||0)+p.rate*DT;
  const arrivals=Math.floor(acc);
  pending.set(p.id,Math.min(5000,(pending.get(p.id)||0)+arrivals));
  accumulators.set(p.id,acc-arrivals);
 }
 for(let attempts=0;attempts<12&&pairs.length;attempts++){
  let advanced=false;
  for(let j=0;j<pairs.length;j++){
   const p=pairs[(spawnRound+j)%pairs.length];
   if((pending.get(p.id)||0)>0&&routes.get(p.id)&&spawn(p)){
    pending.set(p.id,pending.get(p.id)-1);spawnRound=(spawnRound+j+1)%pairs.length;advanced=true;break;
   }
  }
  if(!advanced)break;
 }
 const occupied=new Map(),leaders=new Map();
 for(const v of vehicles){const id=v.route[v.index];if(!occupied.has(id))occupied.set(id,[]);occupied.get(id).push(v);}
 for(const arr of occupied.values()){
  arr.sort((a,b)=>a.s-b.s);
  for(let i=0;i<arr.length-1;i++)leaders.set(arr[i].id,{v:arr[i+1].v,gap:arr[i+1].s-arr[i].s-arr[i+1].length});
 }
 // Retain reservations until the *rear* of each vehicle has cleared the
 // outgoing portal. Inactive reservations cannot deadlock later traffic.
 const byId=new Map(vehicles.map(v=>[v.id,v]));
 for(const [junction,active] of reservations){
  for(const [id,connectorId] of active){
   const v=byId.get(id),current=v&&paths.get(v.route[v.index]);
   const next=v&&paths.get(v.route[v.index+1]);
   const approaching=current?.kind==='lane'&&next?.id===connectorId;
   const crossing=current?.kind==='connector'&&current.id===connectorId;
   const clearing=current?.kind==='lane'&&v.route[v.index-1]===connectorId&&v.s<v.length/2+.8;
   if(!v||(!approaching&&!crossing&&!clearing))active.delete(id);
  }
  if(!active.size)reservations.delete(junction);
 }
 // Grant intersection entry to approaching vehicles before updating positions.
 // This avoids update-order bias and lets non-conflicting crossings run together.
 const waiting=[];
 for(const v of vehicles){
  const lane=paths.get(v.route[v.index]);const con=paths.get(v.route[v.index+1]);
  if(lane?.kind!=='lane'||con?.kind!=='connector')continue;
  const node=junctions.get(con.nodeId);if(!node?.isJunction)continue;
  const line=stopPosition(v,lane),gap=line-v.s;
  if(gap<=gapMin+1.5&&v.v<.8)v.stopped+=DT;
  if(gap<Math.max(8,v.v*1.25+5))waiting.push({v,lane,con,node,gap});
 }
 waiting.sort((a,b)=>b.v.stopped-a.v.stopped||a.gap-b.gap||a.v.id-b.v.id);
 for(const {v,lane,con,node} of waiting){
  if(!reservations.has(node.id))reservations.set(node.id,new Map());
  const active=reservations.get(node.id);
  if(active.has(v.id))continue;
  if(!signalOrPriorityPermits(v,lane,con,node,occupied))continue;
  if(!outgoingHasRoom(v,con,occupied))continue;
  if([...active.values()].some(other=>conflicting(con.id,other)))continue;
  active.set(v.id,con.id);
 }
 const alive=[];
 for(const v of vehicles){
  let path=paths.get(v.route[v.index]);if(!path)continue;
  const next=paths.get(v.route[v.index+1]);
  const node=next?.kind==='connector'?junctions.get(next.nodeId):null;
  const requiresStop=path.kind==='lane'&&!!node?.isJunction;
  const admitted=!requiresStop||reservations.get(next.nodeId)?.has(v.id);
  const line=stopPosition(v,path);
  let lead=aheadOnRoute(v,occupied,leaders);
  if(requiresStop&&!admitted){
   const red={v:0,gap:line-v.s};if(!lead||red.gap<lead.gap)lead=red;
  }
  const desired=Math.max(2,path.speed*(.91+(v.id%7)*.023)),a0=1.9,b0=3.2;
  let acc=a0*(1-Math.pow(v.v/desired,4));
  if(lead){
   const closing=v.v-lead.v;
   const target=gapMin+Math.max(0,v.v*headway+v.v*closing/(2*Math.sqrt(a0*b0)));
   acc-=a0*Math.pow(target/Math.max(.2,lead.gap),2);
  }
  acc=clamp(acc,-6.5,a0);
  const old=v.v;v.v=clamp(v.v+acc*DT,0,desired*1.1);
  let distance=(old+v.v)*.5*DT;
  if(lead){distance=Math.min(distance,Math.max(0,lead.gap-.25));if(distance<.01&&lead.gap<gapMin)v.v=0;}
  if(requiresStop&&!admitted&&distance>=line-v.s){distance=Math.max(0,line-v.s);v.v=0;}
  v.waiting=requiresStop&&!admitted&&line-v.s<Math.max(7,v.v*2+3);
  // A queued car keeps its brake lamps on even after deceleration is zero.
  // Do not tie lamps solely to negative acceleration: stationary followers
  // would otherwise appear to have released their brakes.
  v.braking=acc<-.45||v.waiting||v.v<.65||(lead&&lead.gap<gapMin+3&&v.v<1.8);
  if(v.v<.4)v.delayTime+=DT;
  let done=false;
  for(let j=0;j<5;j++){
   const remaining=path.length-v.s;
   if(distance<remaining){v.s+=distance;break;}
   if(v.index===v.route.length-1){done=true;completed++;totalTrip+=time-v.departure;pairCounts.get(v.pairId).completed++;break;}
   const following=paths.get(v.route[v.index+1]);if(!following){done=true;break;}
   // A car cannot enter the intersection without a reservation, even if
   // floating-point integration has pushed its position beyond the line.
   if(following.kind==='connector'&&!reservations.get(following.nodeId)?.has(v.id)){
    v.s=Math.min(path.length-.01,stopPosition(v,path));v.v=0;v.braking=true;break;
   }
   if((occupied.get(following.id)||[]).some(other=>other.id!==v.id&&other.s<v.length+gapMin)){
    v.s=Math.max(0,path.length-(following.kind==='connector'?v.length/2+.75:.1));v.v=0;v.braking=true;break;
   }
   if(path.kind==='connector')passedJunctions++;
   distance-=remaining;v.index++;v.s=0;path=following;
   if(path.kind==='connector'){v.stopped=0;v.greenWait=0;}
  }
  if(!done)alive.push(v);
  else for(const [nodeId,active] of reservations){active.delete(v.id);if(!active.size)reservations.delete(nodeId);}
 }
 vehicles=alive;
 // Release reservations whose rear cleared an outgoing portal this tick.
 const aliveById=new Map(alive.map(v=>[v.id,v]));
 for(const [nodeId,active] of reservations){
  for(const [id,connectorId] of active){
   const v=aliveById.get(id);
   if(!v){active.delete(id);continue;}
   const current=paths.get(v.route[v.index]);
   if(current?.kind==='lane'&&v.route[v.index-1]===connectorId&&v.s>=v.length/2+.8)active.delete(id);
  }
  if(!active.size)reservations.delete(nodeId);
 }
 updateMs=performance.now()-before;
}
function snapshot(){
 let totalSpeed=0,queued=0;
 const batch=vehicles.map(v=>{totalSpeed+=v.v;if(v.v<.6)queued++;return{id:v.id,pathId:v.route[v.index],s:v.s,speed:v.v,braking:!!v.braking,color:v.color,pairId:v.pairId,length:v.length};});
 const chosen=vehicles.find(v=>v.id===selectedVehicleId);
 const selectedVehicle=chosen?{id:chosen.id,route:chosen.route,index:chosen.index,pathId:chosen.route[chosen.index],s:chosen.s,
  speed:chosen.v,stopped:chosen.stopped,waiting:chosen.waiting,braking:chosen.braking,delayTime:chosen.delayTime,
  departure:chosen.departure,pairId:chosen.pairId,length:chosen.length}:null;
 const first=pairs[0],firstRoute=first&&routes.get(first.id);
 const pairStats=pairs.map(p=>({id:p.id,pending:pending.get(p.id)||0,
  created:pairCounts.get(p.id)?.created||0,completed:pairCounts.get(p.id)?.completed||0,routeAvailable:!!routes.get(p.id)}));
 self.postMessage({type:'SNAPSHOT',vehicles:batch,selectedVehicle,stats:{active:vehicles.length,created,completed,queued,passedJunctions,
  averageSpeed:vehicles.length?totalSpeed/vehicles.length*3.6:0,
  averageTripTime:completed?totalTrip/completed:0,
  averageVehicleDelay:vehicles.length?vehicles.reduce((sum,v)=>sum+v.delayTime,0)/vehicles.length:0,
  simTime:time,updateMs,
  pendingDemand:[...pending.values()].reduce((a,b)=>a+b,0),pairStats,
  originId:first?.sourceId||null,destinationId:first?.targetId||null,routeAvailable:!!firstRoute}});
}
setInterval(()=>{
 if(running){stepAccumulator+=speedMult;const count=Math.min(12,Math.floor(stepAccumulator));stepAccumulator-=count;for(let i=0;i<count;i++)step();}
 if(++ticks%2===0)snapshot();
},50);
self.onmessage=e=>{const m=e.data;switch(m.type){
 case 'INIT':initialize(m.network);break;
 case 'SET_JUNCTION_CONTROL':{
  const node=junctions.get(m.id);
  if(!node?.isJunction)break;
  const lanes=ids=>ids.map(id=>paths.get(id));
  configureJunction(node,m.control,lanes(node.incoming),lanes(node.outgoing));
  // Previously admitted drivers retain their reservations until their rear clears.
  break;
 }
 case 'SELECT_VEHICLE':selectedVehicleId=Number.isInteger(m.id)?m.id:null;snapshot();break;
 case 'SET_PAIRS':setPairs(m.pairs);break;
 case 'SET_PAIR_RATES':updatePairRates(m.pairs);break;
 // Legacy protocol remains supported for old tests and third-party scenarios.
 case 'SET_TRIP':setPairs([{id:'legacy',sourceId:m.source,targetId:m.target,rate:legacyRate,enabled:true,colorIndex:0}]);break;
 case 'SET_SETTINGS':headway=clamp(m.headway,.2,10);gapMin=clamp(m.gap,.5,20);delay=clamp(m.startDelay,0,5);break;
 case 'SET_RUNNING':running=m.running;break;
 case 'SET_SPEED':speedMult=m.speed;break;
 case 'SET_SPAWN_RATE':legacyRate=m.rate;if(pairs.length===1&&pairs[0].id==='legacy')pairs[0].rate=validRate(m.rate);break;
 case 'SPAWN':{
  const p=pairs.find(p=>p.id===m.pairId)||pairs[0];if(p&&routes.get(p.id))pending.set(p.id,Math.min(5000,(pending.get(p.id)||0)+Math.max(0,Math.floor(m.count))));snapshot();break;
 }
 case 'RESET':reset();snapshot();break;
}};
