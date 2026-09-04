const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("プロテインドリンカーは攻撃力0で出席し自分のターン終了時に1ずつ上がる", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.phase = "battle";
    state.currentSide = "player";
    state.actionTurn = 2;
    state.environment = null;
    for (const side of ["player", "opponent"]) {
      state.players[side].board.seats = Array(9).fill(null);
      state.players[side].board.teacher = null;
    }
    const hand = api.createCardFromBase("protein_drinker", "player");
    const card = api.makeBoardCard(hand);
    state.players.player.board.seats[0] = card;
    api.applyBoardAuras();
    const attacks = [hand.attack, card.attack];
    api.resolveStudentEndTurnEffects("opponent");
    api.applyBoardAuras();
    attacks.push(card.attack);
    for (let i = 0; i < 2; i++) {
      api.resolveStudentEndTurnEffects("player");
      api.applyBoardAuras();
      attacks.push(card.attack);
    }
    return { attacks, cost: hand.cost, hp: hand.hp, rules: api.cardRulesText(hand) };
  });
  expect(result).toEqual({ attacks: [0, 0, 0, 1, 2], cost: 4, hp: 7, rules: "自分のターン終了時、このカードの攻撃力を+1する。" });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.22.1" }) });
  await entry.locator("summary").click();
  const change = entry.locator(".update-change").filter({ hasText: "プロテインドリンカーの攻撃力変更" });
  await expect(change.locator(".update-before")).toContainText("戦意4／攻撃力1／体力7");
  await expect(change.locator(".update-after")).toContainText("戦意4／攻撃力0／体力7");
});

