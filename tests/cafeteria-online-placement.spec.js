const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const url=pathToFileURL(path.join(__dirname,'..','index.html')).href;

async function setup(host,guest,baseId){
  for(const [page,role]of[[host,'host'],[guest,'guest']]){
    await page.goto(url);
    await page.evaluate(role=>{
      startCardTest('jobs_woody');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;
      state.environment=createCardFromBase('cafeteria','player');
      for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],life:20,will:20});
      Object.assign(state.online,{role,started:true,connected:true,conn:{}});
      window.outbox=[];onlineSend=message=>{outbox.push(JSON.parse(JSON.stringify(message)));return true;};
    },role);
  }
  await expect.poll(()=>host.evaluate(()=>battlePresentationBusy())).toBe(false);
  const snapshot=await host.evaluate(baseId=>{
    state.currentSide='opponent';
    state.players.opponent.hand=[createCardFromBase(baseId,'opponent')];
    if(baseId==='window_eater'){
      state.players.player.board.seats=Array.from({length:9},()=>makeBoardCard(createCardFromBase('general_student','player')));
      state.players.player.board.teacher=makeBoardCard(createCardFromBase('general_teacher','player'));
    }
    return onlineCreateSnapshot();
  },baseId);
  await guest.evaluate(snapshot=>onlineHandleMessage({type:'gameState',protocol:ONLINE_PROTOCOL_VERSION,snapshot}),snapshot);
  await guest.evaluate(()=>onlineSendCommand('playCard',{instanceId:state.players.player.hand[0].instanceId,zone:'seat',owner:'player',index:0}));
  await relay(guest,host);
}
async function relay(from,to){
  const messages=await from.evaluate(()=>outbox.splice(0));
  for(const message of messages)await to.evaluate(message=>onlineHandleMessage({...message,type:message.command?'command':message.type,protocol:ONLINE_PROTOCOL_VERSION}),message);
}

test('ゲストもウッディの2人の出席先を自分の講義室から直接選べる',async({page:host,browser})=>{
  const guest=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await setup(host,guest,'jobs_woody');
    for(const index of [4,8]){
      await expect.poll(()=>host.evaluate(()=>state.pendingCopiedCard?.baseId)).toBe('apprentice_vampire');
      await relay(host,guest);
      await expect.poll(()=>guest.evaluate(()=>state.pendingCopiedCard?.baseId)).toBe('apprentice_vampire');
      await expect.poll(()=>guest.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
      await expect(guest.locator('#threeGesturesStage')).toHaveClass(/hidden/);
      await guest.locator(`.slot[data-owner="player"][data-zone="seat"][data-index="${index}"]`).click();
      await relay(guest,host);
      await expect.poll(()=>host.evaluate(index=>state.players.opponent.board.seats[index]?.baseId,index)).toBe('apprentice_vampire');
    }
    await expect.poll(()=>host.evaluate(()=>fusionTasksBusy())).toBe(false);await relay(host,guest);
    await expect.poll(()=>guest.evaluate(()=>[state.remoteResolutionPending,!!state.pendingCopiedCard])).toEqual([false,false]);
    expect(await guest.evaluate(()=>[state.players.player.will,state.players.player.board.seats.filter(c=>c?.baseId==='apprentice_vampire').length])).toEqual([15,2]);
  }finally{await guest.close();}
});

test('ゲストの窓辺イーターは向きを変換した相手の2列を盤面上で選ぶ',async({page:host,browser})=>{
  const guest=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await setup(host,guest,'window_eater');
    await expect.poll(()=>host.evaluate(()=>state.pendingRemoteHandTrim?.mode)).toBe('fusion_effect_choice');
    await relay(host,guest);
    await expect(guest.locator('.column-choice-button[data-owner="opponent"]')).toHaveCount(3);
    await expect(guest.locator('.column-choice-button[data-owner="player"]')).toHaveCount(0);
    await expect.poll(()=>guest.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
    await guest.locator('.column-choice-button[data-column="0"]').click();
    await guest.locator('.column-choice-button[data-column="2"]').click();
    await guest.locator('#itemTargetConfirmButton').click();await relay(guest,host);
    await expect.poll(()=>host.evaluate(()=>fusionTasksBusy())).toBe(false);await relay(host,guest);
    expect(await host.evaluate(()=>[state.players.player.board.seats.map((c,i)=>c?i:-1).filter(i=>i>=0),!!state.players.player.board.teacher])).toEqual([[1,4,7],true]);
  }finally{await guest.close();}
});
