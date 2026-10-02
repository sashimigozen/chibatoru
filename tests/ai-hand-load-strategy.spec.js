const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, side) {
  await page.goto(gameUrl);
  await page.evaluate((owner) => {
    const { state } = window.__chibattle;
    state.preBattleToken += 1000;
    Object.assign(state, {
      screen: "battle", phase: "battle", currentSide: owner,
      actionTurn: 9, firstSide: "player", environment: null, gameOver: false
    });
    for (const current of ["player", "opponent"]) {
      Object.assign(state.players[current], {
        life: 20, will: 10, maxWill: 10, hand: [], deck: [], trash: [], late: [],
        turnsTaken: 5, originalDeckCounts: {},
        board: { teacher: null, seats: Array(9).fill(null) }
      });
    }
  }, side);
}

for (const side of ["player", "opponent"]) {
  test(`${side} CPUは小刻みリズム学生の攻撃前に白い学生を保留し負荷付与後に出席させる`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(async (owner) => {
      const api = window.__chibattle;
      const target = owner === "player" ? "opponent" : "player";
      Object.assign(api.state.training, { active: true, leftController: "ai", skipAnimations: true });
      const rhythm = api.makeBoardCard(api.createCardFromBase("tiny_rhythm_student", owner));
      rhythm.playedOnTurn = 0;
      api.state.players[owner].board.seats[4] = rhythm;
      api.state.players[owner].hand = [api.createCardFromBase("white_student", owner)];
      api.state.players[owner].will = 1;
      api.state.players[target].hand = [api.createCardFromBase("strong_student", target)];
      const held = !(owner === "player" ? api.findTrainingAiPlayMove(owner) : api.findAiPlayMove());
      api.markCardAttackUsed(rhythm);
      const played = await window.playAiWhiteAfterLoadAttack(owner, rhythm);
      return {
        held, played,
        whiteOnBoard: api.state.players[owner].board.seats.some((card) => card?.baseId === "white_student"),
        whiteInHand: api.state.players[owner].hand.some((card) => card.baseId === "white_student"),
        load: api.state.players[target].hand[0].handLoadLevel
      };
    }, side);
    expect(result).toEqual({ held: true, played: true, whiteOnBoard: true, whiteInHand: false, load: 2 });
  });

  test(`${side} CPUの実行フローでも攻撃時負荷から白い学生の高負荷化を同ターンで完了する`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(async (owner) => {
      const api = window.__chibattle;
      const target = owner === "player" ? "opponent" : "player";
      Object.assign(api.state.training, { active: true, leftController: "ai", skipAnimations: true });
      const rhythm = api.makeBoardCard(api.createCardFromBase("tiny_rhythm_student", owner));
      rhythm.playedOnTurn = 0;
      api.state.players[owner].board.seats[4] = rhythm;
      api.state.players[owner].hand = [api.createCardFromBase("white_student", owner)];
      api.state.players[owner].will = 1;
      const enemyCard = api.createCardFromBase("strong_student", target);
      api.state.players[target].hand = [enemyCard];
      for (const current of [owner, target]) {
        api.state.players[current].deck = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", current));
      }
      if (owner === "player") await api.runTrainingLeftAI();
      else await api.runOpponentAI();
      return {
        attacked: rhythm.hasAttacked || rhythm.attacksUsedThisTurn > 0,
        whiteOnBoard: api.state.players[owner].board.seats.some((card) => card?.baseId === "white_student"),
        load: enemyCard.handLoadLevel,
        enemyLife: api.state.players[target].life
      };
    }, side);
    expect(result).toEqual({ attacked: true, whiteOnBoard: true, load: 2, enemyLife: 19 });
  });

  test(`${side} CPUは過学習学生で負荷を付けてから白い学生で高負荷にする`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((owner) => {
      const api = window.__chibattle;
      const target = owner === "player" ? "opponent" : "player";
      const white = api.createCardFromBase("white_student", owner);
      const overfit = api.createCardFromBase("overfitting_student", owner);
      api.state.players[owner].will = 4;
      api.state.players[owner].hand = [white, overfit];
      api.state.players[target].hand = [api.createCardFromBase("general_student", target)];
      const nextMove = () => owner === "player" ? api.findTrainingAiPlayMove(owner) : api.findAiPlayMove();
      const first = nextMove();
      api.placeCardFromHand(owner, first.card.instanceId, first.zone, owner, first.index, false);
      const second = nextMove();
      api.placeCardFromHand(owner, second.card.instanceId, second.zone, owner, second.index, false);
      return { first: first.card.baseId, second: second.card.baseId, load: api.state.players[target].hand[0].handLoadLevel };
    }, side);
    expect(result).toEqual({ first: "overfitting_student", second: "white_student", load: 2 });
  });

  test(`${side} CPUは負荷済みの手札があるなら白い学生を先に出席させる`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((owner) => {
      const api = window.__chibattle;
      const target = owner === "player" ? "opponent" : "player";
      const loaded = api.createCardFromBase("general_student", target);
      loaded.handLoadLevel = 1;
      api.state.players[target].hand = [loaded];
      api.state.players[owner].hand = [
        api.createCardFromBase("overfitting_student", owner),
        api.createCardFromBase("white_student", owner),
        api.createCardFromBase("suffix_sugi", owner)
      ];
      const suffix = api.state.players[owner].hand[2];
      const itemScore = owner === "player" ? api.scoreTrainingYocchanItem(owner, suffix) : api.scoreAiItem(suffix);
      const move = owner === "player" ? api.findTrainingAiPlayMove(owner) : api.findAiPlayMove();
      return { first: move.card.baseId, suffixWouldBeUsed: itemScore > 0 };
    }, side);
    expect(result).toEqual({ first: "white_student", suffixWouldBeUsed: false });
  });

  test(`${side} CPUは語尾スギでも白い学生の対象を準備する`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((owner) => {
      const api = window.__chibattle;
      const target = owner === "player" ? "opponent" : "player";
      const white = api.createCardFromBase("white_student", owner);
      const suffix = api.createCardFromBase("suffix_sugi", owner);
      api.state.players[owner].will = 4;
      api.state.players[owner].hand = [white, suffix];
      api.state.players[target].hand = [api.createCardFromBase("strong_student", target)];
      const score = owner === "player" ? api.scoreTrainingYocchanItem(owner, suffix) : api.scoreAiItem(suffix, { timing: "beforeBoard" });
      const used = owner === "player" ? api.useTrainingYocchanItem(owner, suffix) : api.useAiItem(suffix);
      const move = owner === "player" ? api.findTrainingAiPlayMove(owner) : api.findAiPlayMove();
      api.placeCardFromHand(owner, move.card.instanceId, move.zone, owner, move.index, false);
      return { scored: score > 0, used, card: move.card.baseId, load: api.state.players[target].hand[0].handLoadLevel };
    }, side);
    expect(result).toEqual({ scored: true, used: true, card: "white_student", load: 2 });
  });

  test(`${side} CPUは相手の盤面が多いと負荷より盤面処理を優先する`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((owner) => {
      const api = window.__chibattle;
      const target = owner === "player" ? "opponent" : "player";
      const suffix = api.createCardFromBase("suffix_sugi", owner);
      const overfit = api.createCardFromBase("overfitting_student", owner);
      api.state.players[owner].will = 4;
      api.state.players[owner].hand = [suffix, overfit, api.createCardFromBase("yabe", owner)];
      api.state.players[target].hand = [api.createCardFromBase("strong_student", target)];
      for (let index = 0; index < 4; index += 1) {
        api.state.players[target].board.seats[index] = api.makeBoardCard(api.createCardFromBase("general_student", target));
      }
      const score = owner === "player" ? api.scoreTrainingYocchanItem(owner, suffix) : api.scoreAiItem(suffix);
      const move = owner === "player" ? api.findTrainingAiPlayMove(owner) : api.findAiPlayMove();
      return { suffixWouldBeUsed: score > 0, spendsWillOnOverfit: move?.card.baseId === "overfitting_student" };
    }, side);
    expect(result).toEqual({ suffixWouldBeUsed: false, spendsWillOnOverfit: false });
  });

  test(`${side} CPUは高負荷だけの手札へ語尾スギを使わず自滅する負荷も避ける`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((owner) => {
      const api = window.__chibattle;
      const target = owner === "player" ? "opponent" : "player";
      const suffix = api.createCardFromBase("suffix_sugi", owner);
      const enemy = api.createCardFromBase("strong_student", target);
      enemy.handLoadLevel = 2;
      api.state.players[target].hand = [enemy];
      api.state.players[owner].hand = [suffix, api.createCardFromBase("strong_student", owner)];
      const score = () => owner === "player" ? api.scoreTrainingYocchanItem(owner, suffix) : api.scoreAiItem(suffix);
      const highLoadWaste = score() > 0;
      enemy.handLoadLevel = 0;
      api.state.players[owner].will = 3;
      api.state.players[owner].life = 1;
      return { highLoadWaste, lethalOwnLoad: score() > 0 };
    }, side);
    expect(result).toEqual({ highLoadWaste: false, lethalOwnLoad: false });
  });

  test(`${side} CPUはスタディアブローダーの全体ダメージを教卓から使う`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((owner) => {
      const api = window.__chibattle;
      const target = owner === "player" ? "opponent" : "player";
      api.state.players[owner].hand = [
        api.createCardFromBase("white_student", owner),
        api.createCardFromBase("strong_student", owner),
        api.createCardFromBase("signal_professor_m", owner)
      ];
      api.state.players[target].hand = [api.createCardFromBase("strong_student", target)];
      for (let index = 0; index < 4; index += 1) {
        api.state.players[target].board.seats[index] = api.makeBoardCard(api.createCardFromBase("general_student", target));
      }
      const move = owner === "player" ? api.findTrainingAiPlayMove(owner) : api.findAiPlayMove();
      return { card: move.card.baseId, zone: move.zone };
    }, side);
    expect(result).toEqual({ card: "signal_professor_m", zone: "teacher" });
  });
}
