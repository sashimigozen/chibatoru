const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest("general_student");
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.environment = null;
    state.phase = "battle";
    state.actionTurn = 8;
    state.currentSide = "player";
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], { board: { seats: Array(9).fill(null), teacher: null },
        hand: [], deck: [], trash: [], late: [], life: 10, maxWill: 20, will: 20, attendancesThisTurn: 0 });
    }
  });
});

test("4枚の全文・能力値・共通カード登録・1行目制限が一致する", async ({ page }) => {
  const result = await page.evaluate(() => {
    return ["laughing_front_student", "academic_move", "acting_out_man_2", "acting_out_woman"].map(id => {
      const card = createCardFromBase(id, "player");
      return { id, stats: [card.cost, card.attack ?? 0, card.hp ?? 0], text: cardRulesText(card),
        deck: ALL_DECK_IDS.includes(id), common: SPECIALTY_CARD_IDS.common.includes(id),
        row1: canPlaceCard("player", card, "seat", "player", 0),
        row2: canPlaceCard("player", card, "seat", "player", 3),
        teacher: canPlaceCard("player", card, "teacher", "player", null) };
    });
  });
  const texts = [
    "[超注目]\nこのカードは1行目にのみ出席できる。\n自分のターン終了時、自分の教卓マスに教師がいるなら、自分の気力を3回復する。",
    "このカードが環境マスにあるかぎり、各ターン、次に講義室に出席した出席者1人だけは[超陽気]を持つ。\nその出席者は、自分のターン終了時、校外エリアへ送られる。",
    "[注目]\nこのカードは1行目にのみ出席できる。\nこのカードが自分の講義室にいるかぎり、自分の「アクティングアウト」とつく、このカード以外の出席者すべては[陽気]を持つ。",
    "このカードは1行目にのみ出席できる。\nこのカードが自分の講義室にいて、ほかに自分の「アクティングアウト」とつく出席者がいるなら、自分本体と自分の出席者すべてが相手の学生から受けるダメージを-2する。\nこの効果は重複しない。"
  ];
  result.forEach((entry, i) => {
    expect(entry.text).toBe(texts[i]);
    expect(entry.stats).toEqual(i === 1 ? [4, 0, 0] : i === 2 ? [2, 0, 3] : [3, 1, 3]);
    expect(entry.deck && entry.common).toBe(true);
    if (i !== 1) expect([entry.row1, entry.row2, entry.teacher]).toEqual([true, false, false]);
  });
});

for (const side of ["player", "opponent"]) test(`前で積極的に笑う学生は教師が教卓にいるとき本体だけ3回復する ${side}`, async ({ page }) => {
  const result = await page.evaluate(side => {
    const p = state.players[side];
    const card = makeBoardCard(createCardFromBase("laughing_front_student", side));
    const teacher = makeBoardCard(createCardFromBase("general_teacher", side));
    teacher.currentHp = 1;
    p.board.seats[0] = card;
    p.board.seats[3] = teacher;
    resolveStudentEndTurnEffects(side);
    const seatTeacher = p.life;
    p.board.seats[3] = null;
    p.board.teacher = teacher;
    resolveStudentEndTurnEffects(side);
    const healed = p.life;
    const estimate = aiEndTurnHealing(side);
    card.padlockEquipment = { baseId: "padlock" };
    resolveStudentEndTurnEffects(side);
    return { seatTeacher, healed, teacherHp: teacher.currentHp, afterSuppression: p.life, estimate };
  }, side);
  expect(result).toEqual({ seatTeacher: 10, healed: 13, teacherHp: 1, afterSuppression: 13, estimate: 3 });
});

for (const side of ["player", "opponent"]) test(`2号は自身以外の味方の名前一致だけに陽気を与え、離れると消える ${side}`, async ({ page }) => {
  const result = await page.evaluate(side => {
    const p = state.players[side];
    const other = oppositeSide(side);
    const cards = ["acting_out_man_2", "acting_out_woman", "acting_out_man", "general_student"].map(id =>
      makeBoardCard(createCardFromBase(id, side)));
    cards.forEach((card, i) => p.board.seats[i] = card);
    const enemy = makeBoardCard(createCardFromBase("acting_out_woman", other));
    state.players[other].board.seats[0] = enemy;
    const keywords = cards.map(card => hasKeyword(card, "陽気"));
    const enemyCheerful = hasKeyword(enemy, "陽気");
    const sources = battleCardGrantedKeywordEntries(cards[1]);
    const ongoing = boardActiveEffectLines(side).join("\n");
    cards[0].padlockEquipment = { baseId: "padlock" };
    const suppressed = hasKeyword(cards[1], "陽気");
    delete cards[0].padlockEquipment;
    p.board.seats[0] = null;
    return { keywords, enemyCheerful, sources, ongoing, suppressed, removed: hasKeyword(cards[1], "陽気") };
  }, side);
  expect(result.keywords).toEqual([false, true, true, false]);
  expect(result.enemyCheerful).toBe(false);
  expect(result.suppressed).toBe(false);
  expect(result.removed).toBe(false);
  expect(result.sources).toContainEqual({ keyword: "陽気", source: "アクティングアウトマン2号" });
  expect(result.ongoing).toContain("自分の「アクティングアウト」とつく、このカード以外の出席者すべて");
});

