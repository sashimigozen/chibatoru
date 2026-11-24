const {test, expect} = require("@playwright/test");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
async function setup(page, side = "opponent") {
  await page.goto(pathToFileURL(path.join(__dirname, "..", "index.html")).href);
  await page.evaluate(side => {
    startCardTest("general_student"); scheduleOpponentAI = () => {};
    state.preBattleToken += 1000;
    Object.assign(state, {phase: "battle", currentSide: side, actionTurn: 9, gameOver: false,
      gameWinner: null, testMode: false, environment: null, noAttackUntilActionTurn: 0});
    Object.assign(state.training, {active: true, leftController: "ai", skipAnimations: true, speed: 4});
    for (const owner of ["player", "opponent"]) Object.assign(state.players[owner], {
      life: 20, will: 0, maxWill: 5, turnsTaken: 5, hand: [], trash: [], late: [], originalDeckCounts: {},
      deck: Array.from({length: 20}, () => createCardFromBase("general_student", owner)),
      board: {teacher: null, seats: Array(9).fill(null)}
    });
    window.put = (owner, index, attack, hp, id = "general_student") => {
      const card = makeBoardCard({...createCardFromBase(id, owner), attack, hp});
      card.playedOnTurn = 0; state.players[owner].board.seats[index] = card; return card;
    };
  }, side);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}
for (const side of ["player", "opponent"]) {
  test(`${side}: 二回攻撃と注目突破後の打点を見落とさない`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(side => {
      const own = state.players[side], enemy = oppositeSide(side); own.life = 8;
      const multi = put(enemy, 0, 5, 5); multi.attackLimit = 2;
      const double = getAiLethalForecast(side);
      state.players[enemy].board.seats = Array(9).fill(null);
      put(enemy, 0, 1, 1); put(enemy, 1, 8, 8);
      const guard = put(side, 0, 0, 1, "ae_female_student");
      const fragile = getAiLethalForecast(side);
      guard.currentHp = guard.maxHp = guard.baseMaxHp = 30;
      const strong = getAiLethalForecast(side);
      return {double: double.opponentBoardDamage, doubleLethal: double.opponentCounterLethal,
        fragile: fragile.opponentBoardDamage, fragileLethal: fragile.opponentCounterLethal,
        race: fragile.safeRace, strong: strong.opponentBoardDamage};
    }, side);
    expect(result).toEqual({double: 10, doubleLethal: true, fragile: 8, fragileLethal: true, race: false, strong: 0});
  });
  test(`${side}: 本体への攻撃や安全な小物処理より、次に倒される攻撃役を処理する`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(async side => {
      const enemy = oppositeSide(side); state.players[side].life = 3;
      put(side, 0, 8, 3);
      const dangerous = put(enemy, 0, 3, 3);
      put(enemy, 1, 1, 1);
      const before = JSON.stringify(state.players);
      const choice = side === "opponent" ? findAiAttackTarget(state.players[side].board.seats[0])
        : findTrainingAiAttackTarget(side, state.players[side].board.seats[0]);
      const unchanged = before === JSON.stringify(state.players);
      if (side === "opponent") await aiAttackWithReadyCards(); else await runTrainingLeftAI();
      return {choice: choice?.index, removed: !state.players[enemy].board.seats[0], unchanged};
    }, side);
    expect(result).toEqual({choice: 0, removed: true, unchanged: true});
  });
  test(`${side}: 大きい体力の囮より、リーサルを防ぐ対象に除去を使う`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(async side => {
      const enemy = oppositeSide(side), own = state.players[side]; own.life = 4; own.will = 5;
      put(enemy, 0, 4, 1); put(enemy, 1, 0, 20);
      const item = createCardFromBase("seriously_hit", side); own.hand = [item];
      const target = planAiNonCombatItem(side, item).target.ref.index;
      if (side === "opponent") await tryUseAiItems({timing: "beforeBoard"}); else await tryUseTrainingYocchanItems(side);
      return {target, removed: !state.players[enemy].board.seats[0], decoy: !!state.players[enemy].board.seats[1]};
    }, side);
    expect(result).toEqual({target: 0, removed: true, decoy: true});
  });
  test(`${side}: ドローで戦意を使い切る前に、生存に必要な回復を使う`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(async side => {
      const enemy = oppositeSide(side), own = state.players[side]; own.life = 4; own.will = 1;
      put(enemy, 0, 5, 10);
      own.hand = ["hondara", "fluid_pasta"].map(id => createCardFromBase(id, side));
      if (side === "opponent") await tryUseAiItems({timing: "beforeBoard"}); else await tryUseTrainingYocchanItems(side);
      return {life: own.life, will: own.will, pasta: own.trash.some(c => c.baseId === "fluid_pasta")};
    }, side);
    expect(result).toEqual({life: 7, will: 0, pasta: true});
  });
  test(`${side}: 次の手番まで続く防御と期限切れ防御、攻撃封鎖を区別する`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(side => {
      const enemy = oppositeSide(side), own = state.players[side]; own.life = 3;
      put(enemy, 0, 8, 8);
      own.lifeShieldUntilSide = enemy; own.lifeShieldUntilTurn = state.actionTurn;
      const expired = aiIncomingBoardDamage(side);
      own.lifeShieldUntilTurn++;
      const protectedDamage = aiIncomingBoardDamage(side);
      own.lifeShieldUntilTurn = 0;
      state.noAttackUntilActionTurn = state.actionTurn + 1;
      const locked = aiIncomingBoardDamage(side);
      return {expired, protectedDamage, locked};
    }, side);
    expect(result).toEqual({expired: 8, protectedDamage: 0, locked: 0});
  });
}

