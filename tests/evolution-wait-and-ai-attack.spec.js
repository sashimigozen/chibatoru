const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, side = "opponent") {
  await page.goto(gameUrl);
  await page.evaluate((side) => {
    const api = window.__chibattle, s = api.state;
    api.startCardTest("gitch");
    s.preBattleToken += 1000;
    Object.assign(s, { phase: "battle", currentSide: side, actionTurn: 8, gameOver: false,
      environment: null, noAttackUntilActionTurn: 0, testMode: false });
    Object.assign(s.training, { active: true, leftController: "ai", speed: 4, paused: false, skipAnimations: true });
    for (const owner of ["player", "opponent"]) {
      Object.assign(s.players[owner], { life: 20, will: 0, maxWill: 0, hand: [], trash: [], late: [],
        attendancesThisTurn: 0, lifeShieldUntilTurn: 0, lifeShieldUntilSide: null, lifeFloorShields: [],
        deck: Array.from({ length: 10 }, () => api.createCardFromBase("suspicious_document", owner)),
        board: { seats: Array(9).fill(null), teacher: null } });
    }
  }, side);
}

for (const side of ["player", "opponent"]) {
  test(`${side}: 技議っちへ進化したターンに偽魏義ッ血へ再進化できない`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(async (side) => {
      const api = window.__chibattle, s = api.state, own = s.players[side];
      own.will = 10;
      const source = api.makeBoardCard(api.createCardFromBase("wood_gitch", side));
      source.playedOnTurn = 6;
      own.board.seats[4] = source;
      own.hand = ["gitch", "gigi_blood"].map(id => api.createCardFromBase(id, side));
      const first = api.placeCardFromHand(side, own.hand[0].instanceId, "seat", side, 4, false);
      await api.waitForAiTimedEffects();
      const evolved = own.board.seats[4];
      const next = own.hand.find(c => c.baseId === "gigi_blood");
      const readyToAttack = api.canAttackSilently(evolved);
      const sameTurnAllowed = api.canPlaceCard(side, next, "seat", side, 4);
      const sameTurnPlayed = api.placeCardFromHand(side, next.instanceId, "seat", side, 4, false);
      const retained = own.hand.some(c => c.instanceId === next.instanceId);
      const willAfterRejected = own.will;
      const snapshot = JSON.parse(JSON.stringify(api.onlineCreateSnapshot()));
      const snapshotSource = snapshot.state.players[side].board.seats[4];
      s.actionTurn += 2;
      const laterAllowed = api.canPlaceCard(side, next, "seat", side, 4);
      return { first, readyToAttack, sameTurnAllowed, sameTurnPlayed, retained,
        willAfterRejected, laterAllowed, source: evolved.baseId, enteredTurn: snapshotSource.evolvedOnTurn };
    }, side);
    expect(result).toEqual({ first: true, readyToAttack: true, sameTurnAllowed: false,
      sameTurnPlayed: false, retained: true, willAfterRejected: 10, laterAllowed: true,
      source: "gitch", enteredTurn: 8 });
  });

  test(`${side}: 本体が守られているとき無意味な攻撃をせず、安全な盤面処理を選ぶ`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((side) => {
      const api = window.__chibattle, s = api.state, enemy = side === "player" ? "opponent" : "player";
      const a = api.makeBoardCard(api.createCardFromBase("strong_student", side));
      a.playedOnTurn = 0;
      s.players[side].board.seats[0] = a;
      s.players[enemy].life = 1;
      s.players[enemy].lifeShieldUntilTurn = 8;
      s.players[enemy].lifeShieldUntilSide = side;
      const target = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
      target.playedOnTurn = 0;
      s.players[enemy].board.seats[0] = target;
      const picked = side === "player" ? api.findTrainingAiAttackTarget(side, a) : api.findAiAttackTarget(a);
      return { picked: picked?.index ?? null };
    }, side);
    expect(result.picked).toBe(0);
  });

  test(`${side}: 攻撃力0で効果もない出席者は反撃を受けにいかない`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((side) => {
      const api = window.__chibattle, s = api.state, enemy = side === "player" ? "opponent" : "player";
      const a = api.makeBoardCard(api.createCardFromBase("ae_student", side));
      a.playedOnTurn = 0;
      s.players[side].board.seats[0] = a;
      s.players[enemy].board.seats[0] = api.makeBoardCard(api.createCardFromBase("strong_student", enemy));
      const picked = side === "player" ? api.findTrainingAiAttackTarget(side, a) : api.findAiAttackTarget(a);
      return { attack: a.attack, picked: picked?.index ?? null };
    }, side);
    expect(result).toEqual({ attack: 0, picked: null });
  });
}

test("AIは無効な本体攻撃も不利な自滅攻撃も実行しない", async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(async () => {
    const api = window.__chibattle, s = api.state;
    const a = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    a.playedOnTurn = 0;
    s.players.opponent.board.seats[0] = a;
    s.players.player.lifeShieldUntilTurn = 8;
    s.players.player.lifeShieldUntilSide = "opponent";
    await api.aiAttackWithReadyCards();
    const emptyBoardUsed = a.hasAttacked;
    const target = api.makeBoardCard(api.createCardFromBase("strong_student", "player"));
    s.players.player.board.seats[0] = target;
    await api.aiAttackWithReadyCards();
    return { emptyBoardUsed, used: a.hasAttacked, hp: a.currentHp,
      alive: s.players.opponent.board.seats[0]?.instanceId === a.instanceId, targetHp: target.currentHp };
  })).toEqual({ emptyBoardUsed: false, used: false, hp: 2, alive: true, targetHp: 7 });
});

