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
  await expect(card.locator(".reward-prism-surface")).toHaveCount(0);
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

test("キラキラ金枠を別解放して通常・金枠と切り替え、保存後も区別する", async ({ page }) => {
  await page.goto(gameUrl);
  await importFile(page, { unlocked: { king_ghidorah_bed: true, design: true }, selected: { bird_a: "normal" } });
  await importFile(page, { prismUnlocked: { king_ghidorah_bed: true }, selected: { king_ghidorah_bed: "prism" }, mergeUnlocks: true });
  await page.reload();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)).toEqual({
    unlocked: { king_ghidorah_bed: true, design: true }, selected: { bird_a: "normal", king_ghidorah_bed: "prism" }, prismUnlocked: { king_ghidorah_bed: true }
  });
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "deck";
    api.state.deckBuilder.view = "editor";
    api.state.deckBuilder.activeSide = "player";
    api.state.deckBuilder.counts.player = { king_ghidorah_bed: 1 };
    api.render();
  });
  await page.locator('[data-current-detail="king_ghidorah_bed"]').click();
  const modal = page.locator("#cardTestCard");
  await expect(modal.locator(".card-rarity-label")).toHaveText("キラキラ金枠");
  await expect(modal.locator(".reward-prism-surface")).toHaveCount(1);
  await modal.locator("[data-card-style-cycle]").click();
  await expect(modal.locator(".card-rarity-label")).toHaveText("通常");
  await expect(modal.locator(".reward-foil")).toHaveCount(0);
  await modal.locator("[data-card-style-cycle]").click();
  await expect(modal.locator(".card-rarity-label")).toHaveText("金枠");
  await expect(modal.locator(".reward-foil")).toHaveCount(1);
  await expect(modal.locator(".reward-prism-surface")).toHaveCount(0);
  await modal.locator("[data-card-style-cycle]").click();
  await expect(modal.locator(".card-rarity-label")).toHaveText("キラキラ金枠");
  await expect(modal.locator(".reward-prism-surface")).toHaveCount(1);
});

test("通常金枠の解放だけではキラキラ金枠にならず、キラキラ単独解放も可能", async ({ page }) => {
  await page.goto(gameUrl);
  await importFile(page, { unlocked: { king_ghidorah_bed: true }, selected: { king_ghidorah_bed: "prism" } });
  expect(await page.evaluate(() => window.__chibattle.createCardFromBase("king_ghidorah_bed", "player").rewardFoilStyle)).toBe("king-ghidorah");
  await importFile(page, { prismUnlocked: { king_ghidorah_bed: true }, selected: { king_ghidorah_bed: "prism" } });
  expect(await page.evaluate(() => window.__chibattle.createCardFromBase("king_ghidorah_bed", "player").rewardFoilStyle)).toBe("king-ghidorah-prism");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).unlocked, storageKey)).toEqual({});
  await importFile(page, { unlocked: { design: true }, selected: {} });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).prismUnlocked, storageKey)).toBeUndefined();
});

test("キラキラ金枠のオンライン表示は対戦相手・観戦者にも所持者ごとに分離する", async ({ page }) => {
  await page.goto(gameUrl);
  const styles = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.online.started = true;
    api.state.online.role = "guest";
    api.state.online.localCardStyles = { king_ghidorah_bed: "prism" };
    api.state.online.remoteCardStyles = { king_ghidorah_bed: "reward" };
    const read = () => ["player", "opponent"].map((side) => api.createCardFromBase("king_ghidorah_bed", side).rewardFoilStyle);
    const player = read();
    api.state.online.role = "spectator";
    api.state.online.hostCardStyles = { king_ghidorah_bed: "reward" };
    api.state.online.guestCardStyles = { king_ghidorah_bed: "prism" };
    return [player, read()];
  });
  expect(styles).toEqual([["king-ghidorah-prism", "king-ghidorah"], ["king-ghidorah", "king-ghidorah-prism"]]);
});

test("クリアデータの再保存・復元でもキラキラ金枠の解放と選択を保持する", async ({ page }) => {
  await page.goto(gameUrl);
  const data = { unlocked: { design: true }, prismUnlocked: { king_ghidorah_bed: true }, selected: { bird_a: "normal", king_ghidorah_bed: "prism" } };
  await importFile(page, data);
  await page.locator("#dungeonClearDataSaveButton").evaluate((button) => button.click());
  await page.locator("#dungeonClearDataPassword").fill("test-password");
  await page.locator("#dungeonClearDataPasswordConfirm").fill("test-password");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#dungeonClearDataConfirmButton").click();
  const download = await downloadPromise;
  await importFile(page, { unlocked: { late: true }, selected: {} });
  await page.locator("#dungeonClearDataImportInput").setInputFiles(await download.path());
  await page.locator("#dungeonClearDataPassword").fill("test-password");
  await page.locator("#dungeonClearDataConfirmButton").click();
  await expect(page.locator("#dungeonClearDataModal")).toBeHidden();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)).toEqual(data);
});

test("旧全解放ファイルの対象外プリズムを除去し、既存金枠とキングギドラベッドだけ保持する", async ({ page }) => {
  await page.goto(gameUrl);
  await importFile(page, {
    unlocked: { design: true },
    prismUnlocked: { bird_a: true, king_ghidorah_bed: true },
    selected: { bird_a: "prism", king_ghidorah_bed: "prism" }, mergeUnlocks: true
  });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)).toEqual({
    unlocked: { design: true }, prismUnlocked: { king_ghidorah_bed: true }, selected: { bird_a: "reward", king_ghidorah_bed: "prism" }
  });
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("bird_a");
    api.state.online.started = true;
    api.state.online.role = "spectator";
    api.state.online.hostCardStyles = { bird_a: "prism" };
    api.showBattleCardPreview(api.createCardFromBase("bird_a", "player"));
  });
  await expect(page.locator("#battleCardPreview .reward-foil")).toHaveCount(1);
  await expect(page.locator("#battleCardPreview .reward-prism-surface")).toHaveCount(0);
});
