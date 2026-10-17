const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test('スキップは盤面を描画せず100戦を計算し、結果をすべて記録する',async({page})=>{
  test.setTimeout(120000);
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    state.deckBuilder.chaosDecks={'高速確認':{counts:{general_student:40}}};
    Object.assign(state.soloSelection,{mode:'training',ruleId:'chaos',leftController:'ai',playerDeckName:'高速確認',opponentDeckName:'高速確認',initiative:'random'});
    window.fastStart=performance.now();window.fastRenders=0;
    const original=renderBoards;renderBoards=function(){window.fastRenders++;return original();};
    state.training.series=null;
    startTrainingReplaySeries(100,true);
  });
  await expect.poll(()=>page.evaluate(()=>({count:state.training.series?.matches.length||0,phase:state.phase,remaining:state.training.replayRemaining})),{timeout:110000,intervals:[100,500,1000]})
    .toEqual({count:100,phase:'gameover',remaining:0});
  const result=await page.evaluate(()=>({ms:performance.now()-window.fastStart,renders:window.fastRenders,
    count:state.training.series.matches.length,visuals:document.querySelectorAll('.draw-flight,.floating-text,.attack-focus-overlay').length}));
  console.log('100戦実測',JSON.stringify(result));
  expect(result.renders).toBeLessThan(20);
  expect(result.visuals).toBe(0);
  await expect(page.locator('#resultOverlay')).toBeVisible();
  await page.screenshot({path:'/tmp/chibatoru-fast-training.png'});
});
test('融合・コピー・コイントスを含む実デッキでも連続対戦を完走する',async({page})=>{
  test.setTimeout(120000);
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    const fusion=window.ChibattleAiBattleDecks.find(deck=>deck.name==='どこのウマの骨のマイボだよ！');
    const coin=window.ChibattleAiBattleDecks.find(deck=>deck.name==='コイントス研究会');
    state.deckBuilder.chaosDecks={'融合確認':{counts:fusion.counts},'コイン確認':{counts:coin.counts}};
    Object.assign(state.soloSelection,{mode:'training',ruleId:'chaos',leftController:'ai',playerDeckName:'融合確認',opponentDeckName:'コイン確認'});
    state.training.series=null;window.complexStart=performance.now();
    startTrainingReplaySeries(10,true);
  });
  await expect.poll(()=>page.evaluate(()=>state.training.series?.matches.length||0),{timeout:110000,intervals:[250,1000]}).toBe(10);
  console.log('実デッキ10戦実測',await page.evaluate(()=>performance.now()-window.complexStart));
  await expect(page.locator('#resultOverlay')).toBeVisible();
});
