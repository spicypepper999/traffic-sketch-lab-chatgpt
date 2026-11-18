import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Smoke-test application bootstrapping with an instrumented canvas, without
// requiring a GPU/display server in the CI environment.
test('editor initializes sample map, selects fixed nodes, and draws with Canvas2D',async()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 const noop=()=>{};const listeners=new Map(),messages=[];let lastSave=null;
 const on=(id,type,fn)=>listeners.set(`${id}:${type}`,fn);
 const ctx=new Proxy({}, {get:(obj,key)=>key in obj?obj[key]:noop,set:(obj,key,value)=>(obj[key]=value,true)});
 const elts=new Map(ids.map(id=>[id,{
  id,value:'0',textContent:'',innerHTML:'',disabled:false,checked:false,style:{},clientWidth:1500,clientHeight:1000,
  classList:{toggle:noop,add:noop,remove:noop},addEventListener(type,fn){on(id,type,fn)},getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture:noop,
  getContext:()=>ctx,append:noop,click:noop,
 }]));
 globalThis.devicePixelRatio=1;
 globalThis.document={getElementById:id=>elts.get(id),querySelectorAll:()=>[],createElement:()=>({className:'',textContent:'',remove:noop})};
 globalThis.window={addEventListener:noop};
 globalThis.localStorage={getItem:()=>null,setItem:(key,value)=>{lastSave=value}};
 globalThis.Worker=class{postMessage(message){messages.push(message)} };
 globalThis.requestAnimationFrame=()=>{};
 await import('../dist/js/main.js');
 assert.match(elts.get('tripStatus').textContent,/Route found/);
 assert.notEqual(elts.get('sourceValue').textContent,'Not selected');
 assert.notEqual(elts.get('targetValue').textContent,'Not selected');
 assert.equal(elts.get('spawnBtn').disabled,false);
 assert.ok(Number(elts.get('nodeStat').textContent)>0);
 assert.ok(Number(elts.get('laneStat').textContent)>0);
 assert.match(elts.get('pairList').innerHTML,/East-west traffic/);
 assert.match(elts.get('pairList').innerHTML,/North-south traffic/);
 assert.ok(messages.some(m=>m.type==='SET_PAIRS'&&m.pairs?.length===2),'sample map has two traffic flows');
 // Click a real intersection, then ensure every lane path is listed without a JS crash.
 const down=listeners.get('world:pointerdown');
 const evt=(x,y)=>({button:0,pointerId:1,clientX:750+x*1.25,clientY:500+y*1.25,shiftKey:false});
 down(evt(-180,5));
 assert.match(elts.get('inspectorTitle').textContent,/Road properties/,'clicking inside road surface selects road in Select mode');
 down(evt(-80,0));
 assert.match(elts.get('inspectorBody').innerHTML,/Intersection/);
 assert.match(elts.get('inspectorBody').innerHTML,/portal-row/);
 assert.match(elts.get('inspectorBody').innerHTML,/link-swatch/);
 const map=messages.findLast(m=>m.type==='INIT').network;
 const intersection=map.intersections.find(i=>Math.abs(i.center.x+80)<1&&Math.abs(i.center.y)<1);
 assert.ok(intersection,'expected sample junction');
 const inbound=map.lanes.find(l=>l.id===intersection.incoming[0]);
 const handle=inbound.points.at(-1);
 down({...evt(handle.x,handle.y),altKey:true});
 listeners.get('world:pointermove')({...evt(handle.x+2,handle.y+3)});
 listeners.get('world:pointerup')({});
 assert.ok(Object.keys(JSON.parse(lastSave).portals).length>0,'dragged portal persisted');
 // Add a separate OD pair and assign its source/destination through map clicks.
 elts.get('addPair').onclick();
 assert.match(elts.get('pairList').innerHTML,/Pair 3/);
 down(evt(-350,0));
 down(evt(360,0));
 assert.match(elts.get('tripStatus').textContent,/Route found/);
 assert.ok(messages.some(m=>m.type==='SET_PAIRS'&&m.pairs?.length===3));
 assert.ok(lastSave&&JSON.parse(lastSave).odPairs.length===3);
});
