const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("出席者の強化・弱体化・回復を一時演出し、ダメージや初回表示では出さない", async ({ page }) => {
  await page.goto(gameUrl);

  const instanceId = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.actionTurn = 2;
    state.currentSide = "player";
    ["player", "opponent"].forEach((side) => {
      state.players[side].board.seats = Array(9).fill(null);
      state.players[side].board.teacher = null;
    });
    const attendee = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    attendee.playedOnTurn = 1;
    state.players.player.board.seats[0] = attendee;
    api.render();
    return attendee.instanceId;
  });

  const card = page.locator(`[data-card-id="${instanceId}"]`);
  await expect(card.locator(".board-change-feedback")).toHaveCount(0);

  await page.evaluate(() => {
    const api = window.__chibattle;
    const attendee = api.state.players.player.board.seats[0];
    attendee.currentHp -= 1;
    api.render();
  });
  await expect(card.locator(".board-change-feedback")).toHaveCount(0);

  await page.evaluate(() => {
    const api = window.__chibattle;
    const attendee = api.state.players.player.board.seats[0];
    attendee.attack += 2;
    attendee.maxHp += 3;
    attendee.currentHp += 3;
    attendee.defense += 1;
    api.render();
  });
  const buffFeedback = card.locator(".board-change-feedback");
  await expect(buffFeedback).toBeAttached();
  await expect(buffFeedback).toHaveAttribute("aria-label", /攻撃力強化 \+2/);
  await expect(buffFeedback).toHaveAttribute("aria-label", /体力強化 \+3/);
  await expect(buffFeedback).toHaveAttribute("aria-label", /防御力強化 \+1/);
  await expect(buffFeedback.locator(".board-change-effect.buff .board-change-energy-image")).toHaveCount(1);
  await expect(buffFeedback.locator(".board-change-effect.buff .board-change-energy-slice")).toHaveCount(8);
  await expect(buffFeedback.locator(".board-change-heal-cross")).toHaveCount(5);
  await expect(buffFeedback.locator(".board-change-energy-image")).toHaveCSS("animation-name", "board-buff-energy-rise");
  await expect(buffFeedback.locator(".board-change-energy-image")).toHaveCSS("animation-delay", "0s");
  await expect(card.locator(".field-stat.attack i")).toHaveCount(0);
  await expect(card.locator(".field-stat.attack")).not.toContainText(/[↑↓]/);

  await page.evaluate(() => window.__chibattle.render());
  await expect(card.locator(".board-change-feedback")).toHaveCount(0);

  await page.evaluate(() => {
    const api = window.__chibattle;
    const attendee = api.state.players.player.board.seats[0];
    attendee.attack -= 1;
    attendee.maxHp -= 2;
    attendee.currentHp = Math.min(attendee.currentHp, attendee.maxHp);
    api.render();
  });
  const debuffFeedback = card.locator(".board-change-feedback");
  await expect(debuffFeedback).toBeAttached();
  await expect(debuffFeedback).toHaveAttribute("aria-label", /攻撃力弱体化 -1/);
  await expect(debuffFeedback).toHaveAttribute("aria-label", /体力弱体化 -2/);
  await expect(debuffFeedback.locator(".board-change-effect.debuff .board-change-energy-image")).toHaveCount(1);
  await expect(debuffFeedback.locator(".board-change-effect.debuff .board-change-energy-slice")).toHaveCount(8);
  await expect(debuffFeedback.locator(".board-change-energy-image")).toHaveCSS("animation-name", "board-debuff-energy-fall");
  await expect(debuffFeedback.locator(".board-change-energy-image")).toHaveCSS("animation-delay", "0s");
  await expect(card.locator(".field-stat.attack i")).toHaveCount(0);
  await expect(card.locator(".field-stat.attack")).not.toContainText(/[↑↓]/);

  await page.evaluate(() => {
    const api = window.__chibattle;
    const attendee = api.state.players.player.board.seats[0];
    attendee.keywords = [...new Set([...(attendee.keywords || []), "眠気"])];
    api.render();
  });
  await expect(card.locator(".board-change-feedback")).toHaveAttribute("aria-label", /眠気 付与/);

  await page.evaluate(() => {
    const api = window.__chibattle;
    const attendee = api.state.players.player.board.seats[0];
    attendee.currentHp -= 1;
    api.render();
  });
  await expect(card.locator(".board-change-feedback")).toHaveCount(0);

  await page.evaluate(() => {
    const api = window.__chibattle;
    const attendee = api.state.players.player.board.seats[0];
    attendee.currentHp += 1;
    api.render();
  });
  const healFeedback = card.locator(".board-change-feedback");
  await expect(healFeedback).toHaveAttribute("aria-label", /体力回復 \+1/);
  await expect(healFeedback.locator(".board-change-heal-cross")).toHaveCount(5);

  const newInstanceId = await page.evaluate(() => {
    const api = window.__chibattle;
    const newcomer = api.makeBoardCard(api.createCardFromBase("general_teacher", "player"));
    newcomer.playedOnTurn = 1;
    api.state.players.player.board.seats[0] = newcomer;
    api.render();
    return newcomer.instanceId;
  });
  await expect(page.locator(`[data-card-id="${newInstanceId}"] .board-change-feedback`)).toHaveCount(0);
});

test("形容詞学生の出席時効果で攻撃力+3に成功した初回表示にも強化演出を出す", async ({ page }) => {
  await page.goto(gameUrl);

  const instanceId = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.actionTurn = 3;
    state.currentSide = "player";
    state.players.player.board.seats = Array(9).fill(null);
    state.players.player.board.teacher = null;
    state.players.opponent.board.seats = Array(9).fill(null);
    state.players.opponent.board.teacher = null;
    const attendee = api.makeBoardCard(api.createCardFromBase("adjective_student", "player"));
    attendee.attack += 3;
    attendee.baseAttack += 3;
    attendee.playedOnTurn = state.actionTurn;
    state.players.player.board.seats[0] = attendee;
    api.render();
    return attendee.instanceId;
  });

  const card = page.locator(`[data-card-id="${instanceId}"]`);
  const feedback = card.locator(".board-change-feedback");
  await expect(feedback).toHaveAttribute("aria-label", /攻撃力強化 \+3/);
  await expect(feedback.locator(".board-change-effect.buff .board-change-energy-image")).toHaveCount(1);
  await expect(feedback.locator(".board-change-effect.buff .board-change-energy-slice")).toHaveCount(8);
  await expect(feedback.locator(".board-change-energy-image")).toHaveCSS("animation-delay", "0s");
  await expect(card.locator(".field-stat.attack")).toHaveText("5");
  await expect(card.locator(".field-stat.attack")).not.toContainText(/[↑↓]/);
});
