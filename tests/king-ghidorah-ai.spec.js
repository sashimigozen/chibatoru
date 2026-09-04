const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function chooseAndUse(page, scenario) {
  await page.goto(gameUrl);
  return page.evaluate((scenario) => {
    const api = window.__chibattle;
    api.startCardTest("king_ghidorah_bed");
    const { state } = api;
    state.currentSide = "opponent";
    state.actionTurn = 10;
    state.environment = null;
    state.noAttackUntilActionTurn = 0;
    state.gameOver = false;
    state.battleRuleId = scenario.chaos ? "chaos" : "normal";
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], { life: 20, will: 4, maxWill: 4, hand: [], deck: [], trash: [], late: [], turnsTaken: 5 });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
    state.players.player.life = scenario.enemyLife ?? 20;
    state.players.opponent.life = scenario.aiLife ?? 20;
    state.players.opponent.will = scenario.will ?? 4;
    state.players.opponent.deck = Array.from({ length: scenario.deckCount ?? 5 }, () => api.createCardFromBase("general_student", "opponent"));
    const item = api.createCardFromBase("king_ghidorah_bed", "opponent");
    state.players.opponent.hand = [item, ...(scenario.discards ?? ["key"]).map(id => api.createCardFromBase(id, "opponent"))];
    function place(entries, side) {
      entries.forEach((entry, index) => {
        const card = api.makeBoardCard(api.createCardFromBase(entry.id || "general_student", side));
        card.playedOnTurn = 0;
        card.hasAttacked = entry.used ?? false;
        if (entry.hp !== undefined) card.currentHp = card.maxHp = entry.hp;
        if (entry.attack !== undefined) card.attack = entry.attack;
        if (entry.defense !== undefined) card.defense = entry.defense;
        if (entry.attention) card.keywords = [...(card.keywords || []), "注目"];
        if (entry.padlock) card.padlockEquipment = api.createCardFromBase("padlock", side);
        state.players[side].board.seats[index] = card;
      });
    }
    place(scenario.enemies || [], "player");
    place(scenario.friends || [], "opponent");
    const before = JSON.stringify(state.players);
    const plan = api.planAiKingGhidorahBed(item);
    const planDoesNotMutate = before === JSON.stringify(state.players);
    const used = api.useAiItem(item);
    return {
      mode: plan.effectMode, target: plan.targetRef?.index ?? null, discard: plan.discard?.baseId ?? null,
      used, planDoesNotMutate, life: state.players.player.life,
      remaining: state.players.player.board.seats.filter(Boolean).length,
      enemyTrash: state.players.player.trash.map(c => c.baseId),
      will: state.players.opponent.will, gameOver: state.gameOver
    };
  }, scenario);
}

test("体力2以下が複数なら手札と破壊対象があっても全体ダメージを選ぶ", async ({ page }) => {
  const result = await chooseAndUse(page, { enemies: Array(3).fill({ hp: 2, attack: 1 }) });
  expect(result).toMatchObject({ mode: "1", used: true, remaining: 0, life: 20, planDoesNotMutate: true });
});

test("危険な高体力のプロテインドリンカーを効果2で優先して破壊する", async ({ page }) => {
  const result = await chooseAndUse(page, { enemies: [{ hp: 1, attack: 1 }, { id: "protein_drinker", hp: 7, attack: 6 }] });
  expect(result).toMatchObject({ mode: "2", target: 1, discard: "key", used: true, remaining: 1 });
  expect(result.enemyTrash).toContain("protein_drinker");
});

test("本体4ダメージで勝てるなら出席者がいても効果3で勝利する", async ({ page }) => {
  const result = await chooseAndUse(page, { enemyLife: 4, enemies: [{ hp: 10, attack: 10 }] });
  expect(result).toMatchObject({ mode: "3", used: true, life: 0, gameOver: true });
});

test("本体4ダメージと行動可能な出席者の打点を合わせたリーサルを選ぶ", async ({ page }) => {
  const result = await chooseAndUse(page, { enemyLife: 6, enemies: [{ hp: 10, attack: 8 }], friends: [{ attack: 2, hp: 4 }] });
  expect(result).toMatchObject({ mode: "3", life: 2, remaining: 1 });
});

test("安全に次の自分のターンのリーサルを狙えるなら効果3を選ぶ", async ({ page }) => {
  const result = await chooseAndUse(page, { enemyLife: 7, enemies: [{ hp: 7, attack: 0 }], friends: [{ hp: 7, attack: 5, used: true }] });
  expect(result).toMatchObject({ mode: "3", life: 3 });
});

test("次のリーサルより先に倒されるなら大型の除去を優先する", async ({ page }) => {
  const result = await chooseAndUse(page, { enemyLife: 7, aiLife: 3, enemies: [{ id: "protein_drinker", hp: 7, attack: 4 }], friends: [{ hp: 7, attack: 5, used: true }] });
  expect(result).toMatchObject({ mode: "2", remaining: 0, life: 7 });
});

test("次のドローでデッキ切れになる場合は次ターンのリーサルを当てにしない", async ({ page }) => {
  const result = await chooseAndUse(page, { deckCount: 0, enemyLife: 7, enemies: [{ id: "protein_drinker", hp: 7, attack: 1 }], friends: [{ hp: 7, attack: 5, used: true }] });
  expect(result.mode).toBe("2");
});

test("注目や本体攻撃不可をリーサルの打点に含めない", async ({ page }) => {
  const blocked = await chooseAndUse(page, { enemyLife: 6, enemies: [{ hp: 7, attack: 0, attention: true }], friends: [{ hp: 7, attack: 8 }] });
  expect(blocked.mode).toBe("2");
  const bird = await chooseAndUse(page, { enemyLife: 6, enemies: [{ id: "protein_drinker", hp: 7, attack: 2 }], friends: [{ id: "happy_blue_bird", used: true }] });
  expect(bird.mode).toBe("2");
});

test("防御で倒せない出席者の数だけで効果1を選ばず、南京錠も破壊対象にしない", async ({ page }) => {
  const result = await chooseAndUse(page, { enemies: [{ hp: 2, attack: 1, defense: 3 }, { hp: 2, attack: 1, defense: 3 }, { id: "protein_drinker", hp: 7, attack: 5 }, { hp: 20, attack: 20, padlock: true }] });
  expect(result).toMatchObject({ mode: "2", target: 2 });
});

test("捨てる手札がなければ効果2を選ばない", async ({ page }) => {
  const result = await chooseAndUse(page, { discards: [], enemies: [{ id: "protein_drinker", hp: 7, attack: 5 }] });
  expect(result).toMatchObject({ mode: "1", used: true });
});

test("戦意8以上は全効果を使い、全体ダメージで残る対象を破壊する", async ({ page }) => {
  const result = await chooseAndUse(page, { will: 8, enemies: [{ hp: 1, attack: 20 }, { id: "protein_drinker", hp: 7, attack: 1 }] });
  expect(result).toMatchObject({ mode: "all", target: 1, used: true, remaining: 0, life: 16, will: 0 });
});

test("カオスの戦意0でも盤面評価を使う", async ({ page }) => {
  const result = await chooseAndUse(page, { chaos: true, will: 0, enemies: Array(3).fill({ hp: 2, attack: 1 }) });
  expect(result).toMatchObject({ mode: "1", used: true, remaining: 0, will: 0 });
});
