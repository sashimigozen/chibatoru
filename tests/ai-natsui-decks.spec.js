const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const revisedDecks = {
  "デザイン": { size: 40, required: { summer_teacher: 2, trendy_student: 2, kyoto_sound_i: 2 } },
  "ウマイボコピー": { size: 44, required: { kyushu_info_c: 3 } },
  "俺らの場所に入り込むクイーン": { size: 40, required: { summer_teacher: 2, extra_people: 3 } },
  "単位クリエイター": { size: 40, required: { secretly_mocked_student: 2 } },
  "就活の代償": { size: 43, required: { two_achievers: 2 } },
  "新生ヴァンパイア": { size: 40, required: { window_eater: 2 } },
  "爆発しちゃうー": { size: 40, required: { onigiri_draw: 2 } }
};

test("夏井先生を採用していた7デッキは枚数と通常ルールを保ち、素材か代替札を備える", async ({ page }) => {
  await page.goto(gameUrl);
  const decks = await page.evaluate(names => names.map(name => {
    const deck = ChibattleAiBattleDecks.find(entry => entry.name === name);
    return {
      ...deck,
      size: Object.values(deck.counts).reduce((sum, count) => sum + count, 0),
      valid: validateOnlineDeckForRule({ format: "normal" }, deck.counts, "normal").valid,
      materials: Object.keys(SUMMER_TEACHER_FUSION_COSTS).reduce((sum, id) => sum + (deck.counts[id] || 0), 0)
    };
  }), Object.keys(revisedDecks));
  for (const deck of decks) {
    const expected = revisedDecks[deck.name];
    expect(deck.size, deck.name).toBe(expected.size);
    expect(deck.valid, deck.name).toBe(true);
    expect(deck.updatedOn).toBe("2026-11-07");
    expect(deck.counts, deck.name).toMatchObject(expected.required);
    if (expected.required.summer_teacher) {
      expect(deck.materials, deck.name).toBeGreaterThanOrEqual(deck.counts.summer_teacher);
    } else {
      expect(deck.counts.summer_teacher, deck.name).toBeUndefined();
    }
  }
});

for (const [deckName, material, cost] of [
  ["デザイン", "trendy_student", 4],
  ["デザイン", "kyoto_sound_i", 6],
  ["俺らの場所に入り込むクイーン", "extra_people", 9]
]) {
  test(`${deckName}のAIは採用素材${material}を融合して出席できる`, async ({ page }) => {
    await page.goto(gameUrl);
    await page.evaluate(() => {
      startCardTest("summer_teacher");
      state.training.skipAnimations = true;
    });
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
    const result = await page.evaluate(({ deckName, material, cost }) => {
      const deck = ChibattleAiBattleDecks.find(entry => entry.name === deckName);
      const side = "opponent";
      const own = state.players[side];
      state.currentSide = side;
      state.gameOver = false;
      state.environment = null;
      for (const player of Object.values(state.players)) {
        player.board = { teacher: null, seats: Array(9).fill(null) };
        player.trash = [];
        player.late = [];
      }
      own.originalDeckCounts = { ...deck.counts };
      own.will = cost;
      own.maxWill = cost;
      own.hand = ["summer_teacher", material].map(id => createCardFromBase(id, side));
      state.players.player.board.seats[4] = makeBoardCard(createCardFromBase("general_student", "player"));
      const fused = tryFuseAnyHandCardForAi(side);
      const move = findAiPlayMove();
      const selected = move?.card.baseId;
      const played = move && placeCardFromHand(side, move.card.instanceId, move.zone, side, move.index, false);
      const summer = listBoardRefs(side).map(getBoardCardFromRef).find(card => card.baseId === "summer_teacher");
      return {
        fused, selected, played, material: summerTeacherFusionMaterial(summer),
        will: own.will,
        targets: listBoardRefs("player").length
      };
    }, { deckName, material, cost });
    expect(result).toMatchObject({ fused: true, selected: "summer_teacher", played: true, material, will: 0 });
    if (material === "extra_people") {
      await expect.poll(() => page.evaluate(() => listBoardRefs("opponent").length)).toBe(10);
    }
    if (material === "kyoto_sound_i") expect(result.targets).toBe(0);
  });
}
