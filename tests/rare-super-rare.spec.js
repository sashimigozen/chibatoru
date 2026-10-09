const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

function materials(el) {
  const stage = el.querySelector('.card-scale-stage');
  const face = el.querySelector('.card-face');
  const fields = ['backgroundImage', 'backgroundColor', 'color', 'borderRadius', 'borderWidth', 'padding'];
  const style = node => Object.fromEntries(fields.map(key => [key, getComputedStyle(node)[key]]));
  return {
    stage: style(stage), face: style(face),
    panels: [...face.querySelectorAll('.card-header,.card-art-panel,.card-effect-panel')].map(style),
    text: el.innerText,
    animations: [stage, face].flatMap(node => [null, '::before', '::after'].map(pseudo => getComputedStyle(node, pseudo).animationName))
  };
}

test('レアは通常の面に共通ミラー光、スーパーレアは銀枠を加え中身を変えない', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => window.__chibattle.startCardTest('yuta'));
  for (const baseId of ['general_student', 'yuta', 'vampire', 'ruler', 'classroom', 'tokyo_tech_bro']) {
    const results = {};
    for (const mode of ['normal', 'rare', 'superRare', 'ultraRare']) {
      await page.evaluate(({ baseId, mode }) => {
        const api = window.__chibattle;
        const card = api.createCardFromBase(baseId, 'player');
        // Explicit display fixture; it never grants ownership or modifies saves.
        card.profileStyleMode = mode;
        api.state.players.player.hand = [card];
        api.render();
        api.showBattleCardPreview(card);
      }, { baseId, mode });
      const hand = page.locator(`#playerHand [data-base-id="${baseId}"]`);
      results[mode] = await hand.evaluate(materials);
      if (mode === 'rare' || mode === 'superRare' || mode === 'ultraRare') {
        await expect(hand).not.toHaveClass(/reward-foil|reward-prism/);
        expect(results[mode].animations.some(name => /reward-foil|reward-prism/.test(name))).toBe(false);
        await expect(hand.locator('.rarity-mirror-surface')).toHaveCount(1);
        const mirror = await hand.locator('.rarity-mirror-surface').evaluate(el => ({
          overflow: getComputedStyle(el).overflow, pointer: getComputedStyle(el).pointerEvents,
          animation: getComputedStyle(el, '::before').animationName,
          duration: getComputedStyle(el, '::before').animationDuration
        }));
        expect(mirror).toEqual({ overflow: 'hidden', pointer: 'none', animation: 'reward-foil-shine', duration: '4.8s' });
        await expect(page.locator('#battleCardPreview .rarity-mirror-surface')).toHaveCount(1);
      } else {
        await expect(hand.locator('.rarity-mirror-surface')).toHaveCount(0);
      }
      if (mode === 'superRare') {
        await expect(hand).toHaveClass(/rarity-super-rare/);
        const preview = await page.locator('#battleCardPreview > .card').evaluate(materials);
        expect(preview.stage.backgroundImage).toBe(results[mode].stage.backgroundImage);
        expect(parseFloat(preview.stage.borderWidth)).toBeCloseTo(20, 0);
        if (baseId === 'yuta') {
          await page.locator('.rarity-mirror-surface').evaluateAll(elements => {
            for (const el of elements) for (const animation of el.getAnimations({ subtree: true })) {
              animation.pause();
              animation.currentTime = 2200;
            }
          });
          await page.screenshot({ path: test.info().outputPath('silver-frame.png') });
        }
      }
      if (mode === 'ultraRare') {
        await expect(hand).toHaveClass(/rarity-ultra-rare/);
        if (baseId === 'yuta') {
          await page.locator('.rarity-mirror-surface').evaluateAll(elements => {
            for (const el of elements) for (const animation of el.getAnimations({ subtree: true })) {
              animation.pause();
              animation.currentTime = 2200;
            }
          });
          await page.screenshot({ path: test.info().outputPath('ultra-gold.png') });
        }
      }
    }
    expect(results.rare).toEqual(results.normal);
    expect(results.superRare.face).toEqual(results.rare.face);
    expect(results.superRare.panels).toEqual(results.rare.panels);
    expect(results.superRare.text).toBe(results.rare.text);
    expect(results.superRare.stage.borderWidth).toBe(results.ultraRare.stage.borderWidth);
    expect(results.superRare.stage.borderRadius).toBe(results.ultraRare.stage.borderRadius);
    expect(results.superRare.stage.backgroundImage).not.toBe(results.ultraRare.stage.backgroundImage);
    expect(results.superRare.face).toEqual(results.ultraRare.face);
    expect(results.superRare.panels).toEqual(results.ultraRare.panels);
    expect(results.superRare.text).toBe(results.ultraRare.text);
  }
});

