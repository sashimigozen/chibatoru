const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function setup(page, side) {
  await page.goto(pathToFileURL(path.join(__dirname, "..", "index.html")).href);
  await page.evaluate(side => {
    startCardTest("general_student");
    scheduleOpponentAI = () => {};
    state.preBattleToken += 1000;
    Object.assign(state, { phase: "battle", currentSide: side, actionTurn: 9, testMode: false,
      gameOver: false, gameWinner: null, environment: null, noAttackUntilActionTurn: 0 });
    Object.assign(state.training, { active: true, leftController: "ai", skipAnimations: true, speed: 4 });
    for (const owner of ["player", "opponent"]) Object.assign(state.players[owner], {
      life: 20, will: 0, maxWill: 10, turnsTaken: 5, hand: [], trash: [], late: [], originalDeckCounts: {},
      deck: Array.from({length: 10}, () => createCardFromBase("general_student", owner)),
      board: { teacher: null, seats: Array(9).fill(null) }
    });
    window.put = (owner, index, attack, hp) => {
      const card = createCardFromBase("general_student", owner);
      Object.assign(card, { attack, hp });
      const board = makeBoardCard(card); board.playedOnTurn = 0;
      state.players[owner].board.seats[index] = board; return board;
    };
  }, side);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}

for (const side of ["player", "opponent"]) {
  test(`${side}: 一人では不利でも二人で致命的な相手を倒して生き残る`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(async side => {
      const enemy = oppositeSide(side);
      state.players[side].life = 3;
      const first = put(side, 0, 2, 2), second = put(side, 1, 2, 2);
      const target = put(enemy, 0, 4, 4); target.keywords = ["注目"];
      const before = JSON.stringify(state.players);
      const allowed = aiShouldAttackCard(side, first, target);
      const unchanged = before === JSON.stringify(state.players);
      if (side === "opponent") await aiAttackWithReadyCards();
      else await runTrainingLeftAI();
      return { allowed, unchanged, removed: !state.players[enemy].board.seats[0],
        life: state.players[side].life, over: state.gameOver };
    }, side);
    expect(result).toEqual({ allowed: true, unchanged: true, removed: true, life: 3, over: false });
  });

  test(`${side}: 倒せない相手への無駄な特攻と、行動不能の味方を当てにしない`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(side => {
      const first = put(side, 0, 2, 2), ally = put(side, 1, 2, 2);
      const target = put(oppositeSide(side), 0, 4, 5);
      const impossible = aiShouldAttackCard(side, first, target);
      target.currentHp = 4;
      ally.hasAttacked = true; ally.attacksUsedThisTurn = 1;
      const spent = aiShouldAttackCard(side, first, target);
      ally.hasAttacked = false; ally.attacksUsedThisTurn = 0; ally.keywords = ["眠気"];
      const uncertain = aiShouldAttackCard(side, first, target);
      return { impossible, spent, uncertain };
    }, side);
    expect(result).toEqual({ impossible: false, spent: false, uncertain: false });
  });

  test(`${side}: 使えなかった持ち物一枚で他の有効な持ち物を諦めない`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(async side => {
      const own = state.players[side]; own.will = 10;
      const blocked = createCardFromBase("double_diamond", side); blocked.cost = 0;
      const valid = createCardFromBase("ruler", side); own.hand = [blocked, valid];
      // Reproduce a candidate becoming unusable between scoring and execution.
      const original = side === "opponent" ? useAiItem : useTrainingYocchanItem;
      const attempts = [];
      if (side === "opponent") useAiItem = item => {
        attempts.push(item.baseId); return item === blocked ? false : original(item);
      };
      else useTrainingYocchanItem = (owner, item) => {
        attempts.push(item.baseId); return item === blocked ? false : original(owner, item);
      };
      if (side === "opponent") await tryUseAiItems({timing: "afterBoard"});
      else await tryUseTrainingYocchanItems(side);
      return { attempts, hand: own.hand.map(c => c.baseId), life: state.players[oppositeSide(side)].life };
    }, side);
    expect(result.attempts[0]).toBe("double_diamond");
    expect(result.attempts).toContain("ruler");
    expect(result.attempts.length).toBeLessThanOrEqual(4);
    expect(result.hand).toEqual(["double_diamond"]);
    expect(result.life).toBe(19);
  });

  test(`${side}: 攻撃後に空いた席へ手札を出し、戦意を残したまま手番を終えない`, async ({page}) => {
    await setup(page, side);
    const result = await page.evaluate(async side => {
      const own = state.players[side]; own.will = 2; own.life = 3;
      for (let index = 0; index < 9; index++) {
        const card = put(side, index, 2, 2);
        if (index > 0) { card.hasAttacked = true; card.attacksUsedThisTurn = 1; }
      }
      own.board.teacher = makeBoardCard(createCardFromBase("general_teacher", side));
      own.board.teacher.hasAttacked = true; own.board.teacher.attacksUsedThisTurn = 1;
      const target = put(oppositeSide(side), 0, 2, 2); target.keywords = ["注目"];
      put(oppositeSide(side), 1, 4, 10);
      const reserve = createCardFromBase("general_student", side); own.hand = [reserve];
      if (side === "opponent") await runOpponentAI(); else await runTrainingLeftAI();
      return { deployed: listBoardRefs(side).some(ref => getBoardCardFromRef(ref)?.instanceId === reserve.instanceId),
        will: own.will, targetGone: !state.players[oppositeSide(side)].board.seats[0] };
    }, side);
    expect(result).toEqual({deployed: true, will: 0, targetGone: true});
  });
}

test("勝利予測が外れても、残った手札で盤面を作ってから手番を終える", async ({page}) => {
  await setup(page, "opponent");
  const result = await page.evaluate(async () => {
    state.players.opponent.will = 2;
    state.players.opponent.life = 3;
    const reserve = createCardFromBase("general_student", "opponent");
    state.players.opponent.hand = [reserve];
    put("player", 0, 4, 10);
    const original = getAiGuaranteedBoardLethalPlan;
    let first = true;
    // The forecast was made before an attack effect changed the available finish.
    getAiGuaranteedBoardLethalPlan = () => {
      if (first) { first = false; return {type: "direct"}; }
      return original();
    };
    await runOpponentAI();
    return { deployed: listBoardRefs("opponent").some(ref => getBoardCardFromRef(ref)?.instanceId === reserve.instanceId),
      will: state.players.opponent.will, over: state.gameOver };
  });
  expect(result).toEqual({deployed: true, will: 0, over: false});
});
