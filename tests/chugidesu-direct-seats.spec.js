const {test, expect} = require('@playwright/test');
const {pathToFileURL} = require('node:url'); const path = require('node:path');
test.beforeEach(async ({page}) => {
  await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
  await page.evaluate(() => { startCardTest('chugidesu'); scheduleOpponentAI = () => {}; state.training.skipAnimations = true; });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});
for (const count of [0,1,2]) test(`3枚融合のカードテストで席を直接${count}つ選んで出席・ドロー・回復する`, async ({page}) => {
  await page.evaluate(() => showBattleCardPreview(state.players.player.hand.find(c=>c.baseId==='chugidesu')));
  await page.locator('[data-preview-any-hand-fusion]').click();
  await page.evaluate(() => { for(const c of state.pendingCardChoice.cards) toggleCardChoiceCard(c.instanceId); confirmCardChoiceSelection(); });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => { const c=state.players.player.hand.find(c=>c.baseId==='chugidesu'); playCard(c.instanceId,'seat','player',4); });
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('attendance_seats');
  await expect(page.locator('#threeGesturesStage')).toBeHidden();
  await expect(page.locator('#playerSeatGrid .slot.selection-candidate')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
  expect(await page.evaluate(() => [state.players.player.hand.length,state.players.player.life])).toEqual([0,10]);
  // Nonadjacent seats remain unavailable. Selecting a seat can also be undone.
  await page.locator('#playerSeatGrid .slot[data-index="0"]').click({force:true});
  expect(await page.evaluate(() => state.pendingCardChoice.selectedIds.length)).toBe(0);
  await page.locator('#playerSeatGrid .slot.selection-candidate[data-index="3"]').click();
  await page.locator('#playerSeatGrid .slot.selection-candidate[data-index="3"]').click();
  for(const index of [3,5].slice(0,count)) await page.locator(`#playerSeatGrid .slot.selection-candidate[data-index="${index}"]`).click();
  if(count===2) await page.screenshot({path:'/tmp/chugidesu-direct-seats.png'});
  await expect(page.locator('#itemTargetConfirmButton')).toBeEnabled();
  await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => [state.players.player.board.seats.filter(c=>c?.baseId==='exploding_student').length,
    state.players.player.hand.length,state.players.player.life,!!state.pendingCopiedCard])).toEqual([count,2,12,false]);
});
test('端の席なら隣の1席だけが選択できる', async ({page}) => {
  await page.evaluate(() => {
    const p=state.players.player,c=p.hand.find(c=>c.baseId==='chugidesu');
    fuseAnyHandCards('player',c.instanceId,p.hand.filter(x=>x!==c).map(x=>x.instanceId),false);
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => playCard(state.players.player.hand.find(c=>c.baseId==='chugidesu').instanceId,'seat','player',0));
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('attendance_seats');
  await expect(page.locator('#playerSeatGrid .slot.selection-candidate')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
  await page.locator('#playerSeatGrid .slot.selection-candidate[data-index="1"]').click();
  await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => [state.players.player.board.seats[1]?.baseId,state.players.player.hand.length,state.players.player.life])).toEqual(['exploding_student',2,12]);
});