test("確定したカードテキストが表示データに反映されている", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const expectedTexts = [
    "このカードは2行2列にのみ出席できる。このカードを手札から出席させたとき、自分の2行1列と2行3列の空いている席マスに、「席取り軍団」を1人ずつ出席させる。",
    "このカードを手札から出席させたとき、自分の手札をすべてデッキに戻してシャッフルする。その後、デッキを上から7枚まで引く。",
    "このカードが出席したとき、自分のデッキから「グリーンカレー」1枚を手札に加える。環境が「食堂」であるかぎり、このカードの攻撃力を+1、体力を+1し、陽気を与える。",
    "相手の手札を見る。",
    "「アグロ大学生」「アグロキング」「アグロクイーン」を1枚ずつ手札に生成する。",
    "相手の講義室に出席者がいないなら、これは「超陽気」を持つ。",
    "このカードは自分の2行目の席マスにのみ出席できる。このカードを手札から出席させたとき、自分の2行目の空いている席マスすべてに、「TA」を1人ずつ出席させる。",
    "このカードは相手本体に攻撃することはできない。このカードが相手の出席者を攻撃し、校外に送った場合、その出席者のいた位置に「幸せの青い鳥」を出席させる。自分のターン終了時、このカードが攻撃可能ならば、ランダムな相手の出席者を1人指名して攻撃する。",
    "このカードの戦意は、この対戦中にお互いの講義室へ出た「スーツを着た学生」1人につき-1される。このカードは教師からダメージを受けない。",
    "お互いの講義室にいる学生1人を指名する。その出席者を「スーツを着た学生」にする。",
    "お互いのプレイヤーがそれぞれ2回ターンを終了するまで、お互いのプレイヤーは、自分のターン終了時、自分の講義室にいる「スーツを着た学生」ではない学生1人をランダムに指名し、「スーツを着た学生」にする。",
    "3つの効果から1つを選んで使用する。自分の戦意が8以上のときに使用する場合、このカードの戦意は8になり、3つすべての効果を番号順に使用する。",
    "このカード以外の自分の手札1枚を選んで校外エリアへ送る。その後、相手の講義室にいる出席者1人を指名し、破壊する。",
    "相手本体に4ダメージを与える。",
    "お互いのプレイヤーは、自分の講義室で新たにビンゴが成立したとき、成立したビンゴごとに以下の効果を発動する。",
    "8ビンゴを達成したとき（１回まで）、それを達成させた出席者の攻撃力と体力を+3し、カードを3枚引く。",
    "融合\\n「U太」に融合する。",
    "このカードを手札から出席させたとき、このゲームに勝利する。",
    "このカードがある限り、自分の最大戦意は3になる。ターン開始時、自分の講義室に出席している全ての出席者の体力は相手の最大戦意の差だけ上がる。",
    "遅刻3。このカードが自分の講義室から校外エリアへ送られたとき、相手の講義室にいる教師1人をランダムに指名し、破壊する。",
    "このカードを手札から出席させたとき、お互いの講義室にいる遅刻を持つ学生すべてを破壊する。その後、お互いの遅刻ゾーンにいる学生すべてを校外エリアへ送る。",
    "相手プレイヤーに効果の了承を得る。了承を得た場合、お互いは自身のデッキから好きなカードを5枚、引く順番を決めて選ぶ。以降の5ターンはお互いドローの代わりに、選んだカードを選んだ順番で1枚ずつ手札に加える。拒否された場合、戦意を2回復する。",
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
  expect(source).toContain('think_so: { name: "思ってまう"');
  expect(source).not.toContain('think_so: { name: "って思ってまう"');
  expect(source).toContain('ta_squad: { name: "TA隊長"');
  expect(source).toContain('before: "「って思ってまう」\\n持ち物／学友会・持ち物／戦意1／エースぺ\\n');
  expect(source).toContain('after: "「思ってまう」\\n持ち物／学友会・持ち物／戦意1／エースぺ\\n');
  expect(source).toContain('after: "「アグロ軍」\\n持ち物／共通カード／戦意2\\n');
  expect(source).toContain('after: "「斥候学生」\\n学生／展開・敵増殖／戦意2／攻撃力2／体力1\\n');
  expect(source).toContain('after: "「TA軍団」\\n学生／展開・敵増殖／戦意4／攻撃力2／体力1\\n');
  expect(source).toContain('after: "「幸せの青い鳥」\\n学生／共通カード／戦意2／攻撃力5／体力5\\n');
  expect(source).toContain('after: "「スーツを着た学生」\\n学生／展開・敵増殖／戦意8／攻撃力1／体力1\\n');
  expect(source).toContain('after: "「胸像スーツ」\\n持ち物／展開・敵増殖／戦意1\\n');
  expect(source).toContain('after: "「インターン」\\n持ち物／展開・敵増殖／戦意2\\n');
  expect(source).toContain('after: "「キングギドラベッド」\\n持ち物／共通カード／戦意4\\n');
  expect(source).toContain('after: "「早押しクイズ大会」\\n環境／共通カード／戦意1\\n');
  expect(source).toContain('after: "「来てなかった学生」\\n学生／遅刻／戦意2／攻撃力2／体力2\\n');
  expect(source).toContain('after: "「遅刻に厳しい教師」\\n教師／共通カード／戦意4／攻撃力1／体力1\\n');
  expect(source).toContain('after: "「辛いなら」\\n持ち物／学友会・持ち物／戦意0\\n融合\\n「U太」に融合する。"');
  expect(source).toContain('after: "「会社１日」\\n持ち物／学友会・持ち物／戦意0\\n融合\\n「U太」に融合する。"');
  expect(source).toContain('after: "「飛ぶくらい」\\n持ち物／学友会・持ち物／戦意0\\n融合\\n「U太」に融合する。"');
  expect(source).toContain('after: "「いいだろって」\\n持ち物／学友会・持ち物／戦意0\\n融合\\n「U太」に融合する。"');
  expect(source).toContain('after: "「Ultimate U太」\\n学生／学友会・持ち物／戦意なし／攻撃力13／体力13\\n');
  expect(source).not.toContain('融合：「U太」「辛いなら」「会社１日」「飛ぶくらい」「いいだろって」。');
  expect(source).toContain('このカードは教師からダメージを受けない。\\n出席数：X人"');
});

