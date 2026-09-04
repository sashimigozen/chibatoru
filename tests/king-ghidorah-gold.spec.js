const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const storageKey = "chibattle-dungeon-card-styles-v1";

function clearFile(clearData) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync("test-password", salt, 250000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ clearData })), cipher.final(), cipher.getAuthTag()]);
  return { name: "reward.chibaclear", mimeType: "application/octet-stream", buffer: Buffer.from(JSON.stringify({
    format: "chibattle-dungeon-clear-data", version: 2,
    crypto: { algorithm: "AES-GCM", kdf: "PBKDF2", hash: "SHA-256", iterations: 250000, salt: salt.toString("base64"), iv: iv.toString("base64") },
    ciphertext: ciphertext.toString("base64")
  })) };
}

async function importFile(page, clearData) {
  await page.locator("#dungeonClearDataImportInput").setInputFiles(clearFile(clearData));
  await page.locator("#dungeonClearDataPassword").fill("test-password");
  await page.locator("#dungeonClearDataConfirmButton").click();
  await expect(page.locator("#dungeonClearDataModal")).toBeHidden();
}

test("金枠の追加解放は既存の解放と通常表示設定を保持し、再読み込み後も残る", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ unlocked: { design: true }, selected: { bird_a: "normal" } })), storageKey);
  await page.reload();
  expect(await page.evaluate(() => window.__chibattle.createCardFromBase("king_ghidorah_bed", "player").rewardFoilStyle)).toBe("");
  await importFile(page, { unlocked: { king_ghidorah_bed: true }, selected: { king_ghidorah_bed: "reward" }, mergeUnlocks: true });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)).toEqual({
    unlocked: { design: true, king_ghidorah_bed: true }, selected: { bird_a: "normal", king_ghidorah_bed: "reward" }
  });
  await page.reload();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("king_ghidorah_bed");
    api.showBattleCardPreview(api.state.players.player.hand.find((card) => card.baseId === "king_ghidorah_bed"));
  });
  await expect(page.locator('#playerHand [data-base-id="king_ghidorah_bed"]').first()).toHaveClass(/reward-foil-king-ghidorah/);
  const card = page.locator("#battleCardPreview .card.reward-foil-king-ghidorah");
  await expect(card).toBeVisible();
  const visuals = await card.evaluate((el) => ({ face: getComputedStyle(el).getPropertyValue("--reward-foil-face"), animation: getComputedStyle(el).animationName }));
  expect(visuals.face).toContain("gradient");
  expect(visuals.animation).toContain("reward-foil-template-band");
});

test("従来のクリアデータの復元方式は変わらない", async ({ page }) => {
  await page.goto(gameUrl);
  await importFile(page, { unlocked: { king_ghidorah_bed: true }, selected: { king_ghidorah_bed: "reward" }, mergeUnlocks: true });
  await importFile(page, { unlocked: { design: true }, selected: { bird_a: "reward" } });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)).toEqual({ unlocked: { design: true }, selected: { bird_a: "reward" } });
});

test("オンラインの金枠表示は所持者の選択だけに従う", async ({ page }) => {
  await page.goto(gameUrl);
  const styles = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.online.started = true;
    api.state.online.role = "guest";
    api.state.online.localCardStyles = { king_ghidorah_bed: "reward" };
    api.state.online.remoteCardStyles = {};
    const own = api.createCardFromBase("king_ghidorah_bed", "player");
    const other = api.createCardFromBase("king_ghidorah_bed", "opponent");
    api.state.online.role = "spectator";
    api.state.online.hostCardStyles = {};
    api.state.online.guestCardStyles = { king_ghidorah_bed: "reward" };
    return [own.rewardFoilStyle, other.rewardFoilStyle,
      api.createCardFromBase("king_ghidorah_bed", "player").rewardFoilStyle,
      api.createCardFromBase("king_ghidorah_bed", "opponent").rewardFoilStyle];
  });
  expect(styles).toEqual(["king-ghidorah", "", "", "king-ghidorah"]);
});
