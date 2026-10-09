const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test('金枠・プリズム枠は通常カードと同じ角、エースぺは外側に装飾を描かない', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('chibattle-dungeon-card-styles-v1', JSON.stringify({
    unlocked: { gakuyukai_item: true, king_ghidorah_bed: true },
    prismUnlocked: { king_ghidorah_bed: true }, selected: { yuta: 'gold', king_ghidorah_bed: 'prism' }
  })));
  await page.goto(url);
  await page.locator('#homeNavDeckButton').click();
  await page.locator('[data-case-view="library"]').click();
  await page.locator('#deckLibraryGrid .new-deck').click();
  const geometry = el => {
    const stage = el.querySelector('.card-scale-stage');
    const face = el.querySelector('.card-face');
    const rect = el.getBoundingClientRect();
    const inner = stage.getBoundingClientRect();
    return { radius: getComputedStyle(stage).borderRadius, faceRadius: getComputedStyle(face).borderRadius,
      before: getComputedStyle(el, '::before').display, after: getComputedStyle(el, '::after').display,
      background: getComputedStyle(el).backgroundImage, ink: getComputedStyle(face).color,
      ratio: rect.width / rect.height, fits: inner.left >= rect.left - 1 && inner.right <= rect.right + 1 && inner.bottom <= rect.bottom + 1 };
  };
  const ordinary = await page.locator('[data-card-test="general_student"] .card').evaluate(geometry);
  for (const [id, rarity] of [['yuta', /reward-foil/], ['king_ghidorah_bed', /reward-prism/]]) {
    const card = page.locator(`[data-card-test="${id}"] .card`);
    await expect(card).toHaveClass(rarity);
    const actual = await card.evaluate(geometry);
    expect(actual.radius).toBe(ordinary.radius);
    expect(actual.faceRadius).toBe(ordinary.faceRadius);
    expect(actual.ratio).toBeCloseTo(21 / 32, 2);
    expect(actual.fits).toBe(true);
    await page.locator(`[data-card-test="${id}"]`).click();
    await expect.poll(() => page.locator('#caseEditorCard .card').evaluate(geometry)).toMatchObject({ radius: ordinary.radius, faceRadius: ordinary.faceRadius, fits: true });
    await page.screenshot({ path: test.info().outputPath(`${id}-frame.png`) });
  }
  for (const id of ['tokyo_tech_bro', 'think_so', 'forbidden_book']) {
    const card = page.locator(`[data-card-test="${id}"] .card`);
    await expect(card).toHaveClass(/ace-card/);
    const actual = await card.evaluate(geometry);
    expect(actual).toMatchObject({ before: 'none', after: 'none', background: 'none', fits: true, ink: 'rgb(67, 20, 7)' });
    await page.locator(`[data-card-test="${id}"]`).click();
    await expect.poll(() => page.locator('#caseEditorCard .card').evaluate(geometry)).toMatchObject({ before: 'none', after: 'none', background: 'none', fits: true });
  }
  await page.screenshot({ path: test.info().outputPath('card-frames.png') });
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('yuta');
    api.state.players.player.hand = ['general_student', 'yuta', 'king_ghidorah_bed', 'tokyo_tech_bro'].map(id => api.createCardFromBase(id, 'player'));
    api.render();
  });
  for (const id of ['yuta', 'king_ghidorah_bed', 'tokyo_tech_bro']) {
    const actual = await page.locator(`#playerHand [data-base-id="${id}"]`).evaluate(geometry);
    expect(actual.radius).toBe(ordinary.radius);
    expect(actual.faceRadius).toBe(ordinary.faceRadius);
    expect(actual.ratio).toBeCloseTo(21 / 32, 2);
  }
});
