const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, currentSide) {
  await page.goto(gameUrl);
  await page.evaluate((side) => {
    const { state } = window.__chibattle;
    state.preBattleToken += 1000;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = side;
    state.actionTurn = 9;
    state.firstSide = "player";
    state.environment = null;
    state.gameOver = false;
    state.aiLethalForcedTargetId = null;
    for (const owner of ["player", "opponent"]) {
      Object.assign(state.players[owner], {
        life: 20,
        will: 10,
        maxWill: 10,
        hand: [],
        deck: [],
        trash: [],
        late: [],
        turnsTaken: 5,
        originalDeckCounts: {},
        abyssTurns: 0,
        internTurnsRemaining: 0
      });
      state.players[owner].board = { teacher: null, seats: Array(9).fill(null) };
    }
  }, currentSide);
}

for (const side of ["player", "opponent"]) {
  test.describe(`${side === "player" ? "左" : "右"}CPUの効果評価`, () => {
    test.beforeEach(async ({ page }) => setup(page, side));

    test("出席時の全体ダメージ・列破壊・攻撃力低下を評価する", async ({ page }) => {
      const scores = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const put = (baseId, cardOwner, index, changes = {}) => {
          const card = api.makeBoardCard(api.createCardFromBase(baseId, cardOwner));
          Object.assign(card, changes);
          api.state.players[cardOwner].board.seats[index] = card;
          return card;
        };

        const loud = api.createCardFromBase("loud_typing_student", owner);
        put("general_student", enemy, 0, { currentHp: 2, attack: 5, baseAttack: 5 });
        const damageScore = api.scoreAiAttendanceRemoval(owner, loud, "seat", 3);

        api.state.players[enemy].board.seats.fill(null);
        const professor = api.createCardFromBase("thin_professor_h", owner);
        put("general_student", enemy, 0, { currentHp: 1, attack: 4, baseAttack: 4 });
        put("general_student", enemy, 2, { currentHp: 1, attack: 4, baseAttack: 4 });
        const columnDestroyScore = api.scoreAiAttendanceRemoval(owner, professor, "teacher");

        api.state.players[enemy].board.seats.fill(null);
        const livePerson = api.createCardFromBase("live_person", owner);
        put("general_student", enemy, 0, { attack: 5, baseAttack: 5, currentHp: 8, maxHp: 8 });
        const attackReductionScore = api.scoreAiAttackReductionAttendance(owner, livePerson);
        return { damageScore, columnDestroyScore, attackReductionScore };
      }, side);

      expect(scores.damageScore).toBeGreaterThan(0);
      expect(scores.columnDestroyScore).toBeGreaterThan(0);
      expect(scores.attackReductionScore).toBeGreaterThan(0);
    });

    test("進化時の複数対象効果を評価し、破壊不能な対象を撃破扱いしない", async ({ page }) => {
      const scores = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const organism = api.createCardFromBase("organism", owner);
        const perfectMutant = api.createCardFromBase("perfect_mutant", owner);
        const target = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
        target.currentHp = 1;
        api.state.players[enemy].board.seats[0] = target;
        const organismScore = api.scoreAiEvolutionEffect(owner, organism);
        target.padlockEquipment = api.createCardFromBase("padlock", enemy);
        const mutantScore = api.scoreAiEvolutionEffect(owner, perfectMutant);
        return { organismScore, mutantScore };
      }, side);

      expect(scores.organismScore).toBeGreaterThan(0);
      expect(scores.mutantScore).toBeLessThan(0);
    });

    test("ランダム破壊や一時退場でも、敵の強化源TRPGを安易に処理しない", async ({ page }) => {
      const scores = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const enemyStudent = api.makeBoardCard(api.createCardFromBase("enemy_student", owner));
        enemyStudent.playedOnTurn = 0;
        const trpg = api.makeBoardCard(api.createCardFromBase("trpg_member", enemy));
        trpg.currentHp = 3;
        api.state.players[owner].board.seats[0] = enemyStudent;
        api.state.players[enemy].board.seats[0] = trpg;
        api.applyBoardAuras();

        const frightened = api.createCardFromBase("scared_me", owner);
        const classroomChange = api.createCardFromBase("classroom_change", owner);
        api.state.players[owner].hand = [frightened, classroomChange];
        const scoreItem = (item) => owner === "opponent"
          ? api.scoreAiItem(item)
          : api.scoreTrainingYocchanItem(owner, item);
        return { frightened: scoreItem(frightened), classroomChange: scoreItem(classroomChange) };
      }, side);

      expect(scores.frightened).toBeLessThanOrEqual(0);
      expect(scores.classroomChange).toBeLessThanOrEqual(0);
    });

    test("スタディアブローダーは緊急でない場面なら、最後のTRPGを倒す配置を避ける", async ({ page }) => {
      const scores = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const enemyStudent = api.makeBoardCard(api.createCardFromBase("enemy_student", owner));
        enemyStudent.playedOnTurn = 0;
        api.state.players[owner].board.seats[0] = enemyStudent;
        const trpg = api.makeBoardCard(api.createCardFromBase("trpg_member", enemy));
        trpg.currentHp = 1;
        api.state.players[enemy].board.seats[0] = trpg;
        api.applyBoardAuras();
        const source = api.createCardFromBase("signal_professor_m", owner);
        api.state.players[enemy].hand = [api.createCardFromBase("general_student", enemy)];
        const protectedScore = api.scoreAiHandLoadPlacement(owner, source, "teacher");

        api.state.players[enemy].board.seats[0] = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
        const ordinaryScore = api.scoreAiHandLoadPlacement(owner, source, "teacher");
        return { protectedScore, ordinaryScore };
      }, side);

      expect(scores.protectedScore).toBeLessThan(scores.ordinaryScore);
      expect(scores.protectedScore).toBeLessThanOrEqual(0);
    });

    test("やべー！！のランダムダメージ評価に、最後のTRPGを失う危険を含める", async ({ page }) => {
      const scores = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const enemyStudent = api.makeBoardCard(api.createCardFromBase("enemy_student", owner));
        enemyStudent.playedOnTurn = 0;
        api.state.players[owner].board.seats[0] = enemyStudent;
        const trpg = api.makeBoardCard(api.createCardFromBase("trpg_member", enemy));
        trpg.currentHp = 1;
        api.state.players[enemy].board.seats[0] = trpg;
        api.state.players[enemy].board.seats[1] = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
        api.applyBoardAuras();
        const yabe = api.createCardFromBase("yabe", owner);
        api.state.players[owner].hand = [yabe];
        const scoreItem = () => owner === "player"
          ? api.scoreTrainingYocchanItem(owner, yabe)
          : api.scoreAiItem(yabe);
        const protectedScore = scoreItem();

        api.state.players[enemy].board.seats[0].baseId = "general_student";
        const ordinaryScore = scoreItem();
        return { protectedScore, ordinaryScore };
      }, side);

      expect(scores.protectedScore).toBeLessThan(scores.ordinaryScore);
    });
  });
}

test("連続進化ダメージの完了を待ってから次のAI行動へ進める", async ({ page }) => {
  await setup(page, "opponent");
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const source = api.makeBoardCard(api.createCardFromBase("demon_a_plus", "opponent"));
    const target = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    target.currentHp = 30;
    target.maxHp = 30;
    target.baseMaxHp = 30;
    api.state.players.opponent.board.teacher = source;
    api.state.players.player.board.seats[0] = target;

    api.scheduleEvolutionEffect("opponent", source, { effectDelayMs: 0 });
    await api.waitForAiTimedEffects();
    return {
      remainingHp: api.state.players.player.board.seats[0]?.currentHp,
      completedHits: api.state.log.filter((entry) => entry.text?.includes("連続攻撃")
        || entry.message?.includes("連続攻撃")).length
    };
  });
  expect(result.remainingHp).toBe(20);
});