test("更新情報のカード追加・修正をカード名、ステータス、テキストの順で表示する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const latestEntry = page.locator(".update-entry", { hasText: "ver.0.20.0" }).first();
  await latestEntry.locator("summary").click();

  const bustSuit = latestEntry.locator(".update-after", { hasText: "胸像スーツ" });
  await expect(bustSuit).toHaveCSS("white-space", "pre-line");
  await expect(bustSuit).toContainText("「胸像スーツ」\n持ち物／展開・敵増殖／戦意1\nお互いの講義室にいる学生1人");

  const intern = latestEntry.locator(".update-after", { hasText: "インターン" });
  await expect(intern).toContainText("「インターン」\n持ち物／展開・敵増殖／戦意2\nお互いのプレイヤーがそれぞれ2回ターンを終了するまで");

  const kingGhidorahBed = latestEntry.locator(".update-after", { hasText: "キングギドラベッド" });
  await expect(kingGhidorahBed).toContainText("「キングギドラベッド」\n持ち物／共通カード／戦意4\n3つの効果から1つを選んで使用する");
  await expect(kingGhidorahBed).toContainText("相手本体に4ダメージを与える。");

  const quickQuizTournament = latestEntry.locator(".update-after", { hasText: "早押しクイズ大会" });
  await expect(quickQuizTournament).toContainText("「早押しクイズ大会」\n環境／共通カード／戦意1\nお互いのプレイヤーは、自分の講義室で新たにビンゴが成立したとき");
  await expect(quickQuizTournament).toContainText("8ビンゴを達成したとき");
  await expect(quickQuizTournament).toContainText("（１回まで）");

  const fusionMaterial = latestEntry.locator(".update-after", { hasText: "辛いなら" }).first();
  await expect(fusionMaterial).toContainText("「辛いなら」\n持ち物／学友会・持ち物／戦意0\n融合\n「U太」に融合する。");

  const ultimateYuta = latestEntry.locator(".update-after", { hasText: "Ultimate U太" }).first();
  await expect(ultimateYuta).toContainText("「Ultimate U太」\n学生／学友会・持ち物／戦意なし／攻撃力13／体力13\nこのカードを手札から出席させたとき、このゲームに勝利する。");

  const quickQuizVisuals = latestEntry.locator(".update-change", { hasText: "早押しクイズ大会の演出" });
  await expect(quickQuizVisuals.locator(".update-after")).toContainText("赤いバフ演出");
  await expect(quickQuizVisuals.locator(".update-after")).toContainText("大表示が終了した後");
  await expect(quickQuizVisuals.locator(".update-after")).toContainText("カチッ");
  await expect(quickQuizVisuals.locator(".update-after")).toContainText("BINGO!!");

  const ultimateVisuals = latestEntry.locator(".update-change", { hasText: "U太の融合と勝利演出" });
  await expect(ultimateVisuals.locator(".update-after")).toContainText("「辛いなら」を中央、「会社１日」を左、「飛ぶくらい」を右、「いいだろって」を中央");
  await expect(ultimateVisuals.locator(".update-after")).toContainText("画面左から「思ってまう」「いいだろって」「飛ぶくらい」「会社１日」「辛いなら」");
  await expect(ultimateVisuals.locator(".update-after")).toContainText("「飛ぶくらい」を画面中央");
  await expect(ultimateVisuals.locator(".update-after")).toContainText("改行せず縦表示");

  const aggroArmy = latestEntry.locator(".update-after", { hasText: "アグロ軍" });
  await expect(aggroArmy).toHaveCSS("white-space", "pre-line");
  await expect(aggroArmy).toContainText("「アグロ軍」\n持ち物／共通カード／戦意2\n「アグロ大学生」");

  const scoutStudent = latestEntry.locator(".update-after", { hasText: "斥候学生" });
  await expect(scoutStudent).toContainText("「斥候学生」\n学生／展開・敵増殖／戦意2／攻撃力2／体力1\n相手の講義室");

  const taSquad = latestEntry.locator(".update-after", { hasText: "TA軍団" });
  await expect(taSquad).toContainText("「TA軍団」\n学生／展開・敵増殖／戦意4／攻撃力2／体力1\nこのカードは自分の2行目");

  const happyBlueBird = latestEntry.locator(".update-after", { hasText: "幸せの青い鳥" });
  await expect(happyBlueBird).toContainText("「幸せの青い鳥」\n学生／共通カード／戦意2／攻撃力5／体力5\nこのカードは相手本体");

  const suitStudent = latestEntry.locator(".update-after", { hasText: "学生／展開・敵増殖／戦意8／攻撃力1／体力1" });
  await expect(suitStudent).toContainText("「スーツを着た学生」\n学生／展開・敵増殖／戦意8／攻撃力1／体力1\nこのカードの戦意");
  await expect(suitStudent).toContainText("出席数：X人");

  const cardChange = latestEntry.locator(".update-change", { hasText: "変更点：カード名から「って」を削除。" });
  await expect(cardChange.locator(".update-before")).toContainText("「って思ってまう」\n持ち物／学友会・持ち物／戦意1／エースぺ");
  await expect(cardChange.locator(".update-after")).toContainText("「思ってまう」\n持ち物／学友会・持ち物／戦意1／エースぺ");
});

