const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("確定したカードテキストが表示データに反映されている", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const expectedTexts = [
    "このカードは2行2列にのみ出席できる。このカードを手札から出席させたとき、自分の2行1列と2行3列の空いている席マスに、「席取り軍団」を1人ずつ出席させる。",
    "このカードを手札から出席させたとき、自分の手札をすべてデッキに戻してシャッフルする。その後、デッキを上から7枚まで引く。",
    "このカードが出席したとき、自分のデッキから「グリーンカレー」1枚を手札に加える。環境が「食堂」であるかぎり、このカードの攻撃力を+1、体力を+1し、陽気を与える。",
    "相手の手札を見る。",
    "相手プレイヤーに効果の了承を得る。了承を得た場合、お互いは自身のデッキから好きなカードを5枚選び校外に送る。以降の5ターンはお互いドローの代わりに、校外に送った5枚の中から選んで1枚を手札に加える。拒否された場合、戦意を2回復する。",
    "自分の戦意最大値を+2する。その後、自分の戦意最大値が10なら、自分のデッキから1枚引く。",
    "自分の講義室のマスが4つ以上埋まっているなら使用できる。自分の気力を埋まっているマスの数だけ回復する。その後、自分の講義室の学生すべてに1ダメージ。",
    "お互いの講義室にいる出席者数が同じ場合のみ使用できる。お互いの講義室にいる出席者を対応するマスごと入れ替える。",
    "自分の講義室の1行目の学生2人を指名する。それらは「注目」を持ち、体力を+2する。",
    "自分の気力が10以下の時のみ使用できる。自分の気力に3ダメージ、相手の気力に5ダメージを与える。",
    "相手の手札を見て、その中の「持ち物」を2枚まで選んで校外に送る。",
    "「U太」をデッキからを1枚手札に加え、1枚手札に生成する。その後、手札にある「U太」の戦意を-1する。",
    "お互いの講義室から「南京錠」を装備している出席者1人を指名し、その「南京錠」を校外へ送る。",
    "お互いのプレイヤーは、自分のターン終了時、自分の講義室にいるヴァンパイアすべての体力を1回復する。ヴァンパイアの効果を処理する際、環境を「食堂」としても扱う。このカードが他の環境に上書きされた後も、2ターンの間、この効果は継続する。",
    "自分のデッキからヴァンパイアをランダムに2枚まで手札に加える。",
    "装備カード。「U太」または「裏U太」1人に装備できる。自分のターン終了時、このカードを装備している出席者が自分の講義室にいるなら、カードを1枚引く。装備カードは通常、1人につき1枚まで。",
    "遅刻ゾーンにいるカード1枚をランダムに選び、そのカードの遅刻カウントを0にする。",
    "各プレイヤーは自分のターンに1回、戦意を3使って、自分の講義室の「デザイン」と名のつく教師1人を指名し、校外へ送ってもよい。そうした場合、自分の校外にある進化前の「デザイン」と名のつく教師1人を選び、同じマスに出席させる。この出席は手札から出席させたものとして扱う。"
  ];

  expectedTexts.forEach((text) => expect(source).toContain(text));
});

