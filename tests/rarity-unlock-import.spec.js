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
  expect(saved.cardUnlocks).toEqual({ general_student: { rare: true, superRare: true, reward: true } });
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
  await expect(page.locator('#playerHand [data-base-id="general_student"]')).toHaveClass(/reward-foil-generic/);
  await expect(page.locator('#playerHand [data-base-id="classroom"]')).not.toHaveClass(/reward-foil/);
});