test("戦意0と戦意なしを表示上で区別する", async ({ page }) => {
  await page.goto(gameUrl);

  await page.evaluate(() => {
    window.__chibattle.startCardTest("tsurai_nara");
  });

  const zeroCostCard = page.locator('.player-hand .hand-card[data-base-id="tsurai_nara"]');
  await expect(zeroCostCard).toBeVisible();
  await expect(zeroCostCard.locator(".card-header .stat-cost")).toHaveText("戦意0");
  await expect(zeroCostCard.locator(".card-header .stat-cost")).toHaveAttribute("aria-label", "戦意0");

  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const latestEntry = page.locator(".update-entry", { hasText: "ver.0.20.1" }).first();
  await expect(latestEntry.locator("summary")).toContainText("ver.0.20.1");
  await latestEntry.locator("summary").click();
  await expect(latestEntry.locator(".update-change", { hasText: "戦意0の表示" })).toContainText("戦意を持たないカードだけは引き続き「戦意なし」");
  const fusionChoiceUpdate = latestEntry.locator(".update-change", { hasText: "融合先の選択" });
  await expect(fusionChoiceUpdate).toContainText("カード確認に「融合する」ボタン");
  await expect(fusionChoiceUpdate).toContainText("融合できるU太だけを表示");
  await expect(fusionChoiceUpdate).toContainText("融合済み：○○");
  await expect(fusionChoiceUpdate).toContainText("融合済み：なし");
  const fusionOrderUpdate = latestEntry.locator(".update-change", { hasText: "U太の融合表示順" });
  await expect(fusionOrderUpdate).toContainText("カード名を1枚ずつ改行して表示・記録");
  await expect(fusionOrderUpdate).toContainText("番号と「、」は表示しない");
  const rulerFusionUpdate = latestEntry.locator(".update-change", { hasText: "定規の融合" });
  await expect(rulerFusionUpdate).toContainText("ほかの定規だけをマリガンと同じ形式で表示");
  await expect(rulerFusionUpdate).toContainText("今後追加する融合も、この対象選択方式へ統一");
});

test("Ultimate U太の筆文字風勝利演出を更新情報に記載する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();

  const latestEntry = page.locator(".update-entry", { hasText: "ver.0.20.2" }).first();
  await expect(latestEntry.locator("summary")).toContainText("ver.0.20.2");
  await expect(latestEntry.locator("summary")).toContainText("2026年8月30日");
  await latestEntry.locator("summary").click();

  const victoryUpdate = latestEntry.locator(".update-change", { hasText: "Ultimate U太の勝利演出" });
  await expect(victoryUpdate).toContainText("筆文字風の書体");
  await expect(victoryUpdate).toContainText("辛いなら");
  await expect(victoryUpdate).toContainText("会社１日");
  await expect(victoryUpdate).toContainText("飛ぶくらい");
  await expect(victoryUpdate).toContainText("いいだろって");
  await expect(victoryUpdate).toContainText("思ってまう");
  await expect(victoryUpdate).toContainText("表示する文言・順番・位置・時間は変更しない");
});

test("指名破壊の確定操作をver.0.20.3の更新情報に記載する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();

  const latestEntry = page.locator(".update-entry", { hasText: "ver.0.20.3" }).first();
  await expect(latestEntry.locator("summary")).toContainText("ver.0.20.3");
  await expect(latestEntry.locator("summary")).toContainText("2026年8月31日");
  await latestEntry.locator("summary").click();

  const destroyUpdate = latestEntry.locator(".update-change", { hasText: "指名して破壊する操作" });
  await expect(destroyUpdate.locator(".update-before")).toContainText("対象を指名した時点ですぐに破壊");
  await expect(destroyUpdate.locator(".update-after")).toContainText("ターン終了ボタンの位置に「破壊する」ボタン");
  await expect(destroyUpdate.locator(".update-after")).toContainText("押した時に初めて効果を実行");
  await expect(destroyUpdate.locator(".update-after")).toContainText("オンライン対戦でも確定後に対象を送信");
});