test("見えたカードから関連する打点を警戒し、非公開手札・デッキの実物を読まない", async ({page}) => {
  await setup(page);
  const result = await page.evaluate(() => {
    window.ChibattleAiBattleDecks = [
      {name: "attack", counts: {yuta: 3, double_diamond: 3, general_student: 34}},
      {name: "control", counts: {general_teacher: 3, general_student: 37}}
    ];
    const enemy = state.players.player;
    enemy.hand = Array.from({length: 6}, () => createCardFromBase("general_student", "player"));
    const unknown = aiPublicBurstRisk("opponent");
    put("player", 1, 1, 1, "aggro_student");
    const unsupported = aiPublicBurstRisk("opponent");
    const yuta = put("player", 0, 3, 3, "yuta");
    const before = JSON.stringify(state.players);
    const risk = aiPublicBurstRisk("opponent");
    const immutable = before === JSON.stringify(state.players);
    enemy.hand = enemy.hand.map(() => createCardFromBase("double_diamond", "player"));
    enemy.deck = enemy.deck.map(() => createCardFromBase("ultimate_yuta", "player"));
    enemy.originalDeckCounts = {ultimate_yuta: 40};
    const hidden = aiPublicBurstRisk("opponent");
    const forecast = getAiLethalForecast("opponent").opponentNextTurnDamage;
    enemy.hand = enemy.hand.map(() => createCardFromBase("general_student", "player"));
    enemy.deck.reverse();
    const swapped = getAiLethalForecast("opponent").opponentNextTurnDamage;
    return {unknown, unsupported, risk, hidden, immutable, forecast, swapped};
  });
  expect(result.unknown).toBe(0);
  expect(result.unsupported).toBe(0);
  expect(result.risk).toBeGreaterThan(0);
  expect(result.hidden).toBe(result.risk);
  expect(result.forecast).toBe(result.swapped);
  expect(result.immutable).toBe(true);
});

