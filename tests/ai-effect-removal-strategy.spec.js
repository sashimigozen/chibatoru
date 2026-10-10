const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

// Use the same isolated battle fixture as ai-effect-damage-planning.spec.js.
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
  test.describe(`${side === "player" ? "左" : "右"}CPUの非戦闘除去`, () => {
    test.beforeEach(async ({ page }) => setup(page, side));

    test("深淵の対象が1人だけなら反撃を受ける攻撃を避ける", async ({ page }) => {
      const result = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const attacker = api.makeBoardCard(api.createCardFromBase("general_student", owner));
        attacker.playedOnTurn = 0;
        const target = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
        target.attack = 9;
        api.state.players[owner].board.seats[0] = attacker;
        api.state.players[enemy].board.seats[0] = target;
        api.state.players[owner].abyssTurns = 1;
        const plan = api.planAiGuaranteedEndTurnEffectKills(owner);
        const attackTarget = owner === "opponent"
          ? api.findAiAttackTarget(attacker)
          : api.findTrainingAiAttackTarget(owner, attacker);
        api.resolveEndTurnEffects(owner);
        return {
          reserved: plan.targetIds.has(target.instanceId),
          attackTarget,
          targetRemoved: !api.state.players[enemy].board.seats[0]
        };
      }, side);
      expect(result).toEqual({ reserved: true, attackTarget: null, targetRemoved: true });
    });

    test("深淵のランダム対象が複数なら特定の出席者を撃破予約しない", async ({ page }) => {
      const size = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        api.state.players[owner].abyssTurns = 1;
        for (const index of [0, 1]) {
          api.state.players[enemy].board.seats[index] = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
        }
        return api.planAiGuaranteedEndTurnEffectKills(owner).targetIds.size;
      }, side);
      expect(size).toBe(0);
    });

    test("病に臥すU太の体力低下で倒せる唯一の出席者を攻撃しない", async ({ page }) => {
      const result = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const source = api.makeBoardCard(api.createCardFromBase("sick_yuta", owner));
        const target = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
        target.currentHp = 1;
        target.defense = 5;
        api.state.players[owner].board.seats[0] = source;
        api.state.players[enemy].board.seats[0] = target;
        const plan = api.planAiGuaranteedEndTurnEffectKills(owner);
        api.resolveEndTurnEffects(owner);
        api.applyBoardAuras();
        return {
          reserved: plan.targetIds.has(target.instanceId),
          sourcePreserved: plan.sourceIds.has(source.instanceId),
          targetRemoved: !api.state.players[enemy].board.seats[0]
        };
      }, side);
      expect(result).toEqual({ reserved: true, sourcePreserved: true, targetRemoved: true });
    });

    test("感染済みの学生は病で体力が再び減らないため撃破予約しない", async ({ page }) => {
      const result = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const target = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
        target.currentHp = 2;
        target.defense = 8;
        target.illnessEquipments = [
          api.createCardFromBase("illness", enemy),
          api.createCardFromBase("illness", enemy)
        ];
        api.state.players[enemy].board.seats[0] = target;
        const plan = api.planAiGuaranteedEndTurnEffectKills(owner);
        api.resolveIllnessEndTurn();
        api.applyBoardAuras();
        return {
          reserved: plan.targetIds.has(target.instanceId),
          targetRemoved: !api.state.players[enemy].board.seats[0]
        };
      }, side);
      expect(result).toEqual({ reserved: false, targetRemoved: false });
    });

    test("病がランダムに広がる学生が複数なら対象を確定扱いしない", async ({ page }) => {
      const size = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        for (const index of [0, 1, 2]) {
          const target = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
          target.currentHp = 1;
          if (index === 0) target.illnessEquipments = [api.createCardFromBase("illness", enemy)];
          api.state.players[enemy].board.seats[index] = target;
        }
        return api.planAiGuaranteedEndTurnEffectKills(owner).targetIds.size;
      }, side);
      expect(size).toBe(0);
    });

    test("病によってU太が変化する場合は撃破予約しない", async ({ page }) => {
      const result = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        api.state.players[owner].board.seats[0] = api.makeBoardCard(api.createCardFromBase("sick_yuta", owner));
        const target = api.makeBoardCard(api.createCardFromBase("yuta", enemy));
        target.currentHp = 1;
        api.state.players[enemy].board.seats[0] = target;
        const reserved = api.planAiGuaranteedEndTurnEffectKills(owner).targetIds.has(target.instanceId);
        api.resolveEndTurnEffects(owner);
        return { reserved, resultingCard: api.state.players[enemy].board.seats[0]?.baseId };
      }, side);
      expect(result).toEqual({ reserved: false, resultingCard: "sick_yuta" });
    });

    test("相手が行動する前に期限を迎える予約破壊だけを考慮する", async ({ page }) => {
      const result = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const makeTarget = (index, due, dueSide) => {
          const card = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
          card.destroyAtActionTurn = due;
          card.destroyAtSideStart = dueSide;
          api.state.players[enemy].board.seats[index] = card;
          return card;
        };
        const due = makeTarget(0, api.state.actionTurn + 1, enemy);
        const later = makeTarget(1, api.state.actionTurn + 2, enemy);
        const wrongSide = makeTarget(2, api.state.actionTurn + 1, owner);
        const plan = api.planAiGuaranteedEndTurnEffectKills(owner);
        return {
          due: plan.targetIds.has(due.instanceId),
          later: plan.targetIds.has(later.instanceId),
          wrongSide: plan.targetIds.has(wrongSide.instanceId)
        };
      }, side);
      expect(result).toEqual({ due: true, later: false, wrongSide: false });
    });

    test("熱心な学生は講義で回復するため撃破できると判断しない", async ({ page }) => {
      const result = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", owner));
        teacher.playedOnTurn = 0;
        const target = api.makeBoardCard(api.createCardFromBase("diligent_student", enemy));
        target.currentHp = 1;
        api.state.players[owner].board.teacher = teacher;
        api.state.players[enemy].board.seats[0] = target;
        const ref = { owner, zone: "teacher", index: null };
        const lectureDamage = api.previewFinalDamageToCard(target, 1, teacher, { damageKind: "lecture" });
        const choosesLecture = api.shouldAiUseLecture(ref, teacher, owner);
        api.performTeacherLecture(owner, ref, { renderAfter: false });
        return { lectureDamage, choosesLecture, remainingHp: target.currentHp };
      }, side);
      expect(result).toEqual({ lectureDamage: 0, choosesLecture: false, remainingHp: 2 });
    });

    test("再生学生の未使用の全回復と南京錠は確定撃破扱いしない", async ({ page }) => {
      const result = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const source = api.makeBoardCard(api.createCardFromBase("rear_queen", owner));
        api.state.players[owner].board.seats[0] = source;
        const rebirth = api.makeBoardCard(api.createCardFromBase("rebirth_student", enemy));
        rebirth.currentHp = 1;
        const locked = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
        locked.currentHp = 1;
        locked.padlockEquipment = api.createCardFromBase("padlock", enemy);
        api.state.players[enemy].board.seats[0] = rebirth;
        api.state.players[enemy].board.seats[1] = locked;
        const plan = api.planAiGuaranteedEndTurnEffectKills(owner);
        api.resolveEndTurnEffects(owner);
        api.applyBoardAuras();
        return {
          rebirthReserved: plan.targetIds.has(rebirth.instanceId),
          lockedReserved: plan.targetIds.has(locked.instanceId),
          rebirthSurvived: api.state.players[enemy].board.seats[0]?.currentHp > 0,
          rebirthUsed: rebirth.rebirthUsed,
          lockedHp: locked.currentHp
        };
      }, side);
      expect(result).toEqual({
        rebirthReserved: false,
        lockedReserved: false,
        rebirthSurvived: true,
        rebirthUsed: true,
        lockedHp: 1
      });
    });

    test("インターンで発動役が先に変化するならクイーンの撃破を予約しない", async ({ page }) => {
      const result = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const source = api.makeBoardCard(api.createCardFromBase("aggro_queen", owner));
        const target = api.makeBoardCard(api.createCardFromBase("general_student", enemy));
        target.currentHp = 2;
        api.state.players[owner].board.seats[5] = source;
        api.state.players[owner].internTurnsRemaining = 1;
        api.state.players[enemy].board.seats[0] = target;
        const plan = api.planAiGuaranteedEndTurnEffectKills(owner);
        api.resolveEndTurnEffects(owner);
        api.applyBoardAuras();
        return {
          reserved: plan.targetIds.has(target.instanceId),
          sourcePreserved: plan.sourceIds.has(source.instanceId),
          resultingSource: api.state.players[owner].board.seats[5]?.baseId,
          remainingTargetHp: target.currentHp
        };
      }, side);
      expect(result).toEqual({
        reserved: false,
        sourcePreserved: false,
        resultingSource: "suit_student",
        remainingTargetHp: 2
      });
    });

    test("ダメージ前にストレスヘアーで体力が増える対象は撃破予約しない", async ({ page }) => {
      const result = await page.evaluate((owner) => {
        const api = window.__chibattle;
        const enemy = owner === "player" ? "opponent" : "player";
        const source = api.makeBoardCard(api.createCardFromBase("aggro_queen", owner));
        const target = api.makeBoardCard(api.createCardFromBase("dark_yuta", enemy));
        target.currentHp = 2;
        target.stressHairEquipment = api.createCardFromBase("stress_hair", enemy);
        target.stressHairEquipment.attachedAtTurn = 0;
        api.state.players[owner].board.seats[5] = source;
        api.state.players[enemy].board.seats[0] = target;
        const plan = api.planAiGuaranteedEndTurnEffectKills(owner);
        api.resolveEndTurnEffects(owner);
        api.applyBoardAuras();
        return {
          reserved: plan.targetIds.has(target.instanceId),
          targetSurvived: api.state.players[enemy].board.seats[0]?.currentHp > 0,
          remainingHp: target.currentHp,
          hairRemoved: !target.stressHairEquipment
        };
      }, side);
      expect(result).toEqual({ reserved: false, targetSurvived: true, remainingHp: 5, hairRemoved: true });
    });
  });
}