test("左CPUも本体が守られているとき反撃で出席者を失わずターンを終える", async ({ page }) => {
  await setup(page, "player");
  expect(await page.evaluate(async () => {
    const api = window.__chibattle, s = api.state;
    const a = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    a.playedOnTurn = 0;
    s.players.player.board.seats[0] = a;
    s.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("strong_student", "opponent"));
    s.players.opponent.lifeShieldUntilTurn = 8;
    s.players.opponent.lifeShieldUntilSide = "player";
    await api.runTrainingLeftAI();
    return { used: a.hasAttacked, hp: a.currentHp, alive: s.players.player.board.seats[0]?.instanceId === a.instanceId };
  })).toEqual({ used: false, hp: 2, alive: true });
});

for (const id of ["tiny_rhythm_student", "absolute_woman", "true_enemy", "bounce_day"]) {
  test(`攻撃力0でも${id}の有効な攻撃時効果は使える`, async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(async (id) => {
      const api = window.__chibattle, s = api.state;
      const a = api.makeBoardCard(api.createCardFromBase(id, "opponent"));
      a.playedOnTurn = 0; a.attack = a.baseAttack = 0;
      s.players.opponent.board.seats[0] = a;
      s.players.player.hand = [api.createCardFromBase("ruler", "player")];
      if (["absolute_woman", "bounce_day"].includes(id)) s.players.player.board.seats[0] = api.makeBoardCard(api.createCardFromBase("strong_student", "player"));
      const deckBefore = s.players.opponent.deck.length;
      await api.aiAttackWithReadyCards();
      return { used: a.attacksUsedThisTurn > 0 || s.players.opponent.trash.some(c => c.baseId === id), load: s.players.player.hand[0].handLoadLevel || 0,
        targetDestroyed: !s.players.player.board.seats[0], drawn: deckBefore - s.players.opponent.deck.length,
        returned: s.players.player.hand.some(c => c.baseId === "strong_student"),
        sentToTrash: s.players.opponent.trash.some(c => c.baseId === id) };
    }, id);
    expect(result.used).toBe(true);
    if (id === "tiny_rhythm_student") expect(result.load).toBe(1);
    if (id === "absolute_woman") expect(result.targetDestroyed).toBe(true);
    if (id === "true_enemy") expect(result.drawn).toBe(1);
    if (id === "bounce_day") expect(result).toMatchObject({ targetDestroyed: true, returned: true, sentToTrash: true });
  });
}

for (const side of ["player", "opponent"]) {
  test(`${side}: 自分本体の次ターンの保護効果を攻撃判断に反映する`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((side) => {
      const api = window.__chibattle, s = api.state, enemy = side === "player" ? "opponent" : "player";
      const attacker = api.makeBoardCard(api.createCardFromBase("strong_student", side));
      attacker.playedOnTurn = 0;
      attacker.attack = attacker.baseAttack = 10;
      s.players[side].board.seats[0] = attacker;
      s.players[side].life = 5;
      s.players[enemy].life = 15;
      const target = api.makeBoardCard(api.createCardFromBase("strong_student", enemy));
      target.playedOnTurn = 0;
      target.attack = target.baseAttack = 8;
      target.currentHp = 5;
      s.players[enemy].board.seats[0] = target;
      const pick = () => side === "player" ? api.findTrainingAiAttackTarget(side, attacker) : api.findAiAttackTarget(attacker);
      const withoutProtection = pick()?.index ?? null;
      s.players[side].lifeShieldUntilTurn = 9;
      s.players[side].lifeShieldUntilSide = enemy;
      const withProtection = pick()?.index ?? null;
      s.players[side].lifeShieldUntilTurn = 8;
      const expiredNextTurn = pick()?.index ?? null;
      s.players[side].lifeShieldUntilTurn = 0;
      s.players[side].lifeFloorShields = [{ untilActionTurn: 9, againstSide: enemy }];
      const withFloorShield = pick()?.index ?? null;
      const second = api.makeBoardCard(api.createCardFromBase("aggro_student", enemy));
      second.playedOnTurn = 0;
      s.players[enemy].board.seats[1] = second;
      const withFloorShieldTwoAttackers = Boolean(pick());
      return { withoutProtection, withProtection, expiredNextTurn, withFloorShield, withFloorShieldTwoAttackers };
    }, side);
    expect(result).toEqual({ withoutProtection: 0, withProtection: null, expiredNextTurn: 0,
      withFloorShield: null, withFloorShieldTwoAttackers: true });
  });
}

test("攻撃力0で有効な効果がなければ、空の盤面にも本体にも攻撃しない", async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(async () => {
    const api = window.__chibattle, s = api.state;
    const a = api.makeBoardCard(api.createCardFromBase("ae_student", "opponent"));
    a.playedOnTurn = 0;
    s.players.opponent.board.seats[0] = a;
    await api.aiAttackWithReadyCards();
    return { used: a.hasAttacked, life: s.players.player.life };
  })).toEqual({ used: false, life: 20 });
});

for (const protection of ["expired", "wrongSide"]) {
  test(`気にするなの効果が${protection}なら本体へ攻撃できる`, async ({ page }) => {
    await setup(page);
    expect(await page.evaluate(async (protection) => {
      const api = window.__chibattle, s = api.state;
      const a = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
      a.playedOnTurn = 0;
      s.players.opponent.board.seats[0] = a;
      s.players.player.lifeShieldUntilTurn = protection === "expired" ? 7 : 9;
      s.players.player.lifeShieldUntilSide = protection === "wrongSide" ? "player" : "opponent";
      await api.aiAttackWithReadyCards();
      return { used: a.hasAttacked, life: s.players.player.life };
    }, protection)).toEqual({ used: true, life: 18 });
  });
}
