const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const storageKey = 'chibattle-dungeon-card-styles-v1';

function encryptedFile(clearData) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.pbkdf2Sync('test-password', salt, 250000, 32, 'sha256'), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ clearData })), cipher.final(), cipher.getAuthTag()]);
  return { name: 'test.chibaclear', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify({
    format: 'chibattle-dungeon-clear-data', version: 2,
    crypto: { algorithm: 'AES-GCM', kdf: 'PBKDF2', hash: 'SHA-256', iterations: 250000, salt: salt.toString('base64'), iv: iv.toString('base64') },
    ciphertext: ciphertext.toString('base64')
  })) };
}

async function importFile(page, data) {
  await page.locator('#dungeonClearDataImportInput').setInputFiles(encryptedFile(data));
  await page.locator('#dungeonClearDataPassword').fill('test-password');
  await page.locator('#dungeonClearDataConfirmButton').click();
  await expect(page.locator('#dungeonClearDataModal')).toBeHidden();
}

test('暗号化ファイルでのみ新しい種類を解放し、再起動・再保存・オンラインで選択を維持する', async ({ page }) => {
  await page.goto(url);
  await importFile(page, { cardUnlocks: { general_student: { rare: true } }, selected: { general_student: 'rare' } });
  await importFile(page, { cardUnlocks: { general_student: { superRare: true, reward: true } }, mergeUnlocks: true });
  await page.reload();
  await page.locator('#homeNavDeckButton').click();
  await page.locator('[data-case-view="library"]').click();
  await page.locator('#deckLibraryGrid .new-deck').click();
  await page.locator('[data-card-test="general_student"]').click();
  const detail = page.locator('#caseEditorCard');
  const button = detail.locator('[data-editor-style]');
  await expect(button).toContainText('レア');
  await expect(detail.locator('.card')).toHaveClass(/rarity-rare/);
  await button.click();
  await expect(button).toContainText('スーパーレア');
  await expect(detail.locator('.card')).toHaveClass(/rarity-super-rare/);
  await page.reload();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.cardUnlocks).toEqual({ general_student: { rare: true, superRare: true, ultraRare: true } });
  expect(saved.selected.general_student).toBe('superRare');
  const styles = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('general_student');
    api.state.online.role = 'host';
    api.state.online.clientId = 'local-unlock-fixture';
    api.onlineHandleMessage({ type: 'roomState', protocol: 1, roomStateSeq: 1,
      players: [{ role: 'host', clientId: 'local-unlock-fixture', cardStyles: {} }] });
    return api.onlineCreateSnapshot().cardStyles.host;
  });
  expect(styles.general_student).toBe('superRare');
});

test('追加ウルトラレアは明示的なファイル読み込み後だけ利用できる', async ({ page }) => {
  await page.goto(url);
  await importFile(page, { cardUnlocks: { general_student: { reward: true } }, selected: { general_student: 'reward' } });
  await page.reload();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('general_student');
    api.state.players.player.hand = ['general_student', 'classroom'].map(id => api.createCardFromBase(id, 'player'));
    api.render();
  });
  await expect(page.locator('#playerHand [data-base-id="general_student"]')).toHaveClass(/rarity-ultra-rare/);
  await expect(page.locator('#playerHand [data-base-id="classroom"]')).not.toHaveClass(/reward-foil/);
});