test("保留カード確認後の文章と処理が確定仕様に一致する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;

    function resetBattle() {
      state.phase = "battle";
      state.currentSide = "player";
      state.gameOver = false;
      state.aiThinking = false;
      state.actionTurn = 1;
      state.pendingCardPlay = null;
      state.pendingRaptorTemple = null;
      state.environment = null;
      ["player", "opponent"].forEach((side) => {
        const player = state.players[side];
        player.life = 20;
        player.maxWill = 10;
        player.will = 10;
        player.turnsTaken = 1;
        player.hand = [];
        player.deck = [];
        player.trash = [];
        player.late = [];
        player.board.seats = Array(9).fill(null);
        player.board.teacher = null;
      });
    }

    const card = (baseId, owner = "player") => api.createCardFromBase(baseId, owner);
    const attendee = (baseId, owner = "player") => api.makeBoardCard(card(baseId, owner));
    const checks = {};

    resetBattle();
    state.players.player.board.seats[3] = attendee("general_student");
    const seatGroup = card("seat_taking_group");
    checks.seatGroupOnlyNeedsCenterSeat = api.canPlaceCard("player", seatGroup, "seat", "player", 4);
    checks.seatGroupStillRejectsOtherSeat = !api.canPlaceCard("player", seatGroup, "seat", "player", 0);

    resetBattle();
    const handSeatGroup = attendee("seat_taking_group");
    api.attendCard("player", handSeatGroup, "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    checks.seatGroupHandAttendanceCreatesCopies = [3, 4, 5]
      .every((index) => state.players.player.board.seats[index]?.baseId === "seat_taking_group");

    resetBattle();
    const effectSeatGroup = attendee("seat_taking_group");
    api.attendCard("player", effectSeatGroup, "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    checks.seatGroupEffectAttendanceDoesNotCreateCopies = state.players.player.board.seats[3] === null
      && state.players.player.board.seats[5] === null;

    const smokeResults = {};
    [7, 8, 9, 10].forEach((maxWill) => {
      resetBattle();
      const smoke = card("smoke_flare");
      state.players.player.maxWill = maxWill;
      state.players.player.will = 10;
      state.players.player.hand = [smoke];
      state.players.player.deck = [card("general_student")];
      api.castImmediateItem("player", smoke, false);
      smokeResults[maxWill] = {
        maxWill: state.players.player.maxWill,
        handCount: state.players.player.hand.length
      };
    });
    checks.smokeFlareCapsAtTen = Object.values(smokeResults).every((entry) => entry.maxWill <= 10);
    checks.smokeFlareDrawsOnlyAtTen = smokeResults[7].handCount === 0
      && smokeResults[8].handCount === 1
      && smokeResults[9].handCount === 1
      && smokeResults[10].handCount === 1;

    resetBattle();
    const laughterAtThree = card("big_laughter");
    state.players.player.hand = [laughterAtThree];
    [0, 1, 2].forEach((index) => { state.players.player.board.seats[index] = attendee("general_student"); });
    checks.bigLaughterBlockedAtThreeSlots = !api.canUseHandCardNow(laughterAtThree);

    resetBattle();
    state.players.player.life = 10;
    const multiSeatStudent = attendee("loud_members");
    api.attendCard("player", multiSeatStudent, "seat", 0, {
      attendanceSource: api.ATTENDANCE_SOURCE.EFFECT,
      skipLocalAttendEffects: true
    });
    const laughterAtFour = card("big_laughter");
    state.players.player.hand = [laughterAtFour];
    checks.bigLaughterUsableAtFourSlots = api.canUseHandCardNow(laughterAtFour);
    checks.bigLaughterResolved = api.castImmediateItem("player", laughterAtFour, false);
    checks.bigLaughterHealsByOccupiedSlots = state.players.player.life === 14;
    checks.bigLaughterDamagesMultiSeatAttendeeOnce = multiSeatStudent.currentHp === 3;

    resetBattle();
    state.players.player.life = 10;
    [0, 1, 2, 3, 4].forEach((index) => { state.players.player.board.seats[index] = attendee("general_student"); });
    const laughterAtFive = card("big_laughter");
    state.players.player.hand = [laughterAtFive];
    checks.bigLaughterHealsByFiveOccupiedSlots = api.castImmediateItem("player", laughterAtFive, false)
      && state.players.player.life === 15;

    resetBattle();
    state.environment = card("raptor_temple");
    state.players.player.will = 2;
    const lowWillSource = attendee("popular_c");
    const lowWillTarget = card("lightning_n");
    state.players.player.board.teacher = lowWillSource;
    state.players.player.trash = [lowWillTarget];
    checks.raptorTempleBlockedBelowThree = !api.resolveRaptorTempleExchange(
      "player",
      { owner: "player", zone: "teacher", index: null },
      lowWillTarget.instanceId,
      false
    ) && state.players.player.board.teacher?.instanceId === lowWillSource.instanceId;

    resetBattle();
    state.environment = card("raptor_temple");
    state.players.player.will = 3;
    const source = attendee("popular_c");
    const target = card("lightning_n");
    state.players.player.board.teacher = source;
    state.players.player.trash = [target];
    checks.raptorTempleResolved = api.resolveRaptorTempleExchange(
      "player",
      { owner: "player", zone: "teacher", index: null },
      target.instanceId,
      false
    );
    checks.raptorTempleSpentThreeWill = state.players.player.will === 0;
    checks.raptorTempleKeptSameSlot = state.players.player.board.teacher?.baseId === "lightning_n";
    checks.raptorTempleCountsAsHandAttendance = state.players.player.board.teacher?.lastAttendanceSource
      === api.ATTENDANCE_SOURCE.HAND;
    checks.raptorTempleTriggersHandAttendanceEffect = state.players.player.hand
      .some((handCard) => handCard.baseId === "ruler");
    checks.raptorTempleOncePerTurn = !api.resolveRaptorTempleExchange(
      "player",
      { owner: "player", zone: "teacher", index: null },
      source.instanceId,
      false
    );

    return checks;
  });

  Object.entries(result).forEach(([name, passed]) => {
    expect(passed, name).toBe(true);
  });
});