for (const side of ["player", "opponent"]) test(`ウーマンは本体・全出席者の学生ダメージを2軽減し、重複しない ${side}`, async ({ page }) => {
  const result = await page.evaluate(side => {
    const p = state.players[side];
    const other = oppositeSide(side);
    const women = [0, 1].map(i => p.board.seats[i] = makeBoardCard(createCardFromBase("acting_out_woman", side)));
    const target = makeBoardCard(createCardFromBase("strong_student", side));
    p.board.teacher = target;
    const student = makeBoardCard(createCardFromBase("strong_student", other));
    const teacher = makeBoardCard(createCardFromBase("general_teacher", other));
    const item = createCardFromBase("double_diamond", other);
    const preview = previewFinalDamageToCard(target, 4, student, { combat: true });
    const combat = dealDamageToCard(target, 4, student, { combat: true });
    const ownStudent = makeBoardCard(createCardFromBase("general_student", side));
    const unchanged = [previewFinalDamageToCard(target, 3, teacher), previewFinalDamageToCard(target, 3, item),
      previewFinalDamageToCard(target, 3, ownStudent)];
    const floor = dealDamageToCard(women[0], 1, student);
    damagePlayer(side, 4, student);
    const protectedLife = p.life;
    damagePlayer(side, 2, teacher);
    const teacherLife = p.life;
    women.forEach(card => card.padlockEquipment = { baseId: "padlock" });
    damagePlayer(side, 2, student);
    return { preview, combat, unchanged, floor, protectedLife, teacherLife, suppressedLife: p.life };
  }, side);
  expect(result).toEqual({ preview: 2, combat: 2, unchanged: [3, 3, 3], floor: 0,
    protectedLife: 8, teacherLife: 6, suppressedLife: 4 });
});

for (const side of ["player", "opponent"]) test(`ウーマンは単独・相手だけでは軽減せず味方の出入りで切り替わる ${side}`, async ({page}) => {
  const r = await page.evaluate(side => {
    const p = state.players[side], other = oppositeSide(side);
    const woman = makeBoardCard(createCardFromBase("acting_out_woman", side)); p.board.seats[0] = woman;
    state.players[other].board.seats[0] = makeBoardCard(createCardFromBase("acting_out_man_2", other));
    const enemy = makeBoardCard(createCardFromBase("general_student", other));
    const alone = [previewFinalDamageToLife(side,3,enemy), boardActiveEffectLines(side).length];
    p.board.seats[1] = makeBoardCard(createCardFromBase("general_student", side));
    const unrelated = previewFinalDamageToLife(side,3,enemy);
    const ally = makeBoardCard(createCardFromBase("acting_out_man_2",side));p.board.seats[1] = ally;
    const active = [previewFinalDamageToLife(side,3,enemy), previewFinalDamageToCard(woman,3,enemy), boardActiveEffectLines(side).filter(line=>line.startsWith(woman.name)).length];
    ally.currentHp = 0;
    const defeated = previewFinalDamageToLife(side,3,enemy);
    ally.currentHp = 3;p.board.seats[1] = null;
    const removed = [previewFinalDamageToLife(side,3,enemy), boardActiveEffectLines(side).length];
    return {alone,unrelated,active,defeated,removed};
  },side);
  expect(r).toEqual({alone:[3,0],unrelated:3,active:[1,1,1],defeated:3,removed:[3,0]});
});

for (const side of ["player", "opponent"]) test(`2号2人は互いだけに陽気を与え、1人になると自身への付与を失う ${side}`, async ({page}) => {
  const r = await page.evaluate(side => {
    const p = state.players[side];
    const cards = [0,1].map(i=>p.board.seats[i]=makeBoardCard(createCardFromBase("acting_out_man_2",side)));
    const mutual = cards.map(c=>hasKeyword(c,"陽気"));
    p.board.seats[1] = null;
    return {mutual,alone:hasKeyword(cards[0],"陽気"),details:battleCardGrantedKeywordEntries(cards[0])};
  },side);
  expect(r).toEqual({mutual:[true,true],alone:false,details:[]});
});

