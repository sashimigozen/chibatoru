const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

for (const [baseId, summoned, edge] of [
  ["predator", "best_friend", 8],
  ["apprentice_vampire", "apprentice_vampire", 2]
]) {
  test(`${baseId}は右隣だけに出席させ、塞がっているときや右端では左を使わない`, async ({ page }) => {
    await page.goto(gameUrl);
    for (const [seat, expected] of [[4, [5]], [7, []], [edge, []]]) {
      await page.evaluate(id => {
        startCardTest(id);
        state.training.skipAnimations = true;
      }, baseId);
      await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
      await page.evaluate(({ id, index }) => {
        const card = state.players.player.hand.find(entry => entry.baseId === id);
        playCard(card.instanceId, "seat", "player", index);
      }, { id: baseId, index: seat });
      await expect.poll(() => page.evaluate(index => state.players.player.board.seats[index]?.baseId, seat)).toBe(baseId);
      await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
      const destinations = await page.evaluate(({ index, id }) => {
        return state.players.player.board.seats.flatMap((card, slot) =>
          slot !== index && card?.baseId === id ? [slot] : []);
      }, { index: seat, id: summoned });
      expect(destinations).toEqual(expected);
    }
  });
}

test("出席先の選び方をカード本文に明記する", async ({ page }) => {
  await page.goto(gameUrl);
  const snippets = {
    enemy_boss: "2人までランダムに出席させる",
    tomoyo_mou: "空いている席マスを1つずつ選び",
    chugidesu: "空いている席マスを2つまで選び",
    tiny_rhythm_student: "コピーごとに自分の空いている席マス1つを選び",
    remote_participant_student: "自分の空いている席マス1つを選び",
    brother_capital: "それぞれの出席先を自分の講義室から選び",
    predator: "右隣の席マスが空いているなら",
    apprentice_vampire: "右隣の席マスが空いているなら"
  };
  const texts = await page.evaluate(ids => ids.map(id => cardRulesText(createCardFromBase(id, "player"))), Object.keys(snippets));
  texts.forEach((text, index) => expect(text.replaceAll("\n", "")).toContain(Object.values(snippets)[index]));
});

test("敵の幹部のカードテストでは盤面から席を選ばず敵2人が出席する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    startCardTest("enemy_boss");
    state.training.skipAnimations = true;
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => {
    const card = state.players.player.hand.find(entry => entry.baseId === "enemy_boss");
    playCard(card.instanceId, "seat", "player", 4);
  });
  await expect.poll(() => page.evaluate(() => {
    const seats = state.players.player.board.seats;
    return [seats[4]?.baseId, seats.filter(card => card?.baseId === "enemy_student").length, Boolean(state.pendingCopiedCard)];
  })).toEqual(["enemy_boss", 3, false]);
});
