const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("追加カードのテスト開始時に効果条件を満たす手札・盤面・デッキを用意する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const snapshots = {};
    const testIds = [
      "tokyo_tech_bro",
      "summer_teacher",
      "brother_capital",
      "padlock",
      "crotch_febreze",
      "smoke_flare",
      "one_eyed_peek",
      "big_laughter",
      "lie_pekora",
      "big_wall",
      "forbidden_book",
      "philosophy_cheating",
      "think_so",
      "illegal_cafeteria",
      "namen_tenno",
      "course_registration_party"
    ];

    const boardCards = (side) => {
      const player = api.state.players[side];
      return [...player.board.seats.filter(Boolean), player.board.teacher].filter(Boolean);
    };

    testIds.forEach((baseId) => {
      api.startCardTest(baseId);
      const target = api.state.players.player.hand.find((card) => card.baseId === baseId);
      snapshots[baseId] = {
        usable: Boolean(target && api.canUseHandCardNow(target)),
        hand: api.state.players.player.hand.map((card) => card.baseId),
        deck: api.state.players.player.deck.map((card) => card.baseId),
        opponentHand: api.state.players.opponent.hand.map((card) => card.baseId),
        playerBoard: boardCards("player").map((card) => ({
          baseId: card.baseId,
          type: card.type,
          hp: card.currentHp
        })),
        opponentBoard: boardCards("opponent").map((card) => ({
          baseId: card.baseId,
          type: card.type,
          hp: card.currentHp
        })),
        late: api.state.players.player.late.map((entry) => entry.card.baseId),
        life: api.state.players.player.life,
        maxWill: api.state.players.player.maxWill,
        playerDeckSize: api.state.players.player.deck.length,
        opponentDeckSize: api.state.players.opponent.deck.length
      };
    });
    return snapshots;
  });

  Object.entries(result).forEach(([baseId, snapshot]) => {
    expect(snapshot.usable, `${baseId} should be immediately usable`).toBe(true);
  });

  expect(result.tokyo_tech_bro.late).toEqual(expect.arrayContaining(["lazy_student", "cancel_student"]));
  expect(result.summer_teacher.hand).toEqual(expect.arrayContaining(["trendy_student", "extra_people", "kyoto_sound_i"]));
  expect(result.brother_capital.deck.slice(0, 4)).toEqual(expect.arrayContaining([
    "aggro_student", "single_cell", "ae_student", "general_student"
  ]));
  expect(result.crotch_febreze.playerBoard.filter((card) => card.baseId.includes("ae_student"))).toHaveLength(2);
  expect(result.crotch_febreze.opponentBoard.filter((card) => card.type === "teacher").length).toBeGreaterThanOrEqual(2);
  expect(result.smoke_flare.maxWill).toBe(8);
  expect(result.one_eyed_peek.opponentHand.length).toBeGreaterThan(0);
  expect(result.philosophy_cheating.opponentHand.filter((baseId) => ["ruler", "bento"].includes(baseId))).toHaveLength(2);
  expect(result.big_laughter.playerBoard.length).toBeGreaterThanOrEqual(4);
  expect(result.lie_pekora.playerBoard).toHaveLength(result.lie_pekora.opponentBoard.length);
  expect(result.big_wall.playerBoard.filter((card) => ["aggro_student", "general_student"].includes(card.baseId)).length).toBeGreaterThanOrEqual(2);
  expect(result.forbidden_book.life).toBeLessThanOrEqual(10);
  expect(result.think_so.deck).toContain("yuta");
  expect(result.illegal_cafeteria.hand).toContain("classroom");
  expect(result.illegal_cafeteria.playerBoard.some((card) => card.type === "vampire" && card.hp === 1)).toBe(true);
  expect(result.illegal_cafeteria.opponentBoard.some((card) => card.type === "vampire" && card.hp < 10)).toBe(true);
  expect(result.namen_tenno.opponentBoard.filter((card) => card.type === "vampire")).toHaveLength(3);
  expect(result.course_registration_party.playerDeckSize).toBeGreaterThanOrEqual(5);
  expect(result.course_registration_party.opponentDeckSize).toBeGreaterThanOrEqual(5);
});
