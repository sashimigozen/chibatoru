const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const gameUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

for (const reducedMotion of ['no-preference', 'reduce']) {
  for (const equipment of [
    { id: 'red_happi', tone: 'buff', label: '攻撃力強化 +2', attack: 5, hp: 3 },
    { id: 'stress_hair', tone: 'debuff', label: '体力弱体化 -1', attack: 3, hp: 2 }
  ]) {
    test(`AIバトルの装備後に強化・弱体化が見え、再描画後も残る ${equipment.id} ${reducedMotion}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion });
      await page.goto(gameUrl);
      await page.evaluate(() => { startCardTest('dark_yuta'); scheduleOpponentAI = () => {}; });
      await page.evaluate(() => waitForBattlePresentation());
      await page.evaluate(id => {
        state.training.active = false;
        state.training.skipAnimations = false;
        state.aiBattle.active = true;
        state.currentSide = 'player';
        state.players.player.hand = [createCardFromBase(id, 'player')];
        state.players.player.will = 10;
        render();
      }, equipment.id);
      await page.evaluate(() => waitForBattlePresentation());
      await page.evaluate(() => beginItemUse(state.players.player.hand[0]));
      const wearer = page.locator('.board-card[data-owner="player"][data-zone="seat"][data-index="4"]');
      await expect(wearer).toHaveClass(/effect-target-candidate/);
      await wearer.click();
      await page.locator('#itemTargetConfirmButton').click();
      await expect(page.locator('#playRevealOverlay')).toBeVisible();
      await expect(page.locator('#playRevealOverlay')).toBeHidden();
      const feedback = wearer.locator('.board-change-feedback');
      await expect(feedback).toHaveAttribute('aria-label', new RegExp(equipment.label.replace('+', '\\+')));
      const energy = feedback.locator(`.board-change-effect.${equipment.tone} .board-change-energy-image`);
      await expect.poll(() => energy.evaluate(node => Number(getComputedStyle(node).opacity))).toBeGreaterThan(.2);
      await page.evaluate(() => render());
      await expect.poll(() => energy.evaluate(node => Number(getComputedStyle(node).opacity))).toBeGreaterThan(.2);
      expect(await page.evaluate(() => {
        const card = state.players.player.board.seats[4];
        return { attack: card.attack, hp: card.maxHp };
      })).toEqual({ attack: equipment.attack, hp: equipment.hp });
      await page.screenshot({ path: test.info().outputPath('equipment-feedback.png') });
      await expect(feedback).toHaveCount(0, { timeout: 2500 });
      await page.evaluate(() => render());
      await expect(feedback).toHaveCount(0);
    });
  }
}