test('全カードに未対応ウルトラレアの描画を用意し、新しいレアリティは解放しない', async ({ page }) => {
  const save = { unlocked: { gakuyukai_item: true, king_ghidorah_bed: true }, selected: { yuta: 'reward', king_ghidorah_bed: 'prism' }, prismUnlocked: { king_ghidorah_bed: true } };
  await page.addInitScript(save => localStorage.setItem('chibattle-dungeon-card-styles-v1', JSON.stringify(save)), save);
  await page.goto(url);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('yuta');
    api.state.players.player.hand = Object.keys(api.CARD_BASES).map(id => {
      const card = api.createCardFromBase(id, 'player');
      card.profileStyleMode = 'ultraRare';
      return card;
    });
    api.render();
  });
  const total = await page.evaluate(() => Object.keys(window.__chibattle.CARD_BASES).length);
  await expect(page.locator('#playerHand .hand-card.rarity-ultra-rare')).toHaveCount(total);
  await expect(page.locator('#playerHand .rarity-mirror-surface')).toHaveCount(total);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.hand = ['general_student', 'yuta', 'king_ghidorah_bed'].map(id => api.createCardFromBase(id, 'player'));
    api.render();
  });
  await expect(page.locator('#playerHand [data-base-id="general_student"]')).not.toHaveClass(/reward-foil|rarity-/);
  await expect(page.locator('#playerHand [data-base-id="yuta"]')).toHaveClass(/reward-foil/);
  await expect(page.locator('#playerHand [data-base-id="king_ghidorah_bed"]')).toHaveClass(/reward-prism/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chibattle-dungeon-card-styles-v1')))).toEqual(save);
});

test('銀枠は講義室・出席演出にも共通し、オンラインでは持ち主の設定を参照する', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('yuta');
    api.state.players.player.board.seats = Array(9).fill(null);
    api.state.players.opponent.board.seats = Array(9).fill(null);
    const silver = api.makeBoardCard(api.createCardFromBase('general_student', 'player'));
    silver.profileStyleMode = 'superRare';
    api.state.players.player.board.seats[0] = silver;
    api.render();
    api.showCardPlayAnimation(silver, 'trash');
  });
  const silver = page.locator('.board-card[data-base-id="general_student"]');
  await expect(silver).toHaveClass(/rarity-super-rare/);
  await expect(silver.locator('.rarity-mirror-surface')).toHaveCount(1);
  expect(await silver.evaluate(el => getComputedStyle(el).borderColor)).toBe('rgb(184, 195, 207)');
  await expect(page.locator('#playRevealCard .card')).toHaveClass(/rarity-super-rare/);
  await expect(page.locator('#playRevealCard .rarity-mirror-surface')).toHaveCount(1);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.hidePlayReveal();
    const online = api.state.online;
    online.role = 'guest';
    online.started = true;
    online.connected = true;
    online.clientId = 'guest-fixture';
    online.remoteClientId = 'host-fixture';
    api.onlineHandleMessage({ type: 'roomState', protocol: 1, roomStateSeq: 1, players: [
      { role: 'host', clientId: 'host-fixture', cardStyles: { general_student: 'superRare', classroom: 'reward' } },
      { role: 'guest', clientId: 'guest-fixture', cardStyles: {} }
    ] });
    // Simulate a published local selection without granting real ownership.
    online.localCardStyles = { general_student: 'rare' };
    api.state.players.player.board.seats[0] = api.makeBoardCard(api.createCardFromBase('general_student', 'player'));
    api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase('general_student', 'opponent'));
    api.render();
  });
  await expect(page.locator('.board-card[data-base-id="general_student"].rarity-super-rare')).toHaveCount(1);
  await expect(page.locator('.board-card[data-base-id="general_student"].rarity-rare')).toHaveCount(1);
  expect(await page.evaluate(() => window.__chibattle.state.online.remoteCardStyles)).toEqual({ general_student: 'superRare', classroom: 'ultraRare' });
});

test('ミラー光は移動し、動きを減らす設定では停止する', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('yuta');
    const card = api.createCardFromBase('yuta', 'player');
    card.profileStyleMode = 'rare';
    api.state.players.player.hand = [card];
    api.render();
  });
  const surface = page.locator('#playerHand .rarity-mirror-surface');
  const transforms = await surface.evaluate(el => {
    const animation = el.getAnimations({ subtree: true })[0];
    animation.pause();
    animation.currentTime = 1500;
    const first = getComputedStyle(el, '::before').transform;
    animation.currentTime = 2800;
    return [first, getComputedStyle(el, '::before').transform];
  });
  expect(transforms[0]).not.toBe(transforms[1]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await surface.evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none');
});

test('古い汎用金枠のスナップショットも新しいウルトラとして表示する', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('general_student');
    const card = api.createCardFromBase('general_student', 'player');
    card.rewardFoilStyle = 'generic';
    api.state.players.player.hand = [card];
    api.render();
    api.showCardPlayAnimation(card, 'trash');
  });
  await expect(page.locator('#playerHand .hand-card')).toHaveClass(/rarity-ultra-rare/);
  await expect(page.locator('#playerHand .hand-card')).not.toHaveClass(/rarity-secret-rare|reward-foil/);
  await expect(page.locator('#playRevealCard .rarity-ultra-rare .rarity-mirror-surface')).toHaveCount(1);
});