test("デザイン教師の出席時効果は手札から出席させたときだけ発動する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;

    function resetBoard() {
      ["player", "opponent"].forEach((side) => {
        state.players[side].board.teacher = null;
        state.players[side].board.seats = Array(9).fill(null);
        state.players[side].hand = [];
        state.players[side].deck = [];
        state.players[side].trash = [];
      });
    }

    function attendee(baseId, owner = "player") {
      return api.makeBoardCard(api.createCardFromBase(baseId, owner));
    }

    const texts = Object.fromEntries(
      ["lightning_n", "fairy_t", "popular_c", "bird_a"].map((baseId) => [
        baseId,
        api.cardRulesText(api.createCardFromBase(baseId, "player"))
      ])
    );

    resetBoard();
    api.attendCard("player", attendee("lightning_n"), "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.EFFECT
    });
    const lightningEffectSourceDidNotTrigger = state.players.player.hand.length === 0;

    resetBoard();
    state.players.player.deck = [api.createCardFromBase("ruler", "player")];
    api.attendCard("player", attendee("lightning_n"), "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.HAND
    });
    const lightningHandSourceTriggered = state.players.player.hand.filter((card) => card.baseId === "ruler").length === 2;

    resetBoard();
    state.players.opponent.board.seats[6] = attendee("general_student", "opponent");
    api.attendCard("player", attendee("fairy_t"), "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.EFFECT
    });
    const fairyEffectSourceDidNotTrigger = state.players.opponent.board.seats[6]?.baseId === "general_student";

    resetBoard();
    state.players.opponent.board.seats[6] = attendee("general_student", "opponent");
    api.attendCard("player", attendee("fairy_t"), "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.HAND
    });
    const fairyHandSourceTriggered = state.players.opponent.board.seats[0]?.baseId === "general_student"
      && state.players.opponent.board.seats[6] === null;

    resetBoard();
    api.attendCard("player", attendee("popular_c"), "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.EFFECT
    });
    const slenderEffectSourceDidNotTrigger = state.players.player.board.seats[0] === null;

    resetBoard();
    api.attendCard("player", attendee("popular_c"), "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.HAND
    });
    const slenderHandSourceTriggered = state.players.player.board.seats[0]?.baseId === "fairy_t";

    resetBoard();
    const effectTarget = attendee("general_student", "opponent");
    state.players.opponent.board.seats[0] = effectTarget;
    api.attendCard("player", attendee("bird_a"), "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.EFFECT
    });
    const falconEffectSourceDidNotTrigger = effectTarget.currentHp === 2;

    resetBoard();
    const handTarget = attendee("general_student", "opponent");
    state.players.opponent.board.seats[0] = handTarget;
    api.attendCard("player", attendee("bird_a"), "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.HAND
    });
    const falconHandSourceTriggered = handTarget.currentHp === 0;

    return {
      texts,
      lightningEffectSourceDidNotTrigger,
      lightningHandSourceTriggered,
      fairyEffectSourceDidNotTrigger,
      fairyHandSourceTriggered,
      slenderEffectSourceDidNotTrigger,
      slenderHandSourceTriggered,
      falconEffectSourceDidNotTrigger,
      falconHandSourceTriggered
    };
  });

  expect(result.texts.lightning_n).toContain("このカードを手札から出席させたとき");
  expect(result.texts.lightning_n).toContain("このカードを手札から教卓マスに出席させたとき");
  expect(result.texts.fairy_t).toContain("このカードを手札から教卓マスに出席させたとき");
  expect(result.texts.popular_c).toContain("このカードを手札から教卓マスに出席させたとき");
  expect(result.texts.bird_a).toContain("このカードを手札から教卓マスに出席させたとき");
  expect(result.texts.bird_a).toContain("このカードを手札から席マスに出席させたとき");
  Object.entries(result)
    .filter(([name]) => name !== "texts")
    .forEach(([name, passed]) => expect(passed, name).toBe(true));
});

