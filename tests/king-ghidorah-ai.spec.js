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
    const owner = scenario.side || "opponent";
    const foe = owner === "opponent" ? "player" : "opponent";
    state.currentSide = owner;
    state.actionTurn = 10;
    state.environment = null;
    state.noAttackUntilActionTurn = 0;
    state.gameOver = false;
    state.battleRuleId = scenario.chaos ? "chaos" : "normal";
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], { life: 20, will: 4, maxWill: 4, hand: [], deck: [], trash: [], late: [], turnsTaken: scenario.turn ?? 5 });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
    state.players[foe].life = scenario.enemyLife ?? 20;
    state.players[owner].life = scenario.aiLife ?? 20;
    state.players[owner].will = scenario.will ?? 4;
    state.players[owner].deck = Array.from({ length: scenario.deckCount ?? 5 }, () => api.createCardFromBase("general_student", owner));
    const item = api.createCardFromBase("king_ghidorah_bed", owner);
    state.players[owner].hand = [item, ...(scenario.discards ?? ["key"]).map(id => api.createCardFromBase(id, owner))];
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
    place(scenario.enemies || [], foe);
    place(scenario.friends || [], owner);
    const before = JSON.stringify(state.players);
    const plan = api.planAiKingGhidorahBed(item);
    const planDoesNotMutate = before === JSON.stringify(state.players);
    const used = owner === "opponent" ? api.useAiItem(item) : api.useTrainingYocchanItem(owner, item);
    return {
      mode: plan.effectMode, target: plan.targetRef?.index ?? null, discard: plan.discard?.baseId ?? null,
      used, score: plan.score, planDoesNotMutate, life: state.players[foe].life,
      remaining: state.players[foe].board.seats.filter(Boolean).length,
      enemyTrash: state.players[foe].trash.map(c => c.baseId),
      will: state.players[owner].will, gameOver: state.gameOver
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
  // The ready attacker can safely remove this lone blocker without spending the item.
  expect(blocked.used).toBe(false);
  const bird = await chooseAndUse(page, { enemyLife: 6, enemies: [{ id: "protein_drinker", hp: 7, attack: 2 }], friends: [{ id: "happy_blue_bird", used: true }] });
  expect(bird.mode).toBe("2");
});

test("防御で倒せない出席者の数だけで効果1を選ばず、南京錠も破壊対象にしない", async ({ page }) => {
  const result = await chooseAndUse(page, { enemies: [{ hp: 2, attack: 1, defense: 3 }, { hp: 2, attack: 1, defense: 3 }, { id: "protein_drinker", hp: 7, attack: 5 }, { hp: 20, attack: 20, padlock: true }] });
  expect(result).toMatchObject({ mode: "2", target: 2 });
});

test("捨てる手札がなく、2ダメージで危険な1人を処理できないなら温存する", async ({ page }) => {
  const result = await chooseAndUse(page, { discards: [], enemies: [{ id: "protein_drinker", hp: 7, attack: 5 }] });
  expect(result).toMatchObject({ mode: "1", used: false });
});

test("戦意8以上は全効果を使い、全体ダメージで残る対象を破壊する", async ({ page }) => {
  const result = await chooseAndUse(page, { will: 8, enemies: [{ hp: 1, attack: 20 }, { id: "protein_drinker", hp: 7, attack: 1 }] });
  expect(result).toMatchObject({ mode: "all", target: 1, used: true, remaining: 0, life: 16, will: 0 });
});

test("カオスの戦意0でも盤面評価を使う", async ({ page }) => {
  const result = await chooseAndUse(page, { chaos: true, will: 0, enemies: Array(3).fill({ hp: 2, attack: 1 }) });
  expect(result).toMatchObject({ mode: "1", used: true, remaining: 0, will: 0 });
});

for (const side of ["player", "opponent"]) {
  for (const will of [4, 8]) {
    test(`${side}: 戦意${will}でも普通の弱い1人には温存する`, async ({ page }) => {
      const result = await chooseAndUse(page, { side, will, enemies: [{ hp: 2, attack: 1 }] });
      expect(result).toMatchObject({ used: false, score: 0, life: 20, will, planDoesNotMutate: true });
    });
  }
  test(`${side}: 出席者がいなければ本体への小削りに浪費しない`, async ({ page }) => {
    expect(await chooseAndUse(page, { side })).toMatchObject({ used: false, score: 0 });
  });
  test(`${side}: 強い1人を他に処理できなければ破壊する`, async ({ page }) => {
    expect(await chooseAndUse(page, { side, enemies: [{ hp: 5, attack: 6 }] }))
      .toMatchObject({ mode: "2", used: true, remaining: 0, planDoesNotMutate: true });
  });
  test(`${side}: 安い処理札があればキングギドラベッドを残す`, async ({ page }) => {
    expect(await chooseAndUse(page, { side, discards: ["double_diamond"], enemies: [{ hp: 4, attack: 6 }] }))
      .toMatchObject({ used: false, remaining: 1 });
  });
  test(`${side}: 1人でも進化元のミジンコは全体ダメージで処理する`, async ({ page }) => {
    expect(await chooseAndUse(page, { side, enemies: [{ id: "midge", hp: 2, attack: 0 }] }))
      .toMatchObject({ mode: "1", used: true, remaining: 0 });
  });
  test(`${side}: 高体力の進化元は破壊を優先する`, async ({ page }) => {
    expect(await chooseAndUse(page, { side, enemies: [{ id: "bird_a", hp: 4, attack: 0 }] }))
      .toMatchObject({ mode: "2", used: true, remaining: 0 });
  });
  test(`${side}: 終盤の攻撃力3・体力3の1人も放置しない`, async ({ page }) => {
    expect(await chooseAndUse(page, { side, turn: 8, enemies: [{ hp: 3, attack: 3 }] }))
      .toMatchObject({ mode: "2", used: true, remaining: 0 });
  });
  test(`${side}: 次ターンの敗北を防ぐなら小さな1人でも処理する`, async ({ page }) => {
    expect(await chooseAndUse(page, { side, aiLife: 1, enemies: [{ hp: 2, attack: 1 }] }))
      .toMatchObject({ mode: "1", used: true, remaining: 0 });
  });
  test(`${side}: 本体ダメージで今勝てるなら温存しない`, async ({ page }) => {
    expect(await chooseAndUse(page, { side, enemyLife: 4 }))
      .toMatchObject({ mode: "3", used: true, life: 0, gameOver: true });
  });
  test(`${side}: 並んだ3人は全体ダメージで処理する`, async ({ page }) => {
    expect(await chooseAndUse(page, { side, enemies: Array(3).fill({ hp: 2, attack: 1 }) }))
      .toMatchObject({ mode: "1", used: true, remaining: 0 });
  });
  test(`${side}: 全効果でTRPGを失うなら敵の強化をリーサルに数えない`, async ({ page }) => {
    expect(await chooseAndUse(page, { side, will: 8, enemyLife: 8,
      enemies: Array(2).fill({ id: "trpg_member", hp: 1, attack: 0 }),
      friends: [{ id: "enemy_student", hp: 3, attack: 6 }] }))
      .toMatchObject({ used: false, life: 8, remaining: 2 });
  });
}