test('全解放だけでは表示を変えず、選択指定付きの修正ファイルは解放を残して通常表示へ戻す', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('chibattle-dungeon-card-styles-v1')) {
      localStorage.setItem('chibattle-dungeon-card-styles-v1', JSON.stringify({
        unlocked: { gakuyukai_item: true }, selected: { yuta: 'reward' }
      }));
    }
  });
  await page.goto(url);
  const unlocks = { general_student: { rare: true, superRare: true, reward: true }, yuta: { rare: true, superRare: true, reward: true } };
  await importFile(page, { cardUnlocks: unlocks, selected: {}, mergeUnlocks: true });
  let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.selected.general_student).toBe('normal');
  expect(saved.selected.yuta).toBe('secretRare');
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('general_student');
    api.state.players.player.hand = ['general_student', 'yuta'].map(id => api.createCardFromBase(id, 'player'));
    api.render();
  });
  await expect(page.locator('#playerHand [data-base-id="general_student"]')).not.toHaveClass(/reward-foil|rarity-/);
  await expect(page.locator('#playerHand [data-base-id="yuta"]')).toHaveClass(/reward-foil/);
  await importFile(page, { cardUnlocks: unlocks, selected: { general_student: 'normal', yuta: 'normal' }, mergeUnlocks: true });
  saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.cardUnlocks).toEqual({
    general_student: { rare: true, superRare: true, ultraRare: true },
    yuta: { rare: true, superRare: true, secretRare: true }
  });
  expect(saved.unlocked).toEqual({ gakuyukai_item: true });
  expect(saved.selected).toEqual({ general_student: 'normal', yuta: 'normal' });
  await page.reload();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('yuta');
    api.state.players.player.hand = [api.createCardFromBase('yuta', 'player')];
    api.render();
  });
  await expect(page.locator('#playerHand [data-base-id="yuta"]')).not.toHaveClass(/reward-foil/);
});

test('ダンジョンの旧報酬とプロフィールをシークレットへ移行し、新しいウルトラは解放しない', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('chibattle-dungeon-card-styles-v1')) return;
    localStorage.setItem('chibattle-dungeon-card-styles-v1', JSON.stringify({
      unlocked: { gakuyukai_item: true }, selected: { yuta: 'reward', dark_yuta: 'normal' }
    }));
    localStorage.setItem('chibattle-player-profile-v1', JSON.stringify({
      username: '旧報酬', favoriteCardId: 'yuta', favoriteCardStyle: 'reward'
    }));
  });
  await page.goto(url);
  expect(await page.evaluate(() => window.__chibattle.state.profile.favoriteCardStyle)).toBe('secretRare');
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('yuta');
    api.state.players.player.hand = ['yuta', 'dark_yuta'].map(id => api.createCardFromBase(id, 'player'));
    api.render();
    api.showBattleCardPreview(api.state.players.player.hand[0]);
  });
  await expect(page.locator('#playerHand [data-base-id="yuta"]')).toHaveClass(/rarity-secret-rare/);
  await expect(page.locator('#playerHand [data-base-id="yuta"]')).toHaveClass(/reward-foil-gakuyukai/);
  await expect(page.locator('#playerHand [data-base-id="dark_yuta"]')).not.toHaveClass(/rarity-|reward-foil/);
  await expect(page.locator('#battleCardPreview .rarity-mirror-surface')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('secret-preserved.png') });
  await importFile(page, { cardUnlocks: { yuta: { rare: true, superRare: true, ultraRare: true } }, mergeUnlocks: true });
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).selected, storageKey)).toEqual({ yuta: 'secretRare', dark_yuta: 'normal' });
  await page.reload();
  await page.locator('#homeNavDeckButton').click();
  await page.locator('[data-case-view="library"]').click();
  await page.locator('#deckLibraryGrid .new-deck').click();
  await page.locator('[data-card-test="yuta"]').click();
  const button = page.locator('#caseEditorCard [data-editor-style]');
  const expected = ['シークレットレア', 'レギュラー', 'レア', 'スーパーレア', 'ウルトラレア', 'シークレットレア'];
  for (let index = 0; index < expected.length; index++) {
    if (index) await button.click();
    await expect(button).toContainText(expected[index]);
  }
  const save = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(save.cardUnlocks.yuta.ultraRare).toBe(true);
  expect(save.selected.yuta).toBe('secretRare');
});

test('新しい宝箱もシークレットだけ解放し、ウルトラを付与しない', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('chibattle-dungeon-pending-reward-v1', JSON.stringify({ specialtyId: 'gakuyukai_item' })));
  await page.goto(url);
  await page.evaluate(() => document.getElementById('dungeonRewardResumeButton').click());
  await page.locator('#dungeonRewardChest').click();
  await expect(page.locator('#dungeonRewardCopy')).toContainText('シークレットレア');
  await expect(page.locator('#dungeonRewardCards .rarity-secret-rare')).toHaveCount(2);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.unlocked).toEqual({ gakuyukai_item: true });
  expect(saved.selected).toEqual({ yuta: 'secretRare', dark_yuta: 'secretRare' });
  expect(saved.cardUnlocks).toBeUndefined();
});