for (const side of ["player", "opponent"]) {
  test(`${side}: 注目の出席だけで生存できるなら手札から優先して出す`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(async side => {
      const own = state.players[side]; own.life = 4; own.will = 2;
      put(oppositeSide(side), 0, 5, 10);
      own.hand = ["general_student", "ae_student"].map(id => createCardFromBase(id, side));
      const move = side === "opponent" ? findAiPlayMove() : findTrainingAiPlayMove(side);
      if (side === "opponent") await playAiBoardMoves(new Map());
      else { placeCardFromHand(side, move.card.instanceId, move.zone, move.owner, move.index, false); }
      return {choice: move.card.baseId, danger: getAiLethalForecast(side).opponentCounterLethal};
    }, side);
    expect(result).toEqual({choice: "ae_student", danger: false});
  });
  test(`${side}: 確実に勝てる持ち物があるなら回復より先に勝利する`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(async side => {
      const own = state.players[side], enemy = oppositeSide(side); own.life = 4; own.will = 3;
      state.players[enemy].life = 4; put(enemy, 0, 5, 10);
      own.hand = ["fluid_pasta", "double_diamond"].map(id => createCardFromBase(id, side));
      if (side === "opponent") await tryUseAiItems({timing: "beforeBoard"}); else await tryUseTrainingYocchanItems(side);
      return {over: state.gameOver, winner: state.gameWinner, life: own.life};
    }, side);
    expect(result).toEqual({over: true, winner: side, life: 4});
  });
}

test("大きな処理役を先の注目に浪費したと仮定して安全判定しない", async ({page}) => {
  await setup(page);
  const damage = await page.evaluate(() => {
    put("opponent", 0, 0, 1, "ae_female_student"); put("opponent", 1, 0, 20, "ae_student");
    put("player", 0, 20, 20, "happy_blue_bird"); put("player", 1, 5, 5); put("player", 2, 5, 5);
    return aiIncomingBoardDamage("opponent");
  });
  expect(damage).toBeGreaterThanOrEqual(5);
});

test("攻撃できなくても、公開された終了時の3ダメージを警戒する", async ({page}) => {
  await setup(page);
  const result = await page.evaluate(() => {
    state.players.opponent.life = 3; state.players.opponent.will = 5;
    put("player", 0, 0, 1, "where_bone");
    const removal = createCardFromBase("seriously_hit", "opponent");
    const forecast = getAiLethalForecast("opponent");
    return {damage: forecast.opponentBoardDamage, lethal: forecast.opponentCounterLethal,
      priority: aiCardSurvivalPriority("opponent", removal)};
  });
  expect(result.damage).toBe(3); expect(result.lethal).toBe(true); expect(result.priority).toBeGreaterThanOrEqual(2000);
});

for (const side of ["player", "opponent"]) {
  test(`${side}: 1の弱体化で生き残れるなら、強い囮より致命的な相手を弱体化する`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(async side => {
      const own = state.players[side], enemy = oppositeSide(side); own.life = 3; own.will = 1;
      put(enemy, 0, 3, 3); const decoy = put(enemy, 1, 8, 10); decoy.attackLockedPermanently = true;
      const item = createCardFromBase("illness", side); own.hand = [item];
      const target = planAiNonCombatItem(side, item).target.ref.index;
      if (side === "opponent") await tryUseAiItems({timing: "beforeBoard"}); else await tryUseTrainingYocchanItems(side);
      return {target, damage: aiIncomingBoardDamage(side)};
    }, side);
    expect(result).toEqual({target: 0, damage: 2});
  });
}

test("公開された採用傾向の追加打点をケアして回復を選ぶ", async ({page}) => {
  await setup(page);
  const result = await page.evaluate(() => {
    window.ChibattleAiBattleDecks = [
      {name: "attack", counts: {yuta: 3, double_diamond: 3, general_student: 34}},
      {name: "control", counts: {general_teacher: 3, general_student: 37}}
    ];
    put("player", 0, 3, 3, "yuta");
    state.players.player.hand = Array.from({length: 6}, () => createCardFromBase("general_student", "player"));
    state.players.opponent.life = 5; state.players.opponent.will = 1;
    const pasta = createCardFromBase("fluid_pasta", "opponent");
    const forecast = getAiLethalForecast("opponent");
    return {visible: forecast.opponentBoardDamage, predicted: forecast.opponentBurstRisk,
      danger: forecast.opponentCounterLethal, priority: aiCardSurvivalPriority("opponent", pasta)};
  });
  expect(result.visible).toBe(3); expect(result.predicted).toBeGreaterThanOrEqual(2);
  expect(result.danger).toBe(true); expect(result.priority).toBeGreaterThanOrEqual(2000);
});