test("デザイン教師4枚の修正をver.0.20.4の更新情報に記載する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();

  const latestEntry = page.locator(".update-entry", { hasText: "ver.0.20.4" }).first();
  await expect(latestEntry.locator("summary")).toContainText("ver.0.20.4");
  await expect(latestEntry.locator("summary")).toContainText("2026年9月1日");
  await latestEntry.locator("summary").click();

  const names = [
    "デザインデーモンスレイヤー",
    "デザインフェアリー",
    "デザインスレンダーウーマン",
    "デザインファルコン"
  ];
  for (const [index, name] of names.entries()) {
    const change = latestEntry.locator(".update-change").nth(index);
    await expect(change.locator(".update-before")).toContainText(`「${name}」\n教師／デザイン／戦意`);
    await expect(change.locator(".update-after")).toContainText(`「${name}」\n教師／デザイン／戦意`);
    await expect(change.locator(".update-after")).toContainText("手札から");
    await expect(change.locator(".update-after")).toContainText("変更点：出席時効果を、手札から出席させた場合にのみ発動するよう変更。");
  }
});

test("パッドプレゼンクリエイターは最大戦意を制限し、ダメージを引き継いで体力を上げる", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;

    function resetBattle() {
      state.screen = "battle";
      state.phase = "battle";
      state.currentSide = "player";
      state.actionTurn = 8;
      state.gameOver = false;
      state.courseRegistration = null;
      state.environment = null;
      ["player", "opponent"].forEach((side) => {
        const player = state.players[side];
        player.board.teacher = null;
        player.board.seats = Array(9).fill(null);
        player.hand = [];
        player.deck = [
          api.createCardFromBase("general_student", side),
          api.createCardFromBase("general_student", side),
          api.createCardFromBase("general_student", side)
        ];
        player.trash = [];
        player.late = [];
        player.padPresentNaturalMaxWill = null;
      });
      state.players.player.maxWill = 7;
      state.players.player.will = 7;
      state.players.opponent.maxWill = 10;
      state.players.opponent.will = 10;
    }

    resetBattle();
    const creator = api.createCardFromBase("pad_present_creator", "player");
    state.players.player.hand = [creator];
    const damagedAttendee = api.makeBoardCard(api.createCardFromBase("loud_student", "player"));
    damagedAttendee.currentHp = 6;
    state.players.player.board.seats[1] = damagedAttendee;
    const placed = api.placeCardFromHand("player", creator.instanceId, "seat", "player", 0, false);
    const cappedOnAttendance = state.players.player.maxWill === 3
      && state.players.player.will === 3
      && state.players.player.padPresentNaturalMaxWill === 7;

    api.startTurn("player");
    const creatorOnBoard = state.players.player.board.seats[0];
    const buffedByDifference = creatorOnBoard.maxHp === 8 && creatorOnBoard.currentHp === 8;
    const damageCarriedOver = damagedAttendee.maxHp === 16
      && damagedAttendee.currentHp === 13
      && damagedAttendee.maxHp - damagedAttendee.currentHp === 3;
    const stayedCappedAtTurnStart = state.players.player.maxWill === 3
      && state.players.player.will === 3
      && state.players.player.padPresentNaturalMaxWill === 8;

    resetBattle();
    const leavingCreator = api.createCardFromBase("pad_present_creator", "player");
    state.players.player.hand = [leavingCreator];
    api.placeCardFromHand("player", leavingCreator.instanceId, "seat", "player", 0, false);
    state.players.player.board.seats[0] = null;
    const remainedCappedUntilNextTurn = state.players.player.maxWill === 3;
    api.startTurn("player");
    const restoredNaturalProgression = state.players.player.maxWill === 8
      && state.players.player.will === 8
      && state.players.player.padPresentNaturalMaxWill === null;

    return {
      placed,
      cappedOnAttendance,
      buffedByDifference,
      damageCarriedOver,
      stayedCappedAtTurnStart,
      remainedCappedUntilNextTurn,
      restoredNaturalProgression,
      category: api.CARD_BASES.pad_present_creator.category,
      rules: api.cardRulesText(api.createCardFromBase("pad_present_creator", "player"))
    };
  });

  expect(result.placed).toBe(true);
  expect(result.cappedOnAttendance).toBe(true);
  expect(result.buffedByDifference).toBe(true);
  expect(result.damageCarriedOver).toBe(true);
  expect(result.stayedCappedAtTurnStart).toBe(true);
  expect(result.remainedCappedUntilNextTurn).toBe(true);
  expect(result.restoredNaturalProgression).toBe(true);
  expect(result.category).toBe("common");
  expect(result.rules).toContain("相手の最大戦意の差だけ上がる");
});

