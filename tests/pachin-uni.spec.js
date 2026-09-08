const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
});

test("パチンウニーは手札から出席したとき一般学生を出席させ、相手の5回目のターン終了まで攻撃不可にする", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    api.startCardTest("pachin_uni");
    const { state } = api;
    state.testMode = false;
    state.currentSide = "player";
    state.players.player.will = 10;
    state.players.opponent.turnsTaken = 3;
    state.players.opponent.board.seats = Array(9).fill(null);

    const pachinUni = state.players.player.hand.find((card) => card.baseId === "pachin_uni");
    const text = api.cardRulesText(pachinUni);
    const played = api.placeCardFromHand("player", pachinUni.instanceId, "seat", "player", 0, false);
    await api.waitForOrderedAttendance();

    const students = state.players.opponent.board.seats.slice(6, 9);
    const restrictionAt = (turnsTaken) => {
      state.players.opponent.turnsTaken = turnsTaken;
      return api.battleCardRestrictionEntries(students[0]).map((entry) => entry.label);
    };
    return {
      played,
      text,
      studentIds: students.map((card) => card?.baseId || null),
      lockValues: students.map((card) => card?.attackLockedUntilOwnerTurnsTaken || null),
      duringFirstTurn: restrictionAt(4),
      duringFifthTurn: restrictionAt(8),
      afterFifthTurn: restrictionAt(9)
    };
  });

  expect(result.played).toBe(true);
  expect(result.text).toBe("このカードを手札から出席させたとき、相手の3行目の空いている席マスすべてに「一般学生」を1人ずつ出席させる。それらは、その相手が自分のターンを5回終了するまで攻撃できない。");
  expect(result.studentIds).toEqual(["general_student", "general_student", "general_student"]);
  expect(result.lockValues).toEqual([8, 8, 8]);
  expect(result.duringFirstTurn).toContain("攻撃不可：自分のターンをあと5回");
  expect(result.duringFifthTurn).toContain("攻撃不可：自分のターンをあと1回");
  expect(result.afterFifthTurn.some((label) => label.startsWith("攻撃不可"))).toBe(false);
});

test("効果で出席したパチンウニー自身は一般学生を出席させない", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    api.startCardTest("pachin_uni");
    api.state.players.opponent.board.seats = Array(9).fill(null);
    const pachinUni = api.makeBoardCard(api.createCardFromBase("pachin_uni", "player"));
    const attended = api.attendCard("player", pachinUni, "seat", 0, {
      attendanceSource: api.ATTENDANCE_SOURCE.GENERATED
    });
    await api.waitForOrderedAttendance();
    return {
      attended: Boolean(attended),
      opponentThirdRow: api.state.players.opponent.board.seats.slice(6, 9).map((card) => card?.baseId || null)
    };
  });

  expect(result).toEqual({
    attended: true,
    opponentThirdRow: [null, null, null]
  });
});
