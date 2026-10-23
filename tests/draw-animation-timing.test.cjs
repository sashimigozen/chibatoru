'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('共通ドローは既定速度を維持し、並べ用の速度指定と完了待ちに対応する',async()=>{
  async function run(speed){
    const times=[],rect={x:10,y:10,left:10,right:70,top:10,bottom:100,width:60,height:90};
    const element=()=>({style:{},dataset:{},classList:{add(){},remove(){}},getBoundingClientRect:()=>rect,remove(){},setAttribute(){},isConnected:true,animate(_frames,options){times.push(options);return {finished:Promise.resolve(),cancel(){}};}});
    const node=element();node.parentElement={children:[node]};
    const context={Set,Map,Promise,Number,innerHeight:900,innerWidth:1440,matchMedia:()=>({matches:false}),requestAnimationFrame:cb=>cb(),window:{addEventListener(){}},document:{createElement(){const e=element();e.firstElementChild=element();return e;},body:{appendChild(){}}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../draw-animation.js'),'utf8'),context);
    const api=context.window.ChibattleDraw;
    const done=api.play({side:'player',cards:[{node,card:{instanceId:'one'}}],deck:element(),canReveal:true,face:()=>'',isCurrent:()=>true,...(speed?{speed}:{})});
    assert.equal(typeof done.then,'function');await done;assert.equal(api.isBusy(),false);return times;
  }
  const normal=await run(),fast=await run(3);
  assert.deepEqual(normal.map(x=>x.duration),[360,260,180,300]);
  assert.deepEqual(fast.map(x=>x.duration),[120,260/3,60,100]);
  assert.equal(normal[1].delay,60);assert.equal(fast[1].delay,20);
});
