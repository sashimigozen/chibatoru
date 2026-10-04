const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const rawRules = "このカードを手札から出席させたとき、自分の手札に「木っち（ぎっち）」1枚を生成する。このカードは講義を持たない。";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("wood_gitch");
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.players.player.board.teacher = null;
  });
});

test("木っちの定義・表示・本文を揃える", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, card = api.createCardFromBase("wood_gitch", "player");
    return { cost: card.cost, attack: card.attack, hp: card.hp, noLecture: card.noLecture, text: api.cardRulesText(card) };
  })).toEqual({ cost: 3, attack: 1, hp: 1, noLecture: true,
    text: "このカードを手札から出席させたとき、自分の手札に「木っち（ぎっち）」1枚を生成する。\nこのカードは[講義]を持たない。" });
  for (const file of ["index.html", "card_rules.txt"]) {
    expect(fs.readFileSync(path.join(__dirname, "..", file), "utf8")).toContain('wood_gitch: "' + rawRules + '"');
  }
});

for (const side of ["player", "opponent"]) {
  for (const empty of [false, true]) {
    test(side + "の手札出席は他の手札を変えず1枚生成する（空手札=" + empty + "）", async ({ page }) => {
      expect(await page.evaluate(({ side, empty }) => {
        const api = window.__chibattle, own = api.state.players[side];
        api.state.currentSide = side;
        own.will = 10;
        own.board.teacher = null;
        const source = api.createCardFromBase("wood_gitch", side), other = api.createCardFromBase("general_student", side);
        own.hand = empty ? [source] : [source, other];
        const placed = api.placeCardFromHand(side, source.instanceId, "teacher", side, null, false);
        return { placed, hand: own.hand.map(c => c.baseId), otherUnchanged: empty || own.hand[0] === other,
          fresh: own.hand.at(-1).instanceId !== source.instanceId, pending: api.state.pendingCardChoice };
      }, { side, empty })).toEqual({ placed: true, hand: empty ? ["wood_gitch"] : ["general_student", "wood_gitch"],
        otherUnchanged: true, fresh: true, pending: null });
    });
  }
}

test("効果による出席では手札生成しない", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, own = api.state.players.player;
    own.hand = [];
    const card = api.makeBoardCard(api.createCardFromBase("wood_gitch", "player"));
    const placed = api.attendCard("player", card, "teacher", null, { attendanceSource: "generated" });
    return { placed: Boolean(placed), hand: own.hand.length, lecture: card.noLecture };
  })).toEqual({ placed: true, hand: 0, lecture: true });
});

test("オンラインゲストは変化先選択を出さず通常の出席を送信する", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, sent = [];
    const source = api.state.players.player.hand.find(c => c.baseId === "wood_gitch");
    Object.assign(api.state.online, { connected: true, started: true, role: "guest", clientId: "guest-test", isApplyingRemote: false,
      conn: { open: true, send: value => sent.push(value) } });
    api.playCard(source.instanceId, "teacher", "player", null);
    return { pending: api.state.pendingCardChoice, commands: sent.filter(m => m.command).map(m => m.command.type) };
  })).toEqual({ pending: null, commands: ["playCard"] });
});