test("パッドプレゼンクリエイターをver.0.21.0の更新情報に新カード形式で記載する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();

  const versionEntry = page.locator(".update-entry", { hasText: "ver.0.21.0" }).first();
  await expect(versionEntry.locator("summary")).toContainText("ver.0.21.0");
  await expect(versionEntry.locator("summary")).toContainText("2026年9月2日");
  await versionEntry.locator("summary").click();

  const newCard = versionEntry.locator(".update-after", { hasText: "パッドプレゼンクリエイター" });
  await expect(newCard).toContainText("「パッドプレゼンクリエイター」\n学生／共通カード／戦意3／攻撃力1／体力1");
  await expect(newCard).toContainText("このカードがある限り");
  await expect(newCard).toContainText("相手の最大戦意の差だけ上がる");
});

test("アグロキングダムは両者のアグロ出席者へ常在の超陽気を与える", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.gameOver = false;
    state.players.player.will = 10;
    state.players.player.hand = [];
    state.players.player.board.seats = Array(9).fill(null);
    state.players.opponent.board.seats = Array(9).fill(null);

    const ownAggro = api.makeBoardCard(api.createCardFromBase("aggro_student", "player"));
    const enemyAggro = api.makeBoardCard(api.createCardFromBase("aggro_king", "opponent"));
    const ordinaryStudent = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    state.players.player.board.seats[0] = ownAggro;
    state.players.player.board.seats[1] = ordinaryStudent;
    state.players.opponent.board.seats[0] = enemyAggro;

    const beforePlacement = !api.hasKeyword(ownAggro, "超陽気")
      && !api.hasKeyword(enemyAggro, "超陽気");
    const environment = api.createCardFromBase("aggro_kingdom", "player");
    state.players.player.hand = [environment];
    const placed = api.placeCardFromHand("player", environment.instanceId, "environment", "player", null, false);
    const bothPlayersBuffed = api.hasKeyword(ownAggro, "超陽気")
      && api.hasKeyword(enemyAggro, "超陽気")
      && api.hasKeyword(ownAggro, "陽気");
    const nonAggroExcluded = !api.hasKeyword(ordinaryStudent, "超陽気")
      && !api.hasKeyword(api.createCardFromBase("aggro_army", "player"), "超陽気");
    const laterAggro = api.makeBoardCard(api.createCardFromBase("aggro_queen", "player"));
    state.players.player.board.seats[2] = laterAggro;
    const laterAttendanceBuffed = api.hasKeyword(laterAggro, "超陽気");
    state.environment = api.makeBoardCard(api.createCardFromBase("classroom", "player"));
    const removedWithEnvironment = !api.hasKeyword(ownAggro, "超陽気")
      && !api.hasKeyword(enemyAggro, "超陽気")
      && !api.hasKeyword(laterAggro, "超陽気");

    return {
      beforePlacement,
      placed,
      bothPlayersBuffed,
      nonAggroExcluded,
      laterAttendanceBuffed,
      removedWithEnvironment,
      name: api.CARD_BASES.aggro_kingdom.name,
      type: api.CARD_BASES.aggro_kingdom.type,
      cost: api.CARD_BASES.aggro_kingdom.cost,
      category: api.CARD_BASES.aggro_kingdom.category,
      common: api.SPECIALTY_CARD_IDS.common.includes("aggro_kingdom"),
      rules: api.cardRulesText(api.createCardFromBase("aggro_kingdom", "player"))
    };
  });

  expect(result).toEqual({
    beforePlacement: true,
    placed: true,
    bothPlayersBuffed: true,
    nonAggroExcluded: true,
    laterAttendanceBuffed: true,
    removedWithEnvironment: true,
    name: "アグロキングダム",
    type: "environment",
    cost: 2,
    category: "common",
    common: true,
    rules: "このカードが環境マスにあるかぎり、お互いの「アグロ」と名のつく出席者は超陽気を持つ。"
  });
});