test("学生の反撃・終了時効果・複数回の1ダメージも軽減する", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const woman = makeBoardCard(createCardFromBase("acting_out_woman", "player"));
    const ally = makeBoardCard(createCardFromBase("strong_student", "player"));
    const enemy = makeBoardCard(createCardFromBase("where_bone", "opponent"));
    state.players.player.board.seats[0] = woman;
    state.players.player.board.seats[1] = ally;
    state.players.player.board.seats[2] = makeBoardCard(createCardFromBase("acting_out_man_2", "player"));
    state.players.opponent.board.seats[0] = enemy;
    enemy.attack = 3;
    const counter = aiAttackCounterDamage(ally, enemy);
    await resolveHorseEndTurn("opponent", enemy);
    const lifeAfterEnd = state.players.player.life;
    dealDistributedDamageToRandomTargets({ source: enemy, targetSide: "player", hitCount: 9, includeLife: true });
    return { counter, lifeAfterEnd, life: state.players.player.life, ally: ally.currentHp, woman: woman.currentHp };
  });
  expect(result).toEqual({ counter: 1, lifeAfterEnd: 9, life: 9, ally: 7, woman: 3 });
});

test("アカデミックムーブは設置前に遡らず、各ターン両者で最初の1人だけに適用する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const add = (side, index) => {
      const card = makeBoardCard(createCardFromBase("general_student", side));
      attendCard(side, card, "seat", index, { attendanceSource: ATTENDANCE_SOURCE.GENERATED });
      return card;
    };
    const earlier = add("player", 0);
    const env = createCardFromBase("academic_move", "player");
    attendCard("player", env, "environment", null, { attendanceSource: ATTENDANCE_SOURCE.HAND });
    const first = add("player", 1);
    const second = add("player", 2);
    const otherSameTurn = add("opponent", 0);
    const firstFlags = [earlier, first, second, otherSameTurn].map(c => Boolean(c.academicMoveMarked));
    const snapshotTurn = onlineCreateSnapshot().state.environment.academicMoveLastAttendanceTurn;
    resolveStudentEndTurnEffects("player");
    state.actionTurn += 1;
    state.currentSide = "opponent";
    const nextTurn = add("opponent", 1);
    const nextSecond = add("opponent", 2);
    const flags = [...firstFlags, ...[nextTurn, nextSecond].map(c => Boolean(c.academicMoveMarked))];
    // Once granted, the end-of-turn removal remains even if the environment leaves.
    state.environment = null;
    resolveStudentEndTurnEffects("opponent");
    return { flags,
      removed: [first, nextTurn].map(c => state.players[c.owner].trash.some(t => t.instanceId === c.instanceId)),
      snapshotTurn, remaining: [earlier, second, otherSameTurn, nextSecond].every(c => isCardCurrentlyOnBoard(c)) };
  });
  expect(result).toEqual({ flags: [false, true, false, false, true, false], removed: [true, true], snapshotTurn: 8, remaining: true });
});

test("ウーマンの軽減をAIの本体攻撃判断・予測とオンラインの視点変換に反映する", async ({ page }) => {
  const result = await page.evaluate(() => {
    state.currentSide = "opponent";
    const woman = makeBoardCard(createCardFromBase("acting_out_woman", "player"));
    state.players.player.board.seats[0] = woman;
    state.players.player.board.seats[1] = makeBoardCard(createCardFromBase("acting_out_man_2", "player"));
    const attacker = makeBoardCard(createCardFromBase("general_student", "opponent"));
    attacker.playedOnTurn = 1;
    state.players.opponent.board.seats[0] = attacker;
    const shouldAttack = aiShouldAttackLife("opponent", attacker);
    const forecast = aiBoardFaceDamage("opponent").guaranteed;
    const guest = onlineSwapOwnersDeep(onlineCreateSnapshot().state.players.player.board.seats[0]);
    state.players.opponent.board.seats[1] = makeBoardCard(guest);
    state.players.opponent.board.seats[2] = makeBoardCard(createCardFromBase("acting_out_man_2", "opponent"));
    const guestProtects = previewFinalDamageToLife("opponent", 3, makeBoardCard(createCardFromBase("general_student", "player")));
    return { shouldAttack, forecast, guestProtects };
  });
  expect(result).toEqual({ shouldAttack: false, forecast: 0, guestProtects: 1 });
});
