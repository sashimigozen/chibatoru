const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    window.copiedCodes = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async code => copiedCodes.push(code)
    } });
  });
});

for (const mode of ['private', 'random', 'battle', 'four']) test(`${mode}: 部屋番号をクリック・キーボードでコピーできる`, async ({ page }) => {
  const selector = await page.evaluate(mode => {
    if (mode === 'battle') startCardTest('general_student');
    Object.assign(state.online, { role: 'host', roomCode: 'ABC234', connected: true, started: mode === 'battle',
      matchMode: mode === 'random' ? 'random' : 'private', lobbyView: 'private' });
    state.screen = mode === 'four' ? 'fourSetup' : mode === 'battle' ? 'battle' : 'online';
    render();
    if (mode === 'four') {
      __chibattleFour.four.online.roomCode = 'ABC234'; __chibattleFour.render();
    }
    return ({ private: '#onlineRoomCode', random: '#onlineRandomRoomCode', battle: '#battleRoomCodeValue', four: '#fourRoomCode' })[mode];
  }, mode);
  const number = page.locator(selector);
  if (mode !== 'battle') await expect(number).toBeVisible();
  await expect(number).toHaveAttribute('aria-disabled', 'false');
  const bounds = await number.boundingBox();
  if (mode === 'battle') await number.evaluate(node => node.click());
  else await number.click();
  await expect.poll(() => page.evaluate(() => copiedCodes)).toEqual(['ABC234']);
  await expect(number).not.toHaveClass(/room-code-copied/);
  expect(await number.evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
  expect(await number.boundingBox()).toEqual(bounds);
  if (mode === 'battle') await number.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  else await number.press('Enter');
  await expect.poll(() => page.evaluate(() => copiedCodes.length)).toBe(2);
  if (mode === 'private') await page.screenshot({ path: test.info().outputPath('room-code-copied.png') });
});

test('未発行・MATCH表記はコピーせず、番号変更後は新しい番号をコピーする', async ({ page }) => {
  await page.evaluate(async () => {
    const element = document.getElementById('onlineRoomCode');
    for (const code of ['------', 'MATCH', '検索中', 'XYZ789']) {
      element.textContent = code; element.click(); await Promise.resolve();
    }
  });
  expect(await page.evaluate(() => copiedCodes)).toEqual(['XYZ789']);
});

test('Clipboard API拒否時は既存ブラウザ向けのコピー方法へ切り替える', async ({ page }) => {
  expect(await page.evaluate(async () => {
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    document.execCommand = command => { window.fallbackCopy = [command, document.activeElement.value]; return true; };
    const copied = await copyRoomCode('ABC234');
    return [copied, fallbackCopy, document.querySelectorAll('textarea').length];
  })).toEqual([true, ['copy', 'ABC234'], 0]);
});
