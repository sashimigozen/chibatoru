const {test, expect} = require("@playwright/test");
const {pathToFileURL} = require("node:url");
const path = require("node:path");
const catalog = require("../server/card-catalog.json");
const loDeck = require("./fixtures/lo-final-lecture-deck.json");

test("通常版とオンラインサーバーの直接編成・専攻・エースぺ・枚数制限を揃える", async ({page}) => {
  await page.goto(pathToFileURL(path.join(__dirname, "..", "index.html")).href);
  const actual = await page.evaluate(() => ({
    direct: [...DIRECT_DECK_CARD_IDS].sort(), specialties: SPECIALTY_CARD_IDS,
    aces: [...ACE_CARD_IDS].sort(), limits: CARD_COPY_LIMITS
  }));
  expect([...catalog.direct].sort()).toEqual(actual.direct);
  expect(Object.keys(catalog.specialties).sort()).toEqual(Object.keys(actual.specialties).sort());
  for (const id of Object.keys(actual.specialties)) expect([...catalog.specialties[id]].sort()).toEqual([...actual.specialties[id]].sort());
  expect([...catalog.aces].sort()).toEqual(actual.aces);
  expect(catalog.copyLimits).toEqual(actual.limits);
});

test("提供された40枚のLO最終講義を通常ルールで使用できる", async ({page}) => {
  await page.goto(pathToFileURL(path.join(__dirname, "..", "index.html")).href);
  const validation = await page.evaluate(deck => {
    const result = validateOnlineDeckForRule({format: "normal", name: deck.name}, deck.counts, "normal");
    return {valid: result.valid, size: result.size, errors: result.errors};
  }, loDeck);
  expect(validation).toEqual({valid: true, size: 40, errors: []});
  for (const id of Object.keys(loDeck.counts)) expect(catalog.direct).toContain(id);
  expect(catalog.specialties.common).toContain("amphisbaena_sofa");
});
