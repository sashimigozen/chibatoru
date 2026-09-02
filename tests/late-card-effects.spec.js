const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("来てなかった学生が講義室から校外へ送られると相手の教師を破壊する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("absent_student");
    const absentStudent = api.state.players.player.board.seats[0];
    const teacher = api.state.players.opponent.board.teacher;
    api.destroyBoardCard({ owner: "player", zone: "seat", index: 0 }, { reason: "テスト" });
    return {
      absentStudentId: absentStudent.instanceId,
      teacherId: teacher.instanceId,
      playerSeatEmpty: api.state.players.player.board.seats[0] === null,
      opponentTeacherEmpty: api.state.players.opponent.board.teacher === null,
      playerTrashIds: api.state.players.player.trash.map((card) => card.instanceId),
      opponentTrashIds: api.state.players.opponent.trash.map((card) => card.instanceId)
    };
  });

  expect(result.playerSeatEmpty).toBe(true);
  expect(result.opponentTeacherEmpty).toBe(true);
  expect(result.playerTrashIds).toContain(result.absentStudentId);
  expect(result.opponentTrashIds).toContain(result.teacherId);
});

test("遅刻に厳しい教師が残っていれば講義室の破壊後に遅刻ゾーンの学生も送る", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("strict_lateness_teacher");
    const teacher = api.makeBoardCard(api.createCardFromBase("strict_lateness_teacher", "player"));
    api.attendCard("player", teacher, "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.HAND
    });
    return {
      sourceStillPresent: api.state.players.player.board.teacher?.instanceId === teacher.instanceId,
      playerLate: api.state.players.player.late.map((entry) => entry.card.baseId),
      opponentLate: api.state.players.opponent.late.map((entry) => entry.card.baseId),
      playerTrash: api.state.players.player.trash.map((card) => card.baseId),
      opponentTrash: api.state.players.opponent.trash.map((card) => card.baseId),
      playerBoard: api.state.players.player.board.seats.filter(Boolean).map((card) => card.baseId),
      opponentBoard: api.state.players.opponent.board.seats.filter(Boolean).map((card) => card.baseId)
    };
  });

  expect(result.sourceStillPresent).toBe(true);
  expect(result.playerBoard).not.toContain("lazy_student");
  expect(result.opponentBoard).not.toContain("lazy_student");
  expect(result.playerLate).toEqual([]);
  expect(result.opponentLate).toEqual([]);
  expect(result.playerTrash).toEqual(expect.arrayContaining(["lazy_student", "cancel_student"]));
  expect(result.opponentTrash).toEqual(expect.arrayContaining(["lazy_student", "eaten_student"]));
});

test("来てなかった学生に遅刻に厳しい教師が破壊された場合はその後の効果を発動しない", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("strict_lateness_teacher");
    const player = api.state.players.player;
    const opponent = api.state.players.opponent;
    player.board.seats.fill(null);
    player.board.teacher = null;
    opponent.board.seats.fill(null);
    opponent.board.teacher = null;
    player.trash = [];
    opponent.trash = [];
    player.late = [{
      card: api.createCardFromBase("cancel_student", "player"),
      owner: "player",
      zone: "seat",
      index: 1,
      remaining: 2
    }];
    opponent.late = [{
      card: api.createCardFromBase("eaten_student", "opponent"),
      owner: "opponent",
      zone: "seat",
      index: 1,
      remaining: 1
    }];
    opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("absent_student", "opponent"));

    const teacher = api.makeBoardCard(api.createCardFromBase("strict_lateness_teacher", "player"));
    api.attendCard("player", teacher, "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.HAND
    });
    return {
      sourcePresent: Boolean(player.board.teacher),
      playerLate: player.late.map((entry) => entry.card.baseId),
      opponentLate: opponent.late.map((entry) => entry.card.baseId),
      playerTrash: player.trash.map((card) => card.baseId),
      opponentTrash: opponent.trash.map((card) => card.baseId),
      log: api.state.log.join("\n")
    };
  });

  expect(result.sourcePresent).toBe(false);
  expect(result.playerTrash).toContain("strict_lateness_teacher");
  expect(result.opponentTrash).toContain("absent_student");
  expect(result.playerLate).toEqual(["cancel_student"]);
  expect(result.opponentLate).toEqual(["eaten_student"]);
  expect(result.log).toContain("「その後」の効果は発動しませんでした");
});
