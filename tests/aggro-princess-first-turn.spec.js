const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("アグロプリンセスは先攻1ターン目でも相手本体を攻撃できる", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.testMode = false;
    state.screen = "battle";
    state.phase = "battle";
    state.gameOver = false;
    state.firstSide = "player";
    state.currentSide = "player";
    state.actionTurn = 1;
    state.noAttackUntilActionTurn = 0;
    state.environment = null;
    state.players.player.turnsTaken = 1;
    state.players.opponent.turnsTaken = 0;
    state.players.player.board = { teacher: null, seats: Array(9).fill(null) };
    state.players.opponent.board = { teacher: null, seats: Array(9).fill(null) };

    const princess = api.makeBoardCard(api.createCardFromBase("aggro_princess", "player"));
    princess.playedOnTurn = state.actionTurn;
    state.players.player.board.seats[0] = princess;
    state.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
    const availability = {
      canAttack: api.canAttackSilently(princess),
      canAttackLife: api.canSelectedAttackerTargetLife("opponent")
    };
    api.render();
    return availability;
  });

  expect(result).toEqual({ canAttack: true, canAttackLife: true });
  await page.evaluate(() => document.querySelector("#opponentLifeTarget").click());
  await expect.poll(() => page.evaluate(() => window.__chibattle.state.players.opponent.life)).toBe(19);
  expect(await page.evaluate(() => window.__chibattle.state.players.player.life)).toBe(19);
});

test("先攻1ターン目の陽気は出席者を攻撃でき、後攻1ターン目の超陽気は本体を攻撃できる", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const setup = (side, baseId, actionTurn) => {
      const targetSide = side === "player" ? "opponent" : "player";
      state.testMode = false;
      state.phase = "battle";
      state.gameOver = false;
      state.firstSide = "player";
      state.currentSide = side;
      state.actionTurn = actionTurn;
      state.noAttackUntilActionTurn = 0;
      state.environment = null;
      state.players.player.turnsTaken = 1;
      state.players.opponent.turnsTaken = side === "opponent" ? 1 : 0;
      state.players.player.board = { teacher: null, seats: Array(9).fill(null) };
      state.players.opponent.board = { teacher: null, seats: Array(9).fill(null) };
      const card = api.makeBoardCard(api.createCardFromBase(baseId, side));
      card.playedOnTurn = actionTurn;
      state.players[side].board.seats[0] = card;
      state.selectedAttacker = { owner: side, zone: "seat", index: 0 };
      return {
        canAttack: api.canAttackSilently(card),
        canAttackLife: api.canSelectedAttackerTargetLife(targetSide)
      };
    };

    return {
      firstCheerful: setup("player", "absolute_woman", 1),
      secondSuperCheerful: setup("opponent", "aggro_princess", 2)
    };
  });

  expect(result).toEqual({
    firstCheerful: { canAttack: true, canAttackLife: false },
    secondSuperCheerful: { canAttack: true, canAttackLife: true }
  });
});

test("ver.0.23.9の更新情報に先攻1ターン目の超陽気修正を表示する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.23.9" }) });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("通常の陽気を持つ出席者も相手の出席者を攻撃できます");
  await expect(entry).toContainText("超陽気を持つ出席者は相手本体にも攻撃できます");
  await expect(entry).toContainText("負荷が付いたカードには薄い紫色");
  await expect(entry).toContainText("高負荷が付いたカードには薄い赤色");
  await expect(entry).toContainText("高負荷になったカードは戦意が+1されます");
});
