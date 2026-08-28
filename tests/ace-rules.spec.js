const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("エースぺの通常・専攻・カオス・オンライン判定が正式仕様と一致する", async ({ page }) => {
  await page.goto(gameUrl);

  const cases = await page.evaluate(() => {
    const api = window.__chibattle;
    const normalIds = [
      "general_student", "aggro_student", "aggro_king", "single_cell", "adjective_student", "yuta", "aggro_queen",
      "ae_student", "hurried_student", "lazy_student", "cancel_student", "back_question_student", "best_friend", "laughing_front_student"
    ];
    const normalDeck = () => Object.fromEntries(normalIds.map((baseId) => [baseId, 3]));
    const lateDeck = () => {
      const counts = {};
      [
        "general_student", "absolute_woman", "fridge_thief", "classroom", "environment_setup",
        "go_away", "happy_experience", "hondara", "water_2l", "word_increaser"
      ].forEach((baseId) => { counts[baseId] = 3; });
      ["adjective_student", "cancel_student", "eaten_student", "hurried_student", "lazy_student"]
        .forEach((baseId) => { counts[baseId] = 2; });
      return counts;
    };
    const replace = (counts, removed, additions) => ({
      ...counts,
      general_student: counts.general_student - removed,
      ...additions
    });
    const online = (format, specialtyId, counts, ruleId) => api.validateOnlineDeckForRule(
      { format, specialtyId, name: "test" },
      counts,
      ruleId
    );

    const normalZero = normalDeck();
    const normalOne = replace(normalDeck(), 1, { think_so: 1 });
    const normalMany = replace(normalDeck(), 2, { think_so: 2 });
    const normalAggroArmy = replace(normalDeck(), 1, { aggro_army: 1 });
    const normalScoutStudent = replace(normalDeck(), 1, { scout_student: 1 });
    const normalTaSquad = replace(normalDeck(), 1, { ta_squad: 1 });
    const specialtyZero = lateDeck();
    const specialtyOne = replace(lateDeck(), 1, { tokyo_tech_bro: 1 });
    const specialtySameTwo = replace(lateDeck(), 2, { tokyo_tech_bro: 2 });
    const specialtyDifferent = replace(lateDeck(), 2, { tokyo_tech_bro: 1, think_so: 1 });
    const specialtyOther = replace(lateDeck(), 1, { think_so: 1 });
    const chaosOne = { general_student: 39, think_so: 1 };
    const chaosSame = { think_so: 40 };
    const chaosDifferent = { think_so: 20, tokyo_tech_bro: 20 };
    const chaosMany = { think_so: 20, tokyo_tech_bro: 20, general_student: 10 };

    return {
      normalZero: api.validateDeckCounts(normalZero),
      normalOne: api.validateDeckCounts(normalOne),
      normalMany: api.validateDeckCounts(normalMany),
      normalAggroArmy: api.validateDeckCounts(normalAggroArmy),
      normalScoutStudent: api.validateDeckCounts(normalScoutStudent),
      normalTaSquad: api.validateDeckCounts(normalTaSquad),
      aggroArmyCommonEverySpecialty: api.SPECIALTY_DEFINITIONS
        .every((definition) => api.specialtyAllowedCardIds(definition.id).has("aggro_army")),
      scoutStudentExpansionOnly: api.specialtyAllowedCardIds("expansion").has("scout_student")
        && !api.specialtyAllowedCardIds("late").has("scout_student")
        && !api.SPECIALTY_CARD_IDS.common.includes("scout_student"),
      taSquadExpansionOnly: api.specialtyAllowedCardIds("expansion").has("ta_squad")
        && !api.specialtyAllowedCardIds("late").has("ta_squad")
        && !api.SPECIALTY_CARD_IDS.common.includes("ta_squad"),
      specialtyOne: api.validateSpecialtyDeckCounts(specialtyOne, "late"),
      specialtySameTwo: api.validateSpecialtyDeckCounts(specialtySameTwo, "late"),
      specialtyDifferent: api.validateSpecialtyDeckCounts(specialtyDifferent, "late"),
      specialtyOther: api.validateSpecialtyDeckCounts(specialtyOther, "late"),
      specialtyZero: api.validateSpecialtyDeckCounts(specialtyZero, "late"),
      chaosOne: api.validateChaosDeckCounts(chaosOne),
      chaosSame: api.validateChaosDeckCounts(chaosSame),
      chaosDifferent: api.validateChaosDeckCounts(chaosDifferent),
      chaosMany: api.validateChaosDeckCounts(chaosMany),
      chaosToken: online("chaos", "", { midge: 40 }, "chaos"),
      onlineNormalOne: online("normal", "", normalOne, "normal"),
      onlineSpecialtyOne: online("specialty", "late", specialtyOne, "specialty"),
      onlineSpecialtyTwo: online("specialty", "late", specialtySameTwo, "specialty"),
      onlineChaosMany: online("chaos", "", chaosMany, "chaos")
    };
  });

  expect(cases.normalZero.valid).toBe(true);
  expect(cases.normalOne.valid).toBe(false);
  expect(cases.normalMany.valid).toBe(false);
  expect(cases.normalAggroArmy.valid).toBe(true);
  expect(cases.normalScoutStudent.valid).toBe(true);
  expect(cases.normalTaSquad.valid).toBe(true);
  expect(cases.aggroArmyCommonEverySpecialty).toBe(true);
  expect(cases.scoutStudentExpansionOnly).toBe(true);
  expect(cases.taSquadExpansionOnly).toBe(true);
  expect(cases.specialtyOne.valid).toBe(true);
  expect(cases.specialtySameTwo.valid).toBe(false);
  expect(cases.specialtyDifferent.valid).toBe(false);
  expect(cases.specialtyOther.valid).toBe(false);
  expect(cases.specialtyZero.valid).toBe(true);
  expect(cases.chaosOne.valid).toBe(true);
  expect(cases.chaosSame.valid).toBe(true);
  expect(cases.chaosDifferent.valid).toBe(true);
  expect(cases.chaosMany.valid).toBe(true);
  expect(cases.chaosToken.valid).toBe(false);
  expect(cases.onlineNormalOne.errors).toContain("エースぺは通常ルールでは使用できません。");
  expect(cases.onlineSpecialtyOne.valid).toBe(true);
  expect(cases.onlineSpecialtyTwo.errors).toContain("エースぺは1デッキにつき1種類・1枚までです。");
  expect(cases.onlineChaosMany.valid).toBe(true);
  expect(cases.onlineChaosMany.errors.some((message) => message.includes("エースぺ"))).toBe(false);
});