test("9月3日の新カードをver.0.22.0の更新情報に統合して記載する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();

  const latestEntry = page.locator(".update-entry", { hasText: "ver.0.22.0" }).first();
  await expect(latestEntry.locator("summary")).toContainText("ver.0.22.0");
  await expect(latestEntry.locator("summary")).toContainText("2026年9月3日");
  await latestEntry.locator("summary").click();

  const newCard = latestEntry.locator(".update-after", { hasText: "アグロキングダム" });
  await expect(newCard).toContainText("「アグロキングダム」\n環境／共通カード／戦意2");
  await expect(newCard).toContainText("お互いの「アグロ」と名のつく出席者は超陽気を持つ");

  const absentStudent = latestEntry.locator(".update-after", { hasText: "来てなかった学生" });
  await expect(absentStudent).toContainText("「来てなかった学生」\n学生／遅刻／戦意2／攻撃力2／体力2");
  await expect(absentStudent).toContainText("自分の講義室から校外エリアへ送られたとき");

  const strictTeacher = latestEntry.locator(".update-after", { hasText: "遅刻に厳しい教師" });
  await expect(strictTeacher).toContainText("「遅刻に厳しい教師」\n教師／共通カード／戦意4／攻撃力1／体力1");
  await expect(strictTeacher).toContainText("その後、お互いの遅刻ゾーンにいる学生すべてを校外エリアへ送る");
  const orderedAttendance = latestEntry.locator(".update-change", { hasText: "効果による複数出席の処理順" });
  await expect(orderedAttendance).toContainText("1行1列から1行3列");
  await expect(orderedAttendance).toContainText("出席時効果・ビンゴの成立と強化対象は1人ごとに判定");
  await expect(orderedAttendance).toContainText("バフの適用と演出は全員の出席が終わってからまとめて行う");
});

test("声が大きい集団は自分の3行目の席マスにのみ出席できる", async ({ page }) => {
  await page.goto(gameUrl);
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.phase = "battle";
    state.gameOver = false;
    state.environment = null;
    state.temporarySeatBlocks = [];
    ["player", "opponent"].forEach((side) => {
      state.players[side].board.seats = Array(9).fill(null);
      state.players[side].board.teacher = null;
      state.players[side].late = [];
    });
    return ["player", "opponent"].map((side) => {
      const card = api.createCardFromBase("loud_group", side);
      return {
        seats: Array.from({ length: 9 }, (_, index) => api.canPlaceCard(side, card, "seat", side, index)),
        teacher: api.canPlaceCard(side, card, "teacher", side, null),
        otherSide: api.canPlaceCard(side, card, "seat", side === "player" ? "opponent" : "player", 6),
        rules: api.cardRulesText(card)
      };
    });
  });
  for (const result of results) {
    expect(result.seats).toEqual([false, false, false, false, false, false, true, true, true]);
    expect(result.teacher).toBe(false);
    expect(result.otherSide).toBe(false);
    expect(result.rules).toContain("このカードは自分の3行目の席マスにのみ出席できる。");
    expect(result.rules).not.toContain("3行目にも");
  }
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.22.0" }) });
  await entry.locator("summary").click();
  const change = entry.locator(".update-change").filter({ has: page.locator(".update-before", { hasText: "「声が大きい集団」" }) });
  await expect(change.locator(".update-before")).toContainText("3行目にも");
  await expect(change.locator(".update-after")).toContainText("自分の3行目の席マスにのみ");
});

test("斥候学生は相手の講義室が空の間だけ超陽気を持つ", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.players.player.board.seats = Array(9).fill(null);
    state.players.player.board.teacher = null;
    state.players.opponent.board.seats = Array(9).fill(null);
    state.players.opponent.board.teacher = null;

    const scout = api.makeBoardCard(api.createCardFromBase("scout_student", "player"));
    state.players.player.board.seats[0] = scout;
    const emptyClassroom = api.hasKeyword(scout, "超陽気") && api.hasKeyword(scout, "陽気");

    state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    const occupiedClassroom = !api.hasKeyword(scout, "超陽気");

    state.players.opponent.board.seats[0] = null;
    const emptyAgain = api.hasKeyword(scout, "超陽気");
    return { emptyClassroom, occupiedClassroom, emptyAgain };
  });

  expect(result).toEqual({ emptyClassroom: true, occupiedClassroom: true, emptyAgain: true });
});

test("保留カード確認後の文章と処理が確定仕様に一致する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const { state } = api;

    function resetBattle() {
      state.screen = "battle";
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
    await api.waitForOrderedAttendance();
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
