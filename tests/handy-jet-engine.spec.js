const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const text = "自分の手札をランダムに1枚、校外エリアへ送る。その後、相手の手札をランダムに2枚、校外エリアへ送る。";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => window.__chibattle.startCardTest("handy_jet_engine"));
});

test("本文・表示・台帳と同日更新を揃え、カードテストに双方の手札を用意する", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, own = api.state.players.player;
    const item = own.hand.find(c => c.baseId === "handy_jet_engine");
    api.showBattleCardPreview(item);
    return { cost: item.cost, text: api.cardRulesText(item), usable: api.canUseHandCardNow(item),
      own: own.hand.length, other: api.state.players.opponent.hand.length };
  })).toEqual({ cost: 3, text, usable: true, own: 4, other: 6 });
  await expect(page.locator("#battleCardPreview .battle-card-preview-rules")).toHaveText(text);
  for (const file of ["index.html", "card_rules.txt"]) {
    expect(fs.readFileSync(path.join(__dirname, "..", file), "utf8")).toContain('handy_jet_engine: "' + text + '"');
  }
  await page.goto(pathToFileURL(path.join(__dirname, "..", "カード管理台帳.html")).href);
  expect(await page.evaluate(() => CARDS.find(c => c.id === "handy_jet_engine").effect)).toBe(text);
});

for (const side of ["player", "opponent"]) {
  test(side + "は自分1枚を先に送り、相手2枚を送り、使用カード自身を抽選しない", async ({ page }) => {
    expect(await page.evaluate(side => {
      const api = window.__chibattle, otherSide = side === "player" ? "opponent" : "player";
      const own = api.state.players[side], other = api.state.players[otherSide];
      api.state.phase = "battle"; api.state.currentSide = side;
      const item = api.createCardFromBase("handy_jet_engine", side);
      own.hand = [item, api.createCardFromBase("ruler", side), api.createCardFromBase("bento", side)];
      other.hand = ["general_student", "general_teacher", "cafeteria"].map(id => api.createCardFromBase(id, otherSide));
      own.trash = []; other.trash = [];
      const calls = [], random = Math.random;
      Math.random = () => { calls.push([own.trash.length, other.trash.length]); return 0; };
      let used;
      try { used = api.castImmediateItem(side, item, false); } finally { Math.random = random; }
      return { used, ownFirst: calls.some(([ownCount, otherCount]) => ownCount === 1 && otherCount === 0),
        own: own.hand.map(c => c.baseId), other: other.hand.map(c => c.baseId),
        ownTrash: own.trash.map(c => c.baseId), otherTrash: other.trash.map(c => c.baseId), will: own.will,
        sourceCount: own.trash.filter(c => c.instanceId === item.instanceId).length };
    }, side)).toEqual({ used: true, ownFirst: true, own: ["bento"], other: ["cafeteria"],
      ownTrash: ["ruler", "handy_jet_engine"], otherTrash: ["general_student", "general_teacher"], will: 7, sourceCount: 1 });
  });
}

test("手札不足でも存在する分だけ処理し、双方の高負荷は校外へ送らない", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, own = api.state.players.player, other = api.state.players.opponent;
    const results = [];
    for (const highLoad of [false, true]) {
      const item = api.createCardFromBase("handy_jet_engine", "player");
      const ownLocked = api.createCardFromBase("ruler", "player"), otherLocked = api.createCardFromBase("bento", "opponent");
      ownLocked.handLoadLevel = 2; otherLocked.handLoadLevel = 2;
      own.will = 10; own.trash = []; other.trash = [];
      own.hand = highLoad ? [item, ownLocked] : [item];
      other.hand = [api.createCardFromBase("general_student", "opponent"), ...(highLoad ? [otherLocked] : [])];
      const used = api.castImmediateItem("player", item, false);
      results.push({ used, own: own.hand.map(c => c.baseId), other: other.hand.map(c => c.baseId),
        ownTrash: own.trash.map(c => c.baseId), otherTrash: other.trash.map(c => c.baseId) });
    }
    return results;
  })).toEqual([
    { used: true, own: [], other: [], ownTrash: ["handy_jet_engine"], otherTrash: ["general_student"] },
    { used: true, own: ["ruler"], other: ["bento"], ownTrash: ["handy_jet_engine"], otherTrash: ["general_student"] }
  ]);
});

test("左右のAIが失う自分の手札の価値と相手の高負荷を考慮する", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    return ["player", "opponent"].map(side => {
      const own = api.state.players[side], other = api.state.players[side === "player" ? "opponent" : "player"];
      const item = api.createCardFromBase("handy_jet_engine", side);
      other.hand = ["general_student", "ruler"].map(id => api.createCardFromBase(id, side === "player" ? "opponent" : "player"));
      own.hand = [item];
      const empty = api.aiDeckOutItemScore(side, item);
      own.hand.push(api.createCardFromBase("strong_student", side));
      const valuable = api.aiDeckOutItemScore(side, item);
      own.hand[1].handLoadLevel = 2;
      const protectedCard = api.aiDeckOutItemScore(side, item);
      other.hand.forEach(c => { c.handLoadLevel = 2; });
      return { empty, valuable, protectedCard, blocked: api.aiDeckOutItemScore(side, item) };
    });
  });
  for (const result of results) {
    expect(result.empty).toBeGreaterThan(result.valuable);
    expect(result.protectedCard).toBe(result.empty);
    expect(result.blocked).toBe(0);
  }
});
