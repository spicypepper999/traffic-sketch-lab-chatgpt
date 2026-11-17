import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer} from '../dist/js/renderer.js';
import {compileNetwork} from '../dist/js/network.js';
import {controlStraight} from '../dist/js/geometry.js';
function context(){const tally={fillRect:0,clearRect:0,stroke:0};const ctx=new Proxy(tally,{get(target,key){if(key in target&&typeof target[key]==='function')return target[key];if(key==='fillRect')return()=>target.fillRect++;
 if(key==='clearRect')return()=>target.clearRect++;
 if(key==='stroke')return()=>target.stroke++;
 if(key==='setTransform')return()=>{};
 return()=>{};},set(target,key,value){if(['fillRect','clearRect','stroke'].includes(key))return true;target[key]=value;return true;}});
 return{ctx,tally};}
test('road geometry and background are not painted again for each vehicle animation frame',()=>{
 const bg=context(),fg=context();
 const canvas={clientWidth:800,clientHeight:600,style:{},parentNode:{insertBefore(){}},getContext(){return fg.ctx},getBoundingClientRect:()=>({left:0,top:0})};
 globalThis.document={createElement:()=>({style:{},getContext(){return bg.ctx}})};
 const v=new Renderer(canvas);
 const [p1,p2]=controlStraight({x:-100,y:0},{x:100,y:0});
 const roads=[{id:'r',kind:'street',p0:{x:-100,y:0},p1,p2,p3:{x:100,y:0},z0:0,z1:0,forward:1,backward:1,width:3.5,speed:40}];
 const network=compileNetwork(roads);
 const o={roads,network,tool:'select',selectedRoad:null,selectedJunction:null,selectedLane:null,sourceId:null,targetId:null,route:null,grid:false,debug:false,vehicles:[],phase:'none',pointer:{x:0,y:0},age:0};
 v.render(o);const original=bg.tally.fillRect;
 for(let i=0;i<15;i++)v.render({...o,vehicles:[{id:i,pathId:network.lanes[0].id,s:10,speed:4,color:0,length:4.5}]});
 assert.equal(bg.tally.fillRect,original,'static background only drawn once');
 assert.ok(fg.tally.clearRect>=16,'vehicles repainted separately');
 v.invalidateMap();v.render(o);assert.ok(bg.tally.fillRect>original,'invalidate must repaint static background');
});
