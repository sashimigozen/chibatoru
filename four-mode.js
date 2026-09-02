(function () {
  "use strict";

  const api = window.__chibattle;
  if (!api) return;

  const PLAYER_NAMES = ["プレイヤーA", "プレイヤーB", "プレイヤーC", "自分"];
  const POSITIONS = ["left", "top", "right", "bottom"];
  const GENERAL_CARDS = Object.fromEntries(["general_student", "general_teacher", "classroom"].map((baseId) => {
    const base = api.CARD_BASES[baseId];
    return [baseId, {
      name: base.name,
      type: base.type,
      cost: Number(base.cost) || 0,
      attack: Number(base.attack) || 0,
      hp: Number(base.hp) || 0
    }];
  }));
  const CATEGORY_WEIGHTS = [["attack", 40], ["debuff", 20], ["disruption", 10], ["selfBuff", 10], ["environment", 20]];
  const els = Object.fromEntries([
    "fourSetupScreen", "fourBattleScreen", "onlineFourMatchButton", "fourBackOnlineButton", "fourLocalHumanCount",
    "fourLocalStartButton", "fourRoomInput", "fourJoinButton", "fourCreateButton", "fourLeaveButton", "fourRoomCode",
    "fourOnlineRole", "fourOnlineStatus", "fourLobbySeats", "fourOnlineStartButton", "fourTurnBanner", "fourEnemyActionReveal",
    "fourSharedTrash", "fourSharedDeck", "fourEnemy", "fourEnvironment", "fourPassButton", "fourEndTurnButton", "fourWillText",
    "fourLogButton", "fourLogPanel", "fourLogCloseButton", "fourLogList", "fourBattleMenuButton", "fourMenuPanel",
    "fourMenuCloseButton", "fourQuitButton", "fourResultOverlay", "fourResultList", "fourResultBackButton"
  ].map((id) => [id, document.getElementById(id)]));

  function uid(prefix = "f") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function createCard(baseId, owner = -1) {
    const base = GENERAL_CARDS[baseId];
    return {
      id: uid(baseId), baseId, name: base.name, type: base.type, cost: base.cost,
      attack: base.attack, hp: base.hp, currentHp: base.hp, owner,
      hasAttacked: false, playedRound: 0, attackPenalty: 0, attackPenaltyUntilRound: 0,
      attackLockedUntilRound: 0, generated: false, copied: false
    };
  }

  function createFourPlayer(index, kind = "cpu", clientId = "") {
    return {
      index, name: PLAYER_NAMES[index], kind, clientId, life: 20, maxLife: 20,
      maxWill: 0, will: 0, points: 0, eliminated: false, hand: [],
      board: { seats: [null, null, null], teacher: null }, late: [],
      seatBlocks: [0, 0, 0], willPenaltyUntilRound: 0, acted: false
    };
  }

  function buildDeck() {
    const cards = [];
    for (let i = 0; i < 24; i += 1) cards.push(createCard("general_student"));
    for (let i = 0; i < 12; i += 1) cards.push(createCard("general_teacher"));
    for (let i = 0; i < 4; i += 1) cards.push(createCard("classroom"));
    return shuffle(cards);
  }

  function shuffle(values, random = Math.random) {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function initialState(humanCount = 1, options = {}) {
    const players = Array.from({ length: 4 }, (_, index) => {
      const isHuman = index >= 4 - humanCount;
      return createFourPlayer(index, isHuman ? "human" : "cpu", options.clientIds?.[index] || "");
    });
    const game = {
      version: 1, mode: "four", round: 1, activeIndex: 0, seq: 1,
      phase: "playing", enemy: { life: 60, maxLife: 60 },
      players, sharedDeck: buildDeck(), sharedTrash: [], environment: null,
      log: [], selectedHandId: "", selectedAttackerId: "", gameOver: false,
      endReason: "", rankings: [], enemyAction: null, online: Boolean(options.online)
    };
    for (let draw = 0; draw < 5; draw += 1) {
      players.forEach((player) => drawOne(game, player.index, { initial: true }));
    }
    return game;
  }

  const four = api.state.four = {
    game: null,
    localSlot: 3,
    localHumanCount: 1,
    selectedHandId: "",
    selectedAttackerId: "",
    online: {
      client: null, connected: false, roomCode: "", clientId: uid("four-client"),
      slot: -1, isHost: false, players: [], started: false, status: ""
    },
    cpuTimer: null,
    revealTimer: null
  };

  function addLog(game, text) {
    game.log.unshift(text);
    game.log = game.log.slice(0, 80);
  }

  function eligibleTrash(card) {
    return card && !card.generated && !card.copied;
  }

  function recycleSharedDeck(game) {
    const reusable = game.sharedTrash.filter(eligibleTrash);
    game.sharedTrash = game.sharedTrash.filter((card) => !eligibleTrash(card));
    if (!reusable.length) return false;
    game.sharedDeck = shuffle(reusable);
    addLog(game, `共有校外の${reusable.length}枚を共有デッキに戻しました。`);
    return true;
  }

  function drawOne(game, playerIndex, options = {}) {
    const player = game.players[playerIndex];
    if (!player || player.eliminated) return { ok: false, reason: "eliminated" };
    if (!game.sharedDeck.length && !recycleSharedDeck(game)) {
      if (!options.initial) finishGame(game, "共有デッキから必要なドローができない");
      return { ok: false, reason: "empty" };
    }
    const card = game.sharedDeck.shift();
    card.owner = playerIndex;
    if (player.hand.length >= 9) {
      if (eligibleTrash(card)) game.sharedTrash.push(card);
      addLog(game, `${player.name}は「${card.name}」を引きましたが、手札上限のため校外へ送りました。`);
      return { ok: true, overflow: true, card };
    }
    player.hand.push(card);
    if (!options.initial) addLog(game, `${player.name}がカードを1枚引きました。`);
    return { ok: true, card };
  }

  function allBoardCards(game, includeEliminated = true) {
    return game.players.flatMap((player) => {
      if (!includeEliminated && player.eliminated) return [];
      return [...player.board.seats, player.board.teacher]
        .filter(Boolean)
        .map((card) => ({ playerIndex: player.index, card }));
    });
  }

  function findBoardCard(game, id) {
    for (const player of game.players) {
      const seatIndex = player.board.seats.findIndex((card) => card?.id === id);
      if (seatIndex >= 0) return { player, playerIndex: player.index, zone: "seat", index: seatIndex, card: player.board.seats[seatIndex] };
      if (player.board.teacher?.id === id) return { player, playerIndex: player.index, zone: "teacher", index: null, card: player.board.teacher };
    }
    return null;
  }

  function removeBoardCard(game, ref, sourceIndex = null) {
    if (!ref?.card) return;
    if (ref.zone === "seat") ref.player.board.seats[ref.index] = null;
    else ref.player.board.teacher = null;
    if (eligibleTrash(ref.card)) game.sharedTrash.push(ref.card);
    addLog(game, `${ref.player.name}の「${ref.card.name}」が校外へ送られました。`);
    if (sourceIndex !== null && sourceIndex !== ref.playerIndex) checkElimination(game, ref.playerIndex, sourceIndex);
  }

  function damageCard(game, ref, amount, sourceIndex = null) {
    if (!ref?.card || amount <= 0) return 0;
    const before = ref.card.currentHp;
    ref.card.currentHp = Math.max(0, before - amount);
    const dealt = before - ref.card.currentHp;
    if (ref.card.currentHp <= 0) removeBoardCard(game, ref, sourceIndex);
    return dealt;
  }

  function damagePlayer(game, targetIndex, amount, sourceIndex = null) {
    const target = game.players[targetIndex];
    if (!target || target.eliminated || amount <= 0) return 0;
    const before = target.life;
    target.life = Math.max(0, target.life - amount);
    const dealt = before - target.life;
    if (target.life <= 0) checkElimination(game, targetIndex, sourceIndex);
    return dealt;
  }

  function checkElimination(game, targetIndex, sourceIndex = null) {
    const target = game.players[targetIndex];
    if (!target || target.life > 0 || target.eliminated) return;
    target.eliminated = true;
    target.will = 0;
    addLog(game, `${target.name}は脱落しました。`);
    if (Number.isInteger(sourceIndex) && sourceIndex !== targetIndex && game.players[sourceIndex]) {
      game.players[sourceIndex].points += 5;
      addLog(game, `${game.players[sourceIndex].name}が撃破ボーナス5点を獲得しました。`);
    }
    checkEndConditions(game);
  }

  function finishGame(game, reason) {
    if (game.gameOver) return;
    game.gameOver = true;
    game.phase = "finished";
    game.endReason = reason;
    const scores = game.players.map((player) => ({
      playerIndex: player.index,
      name: player.name,
      points: player.points,
      life: player.eliminated ? 0 : player.life,
      score: player.points + (player.eliminated ? 0 : player.life)
    }));
    const distinct = [...new Set(scores.map((entry) => entry.score))].sort((a, b) => b - a);
    game.rankings = scores.map((entry) => ({ ...entry, rank: distinct.indexOf(entry.score) + 1 }))
      .sort((a, b) => a.rank - b.rank || a.playerIndex - b.playerIndex);
    addLog(game, `対戦終了：${reason}`);
  }

  function checkEndConditions(game) {
    if (game.gameOver) return true;
    if (game.enemy.life <= 0) { finishGame(game, "共通敵を撃破"); return true; }
    const alive = game.players.filter((player) => !player.eliminated);
    if (alive.length === 1) { finishGame(game, "生存プレイヤーが1人になった"); return true; }
    if (alive.length === 0) { finishGame(game, "全プレイヤーが脱落"); return true; }
    return false;
  }

  function adjacent(a, b) {
    const distance = Math.abs(a - b);
    return distance === 1 || distance === 3;
  }

  function effectiveAttack(game, card) {
    const penalty = card.attackPenaltyUntilRound >= game.round ? card.attackPenalty : 0;
    return Math.max(0, card.attack - penalty);
  }

  function canAttack(game, ref) {
    return Boolean(ref && ref.playerIndex === game.activeIndex && !ref.player.eliminated
      && !ref.card.hasAttacked && ref.card.attackLockedUntilRound < game.round
      && effectiveAttack(game, ref.card) > 0);
  }

  function playCard(game, playerIndex, cardId, zone, index = null) {
    const player = game.players[playerIndex];
    if (!player || playerIndex !== game.activeIndex || player.eliminated || game.gameOver) return false;
    const handIndex = player.hand.findIndex((card) => card.id === cardId);
    const card = player.hand[handIndex];
    if (!card || card.cost > player.will) return false;
    if (card.type === "student") {
      if (zone !== "seat" || !Number.isInteger(index) || index < 0 || index > 2 || player.board.seats[index] || player.seatBlocks[index] >= game.round) return false;
      player.board.seats[index] = card;
    } else if (card.type === "teacher") {
      if (zone !== "teacher" || player.board.teacher) return false;
      player.board.teacher = card;
    } else if (card.type === "environment") {
      if (zone !== "environment") return false;
      if (game.environment && eligibleTrash(game.environment)) game.sharedTrash.push(game.environment);
      game.environment = card;
    } else return false;
    player.hand.splice(handIndex, 1);
    player.will -= card.cost;
    player.acted = true;
    card.owner = playerIndex;
    card.playedRound = game.round;
    card.hasAttacked = !(card.baseId === "general_teacher" && zone === "teacher");
    addLog(game, `${player.name}が「${card.name}」を${zone === "environment" ? "配置" : "出席"}させました。`);
    game.seq += 1;
    return true;
  }

  function attackEnemy(game, playerIndex, attackerId) {
    const ref = findBoardCard(game, attackerId);
    if (playerIndex !== game.activeIndex || !canAttack(game, ref) || game.enemy.life <= 0) return false;
    const amount = effectiveAttack(game, ref.card);
    const before = game.enemy.life;
    game.enemy.life = Math.max(0, before - amount);
    const actual = before - game.enemy.life;
    game.players[playerIndex].points += actual;
    ref.card.hasAttacked = true;
    game.players[playerIndex].acted = true;
    addLog(game, `${game.players[playerIndex].name}が共通敵に${actual}ダメージ。${actual}点を獲得しました。`);
    if (game.enemy.life <= 0) {
      game.players[playerIndex].points += 10;
      addLog(game, `${game.players[playerIndex].name}が共通敵の撃破ボーナス10点を獲得しました。`);
    }
    game.seq += 1;
    checkEndConditions(game);
    return true;
  }

  function attackPlayer(game, playerIndex, attackerId, targetIndex) {
    const ref = findBoardCard(game, attackerId);
    if (playerIndex !== game.activeIndex || !canAttack(game, ref) || !adjacent(playerIndex, targetIndex)) return false;
    const target = game.players[targetIndex];
    if (!target || target.eliminated) return false;
    const actual = damagePlayer(game, targetIndex, effectiveAttack(game, ref.card), playerIndex);
    ref.card.hasAttacked = true;
    game.players[playerIndex].acted = true;
    addLog(game, `${ref.card.name}が${target.name}本体に${actual}ダメージ。`);
    game.seq += 1;
    checkEndConditions(game);
    return true;
  }

  function attackCard(game, playerIndex, attackerId, targetId) {
    const attacker = findBoardCard(game, attackerId);
    const target = findBoardCard(game, targetId);
    if (playerIndex !== game.activeIndex || !canAttack(game, attacker) || !target || !adjacent(playerIndex, target.playerIndex)) return false;
    const attackerDamage = effectiveAttack(game, attacker.card);
    const targetDamage = effectiveAttack(game, target.card);
    attacker.card.hasAttacked = true;
    game.players[playerIndex].acted = true;
    damageCard(game, target, attackerDamage, playerIndex);
    const refreshedAttacker = findBoardCard(game, attackerId);
    if (refreshedAttacker) damageCard(game, refreshedAttacker, targetDamage, target.playerIndex);
    addLog(game, `${attacker.card.name}が${target.player.name}の${target.card.name}を攻撃しました。`);
    game.seq += 1;
    checkEndConditions(game);
    return true;
  }

  function passTurn(game, playerIndex, discardId) {
    const player = game.players[playerIndex];
    if (!player || playerIndex !== game.activeIndex || player.eliminated || player.acted) return false;
    const handIndex = player.hand.findIndex((card) => card.id === discardId);
    if (handIndex < 0) return false;
    const [discarded] = player.hand.splice(handIndex, 1);
    if (eligibleTrash(discarded)) game.sharedTrash.push(discarded);
    drawOne(game, playerIndex);
    player.life = Math.min(player.maxLife, player.life + 1);
    player.acted = true;
    addLog(game, `${player.name}がパスし、手札交換と気力1回復を行いました。`);
    game.seq += 1;
    if (!game.gameOver) endTurn(game, playerIndex);
    return true;
  }

  function startPlayerTurn(game, playerIndex) {
    if (game.gameOver) return;
    game.activeIndex = playerIndex;
    const player = game.players[playerIndex];
    if (player.eliminated) {
      addLog(game, `${player.name}は脱落済みのため手番を飛ばします。`);
      endTurn(game, playerIndex);
      return;
    }
    player.maxWill = Math.min(10, player.maxWill + 1);
    player.will = Math.max(0, player.maxWill - (player.willPenaltyUntilRound >= game.round ? 1 : 0));
    player.acted = false;
    [...player.board.seats, player.board.teacher].filter(Boolean).forEach((card) => { card.hasAttacked = false; });
    drawOne(game, playerIndex);
    addLog(game, `${player.name}のターン。`);
    game.seq += 1;
  }

  function endTurn(game, playerIndex) {
    if (game.gameOver || playerIndex !== game.activeIndex) return false;
    if (playerIndex < 3) {
      startPlayerTurn(game, playerIndex + 1);
    } else {
      game.phase = "enemy";
      game.activeIndex = -1;
      game.seq += 1;
    }
    return true;
  }

  function strengthForRound(round, random = Math.random) {
    const roll = random() * 100;
    if (round <= 6) return "weak";
    if (round <= 12) return roll < 40 ? "weak" : "medium";
    return roll < 20 ? "weak" : roll < 50 ? "medium" : "strong";
  }

  function chooseWeighted(entries, random = Math.random) {
    const total = entries.reduce((sum, entry) => sum + entry[1], 0);
    let roll = random() * total;
    for (const entry of entries) {
      roll -= entry[1];
      if (roll < 0) return entry[0];
    }
    return entries[entries.length - 1][0];
  }

  function enemyActionDefinition(strength, category, random = Math.random) {
    const sameDebuff = [["attackDown", 70], ["attackLock", 30]];
    const table = {
      weak: {
        attack: [["body1", 40], ["card2", 40], ["allBody1", 20]],
        debuff: sameDebuff,
        disruption: [["willDown", 100]],
        selfBuff: [["heal3", 100]],
        environment: [["classroom", 100]]
      },
      medium: {
        attack: [["body2", 30], ["card3", 50], ["room2", 20]],
        debuff: sameDebuff,
        disruption: [["willDown", 20], ["handTrash", 20], ["seatBlock", 60]],
        selfBuff: [["heal3", 70], ["heal5", 30]],
        environment: [["classroom", 100]]
      },
      strong: {
        attack: [["body3", 15], ["destroyCard", 10], ["room3", 5], ["twoCards4", 50], ["lecture", 20]],
        debuff: sameDebuff,
        disruption: [["willDown", 10], ["handTrash", 10], ["seatBlock", 80]],
        selfBuff: [["heal3", 60], ["heal5", 30], ["heal8", 10]],
        environment: [["classroom", 100]]
      }
    };
    return chooseWeighted(table[strength][category], random);
  }

  const ENEMY_TEXT = {
    body1: "ランダムな生存プレイヤー本体に1ダメージ",
    body2: "ランダムな生存プレイヤー本体に2ダメージ",
    body3: "ランダムな生存プレイヤー本体に3ダメージ",
    card2: "ランダムな出席者1人に2ダメージ", card3: "ランダムな出席者1人に3ダメージ",
    allBody1: "生存している全プレイヤー本体に1ダメージ",
    room2: "ランダムな講義室の出席者全員に2ダメージ", room3: "ランダムな講義室の出席者全員に3ダメージ",
    destroyCard: "ランダムな出席者1人を破壊", twoCards4: "全講義室から異なる出席者を最大2人選び、それぞれ4ダメージ",
    lecture: "共通敵が全講義室に対して講義を行う", attackDown: "ランダムな出席者1人の攻撃力を-1（1ターン）",
    attackLock: "ランダムな出席者1人を攻撃不可にする（1ターン）", willDown: "ランダムな生存プレイヤー1人の現在の戦意を-1",
    handTrash: "ランダムな生存プレイヤー1人の手札から1枚を共有校外へ送る", seatBlock: "ランダムな講義室の空いている席マス1つを封鎖（1ターン）",
    heal3: "共通敵の気力を3回復", heal5: "共通敵の気力を5回復", heal8: "共通敵の気力を8回復",
    classroom: "「一般教室」を生成して共有の環境マスへ配置"
  };

  function randomChoice(values, random = Math.random) {
    return values.length ? values[Math.floor(random() * values.length)] : null;
  }

  function resolveEnemyAction(game, action, random = Math.random) {
    const alive = game.players.filter((player) => !player.eliminated);
    const cards = allBoardCards(game);
    const pickAlive = () => randomChoice(alive, random);
    const pickCard = () => randomChoice(allBoardCards(game), random);
    if (/^body[123]$/.test(action)) {
      const target = pickAlive();
      if (target) damagePlayer(game, target.index, Number(action.slice(-1)), null);
    } else if (action === "allBody1") {
      alive.forEach((player) => damagePlayer(game, player.index, 1, null));
    } else if (/^card[23]$/.test(action)) {
      const target = pickCard();
      if (target) damageCard(game, findBoardCard(game, target.card.id), Number(action.slice(-1)), null);
    } else if (action === "destroyCard") {
      const target = pickCard();
      if (target) removeBoardCard(game, findBoardCard(game, target.card.id));
    } else if (action === "twoCards4") {
      shuffle(cards, random).slice(0, 2).forEach((target) => damageCard(game, findBoardCard(game, target.card.id), 4, null));
    } else if (action === "room2" || action === "room3") {
      const room = randomChoice(game.players, random);
      const amount = action === "room2" ? 2 : 3;
      if (room) [...room.board.seats, room.board.teacher].filter(Boolean).forEach((card) => damageCard(game, findBoardCard(game, card.id), amount, null));
    } else if (action === "lecture") {
      allBoardCards(game).filter((entry) => entry.card.type === "student")
        .forEach((entry) => damageCard(game, findBoardCard(game, entry.card.id), 1, null));
    } else if (action === "attackDown" || action === "attackLock") {
      const target = pickCard();
      if (target) {
        if (action === "attackDown") { target.card.attackPenalty = 1; target.card.attackPenaltyUntilRound = game.round + 1; }
        else target.card.attackLockedUntilRound = game.round + 1;
      }
    } else if (action === "willDown") {
      const target = pickAlive();
      if (target) {
        target.will = Math.max(0, target.will - 1);
        target.willPenaltyUntilRound = game.round + 1;
      }
    } else if (action === "handTrash") {
      const candidates = alive.filter((player) => player.hand.length);
      const target = randomChoice(candidates, random);
      if (target) {
        const index = Math.floor(random() * target.hand.length);
        const [card] = target.hand.splice(index, 1);
        if (eligibleTrash(card)) game.sharedTrash.push(card);
      }
    } else if (action === "seatBlock") {
      const open = game.players.flatMap((player) => player.board.seats
        .map((card, index) => ({ player, index, card }))
        .filter((entry) => !entry.card && entry.player.seatBlocks[entry.index] < game.round));
      const target = randomChoice(open, random);
      if (target) target.player.seatBlocks[target.index] = game.round + 1;
    } else if (/^heal[358]$/.test(action)) {
      game.enemy.life = Math.min(game.enemy.maxLife, game.enemy.life + Number(action.slice(-1)));
    } else if (action === "classroom") {
      if (game.environment && eligibleTrash(game.environment)) game.sharedTrash.push(game.environment);
      game.environment = createCard("classroom");
      game.environment.generated = true;
    }
    addLog(game, `共通敵の行動：${ENEMY_TEXT[action]}`);
    game.enemyAction = { action, text: ENEMY_TEXT[action], round: game.round };
    game.seq += 1;
    checkEndConditions(game);
  }

  function runEnemyTurn(game, random = Math.random) {
    if (game.gameOver) return null;
    const strength = strengthForRound(game.round, random);
    const category = chooseWeighted(CATEGORY_WEIGHTS, random);
    const action = enemyActionDefinition(strength, category, random);
    game.enemyAction = { strength, category, action, text: ENEMY_TEXT[action], round: game.round };
    return game.enemyAction;
  }

  function completeEnemyTurn(game, action = game.enemyAction, random = Math.random) {
    if (!action || game.gameOver) return;
    resolveEnemyAction(game, action.action, random);
    if (game.gameOver) return;
    game.round += 1;
    game.players.forEach((player) => {
      player.seatBlocks = player.seatBlocks.map((until) => until < game.round ? 0 : until);
    });
    game.phase = "playing";
    startPlayerTurn(game, 0);
  }

  function serializeGame(game) {
    return JSON.parse(JSON.stringify(game));
  }

  function isHostAuthority() {
    return !four.game?.online || four.online.isHost;
  }

  function localCanOperate(game = four.game) {
    if (!game || game.gameOver || game.phase !== "playing") return false;
    const player = game.players[game.activeIndex];
    if (!player || player.kind !== "human") return false;
    return !game.online || player.clientId === four.online.clientId || four.online.slot === game.activeIndex;
  }

  function sendFour(type, payload = {}) {
    return four.online.client?.send({ type, protocol: 1, ...payload });
  }

  function broadcastGame() {
    if (four.game?.online && four.online.isHost) sendFour("fourState", { snapshot: serializeGame(four.game) });
  }

  function applyAction(action, senderClientId = four.online.clientId) {
    const game = four.game;
    if (!game || game.gameOver || game.phase !== "playing") return false;
    const player = game.players[game.activeIndex];
    if (!player || player.kind !== "human") return false;
    if (game.online && player.clientId && player.clientId !== senderClientId) return false;
    let changed = false;
    if (action.type === "play") changed = playCard(game, game.activeIndex, action.cardId, action.zone, action.index);
    else if (action.type === "attackEnemy") changed = attackEnemy(game, game.activeIndex, action.attackerId);
    else if (action.type === "attackPlayer") changed = attackPlayer(game, game.activeIndex, action.attackerId, action.targetIndex);
    else if (action.type === "attackCard") changed = attackCard(game, game.activeIndex, action.attackerId, action.targetId);
    else if (action.type === "pass") changed = passTurn(game, game.activeIndex, action.discardId);
    else if (action.type === "endTurn") changed = endTurn(game, game.activeIndex);
    if (changed) {
      four.selectedHandId = "";
      four.selectedAttackerId = "";
      render();
      broadcastGame();
      advanceAutomatedTurns();
    }
    return changed;
  }

  function submitAction(action) {
    if (!localCanOperate()) return false;
    if (four.game.online && !four.online.isHost) return sendFour("fourCommand", { action });
    return applyAction(action);
  }

  function cpuAction(game, player) {
    const playable = player.hand.find((card) => card.cost <= player.will && (
      card.type === "environment" || (card.type === "teacher" && !player.board.teacher)
      || (card.type === "student" && player.board.seats.some((seat, index) => !seat && player.seatBlocks[index] < game.round))
    ));
    if (playable) {
      if (playable.type === "environment") playCard(game, player.index, playable.id, "environment");
      else if (playable.type === "teacher") playCard(game, player.index, playable.id, "teacher");
      else playCard(game, player.index, playable.id, "seat", player.board.seats.findIndex((seat, index) => !seat && player.seatBlocks[index] < game.round));
      return true;
    }
    const attacker = [...player.board.seats, player.board.teacher].filter(Boolean)
      .map((card) => findBoardCard(game, card.id)).find((ref) => canAttack(game, ref));
    if (attacker) {
      const adjacentTargets = allBoardCards(game).filter((entry) => adjacent(player.index, entry.playerIndex));
      if (adjacentTargets.length && Math.random() < .45) {
        attackCard(game, player.index, attacker.card.id, randomChoice(adjacentTargets).card.id);
      } else if (game.enemy.life > 0 && Math.random() < .75) {
        attackEnemy(game, player.index, attacker.card.id);
      } else {
        const livingAdjacent = game.players.filter((target) => !target.eliminated && adjacent(player.index, target.index));
        const target = randomChoice(livingAdjacent);
        if (target) attackPlayer(game, player.index, attacker.card.id, target.index);
        else attackEnemy(game, player.index, attacker.card.id);
      }
      return true;
    }
    if (!player.acted && player.hand.length && Math.random() < .35) {
      passTurn(game, player.index, player.hand[0].id);
      return true;
    }
    endTurn(game, player.index);
    return false;
  }

  function revealEnemyAction(action, done) {
    clearTimeout(four.revealTimer);
    els.fourEnemyActionReveal.innerHTML = `<small>共通敵の行動</small>${escapeHtml(action.text)}`;
    els.fourEnemyActionReveal.classList.remove("hidden");
    four.revealTimer = setTimeout(() => {
      els.fourEnemyActionReveal.classList.add("hidden");
      done();
    }, 1050);
  }

  function advanceAutomatedTurns() {
    clearTimeout(four.cpuTimer);
    if (!isHostAuthority() || !four.game || four.game.gameOver) { render(); return; }
    const game = four.game;
    if (game.phase === "enemy") {
      const action = runEnemyTurn(game);
      render();
      broadcastGame();
      revealEnemyAction(action, () => {
        completeEnemyTurn(game, action);
        render();
        broadcastGame();
        advanceAutomatedTurns();
      });
      return;
    }
    const player = game.players[game.activeIndex];
    if (!player || player.eliminated) {
      four.cpuTimer = setTimeout(() => { endTurn(game, game.activeIndex); render(); broadcastGame(); advanceAutomatedTurns(); }, 280);
      return;
    }
    if (player.kind === "cpu") {
      four.cpuTimer = setTimeout(() => {
        cpuAction(game, player);
        render();
        broadcastGame();
        advanceAutomatedTurns();
      }, 420);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  }

  function positionMap() {
    if (!four.game?.online || four.online.slot < 0) return { left: 0, top: 1, right: 2, bottom: 3 };
    const self = four.online.slot;
    return { bottom: self, left: (self + 1) % 4, top: (self + 2) % 4, right: (self + 3) % 4 };
  }

  function playerAtPosition(position) {
    const map = positionMap();
    return four.game?.players[map[position]] || null;
  }

  function miniCard(card, game) {
    const selected = four.selectedAttackerId === card.id ? " selected" : "";
    const targetable = four.selectedAttackerId && findBoardCard(game, card.id)?.playerIndex !== game.activeIndex ? " attackable" : "";
    const lock = card.attackLockedUntilRound >= game.round ? " 攻撃不可" : "";
    return `<button class="four-mini-card ${card.type}${selected}${targetable}" type="button" data-four-board-card="${escapeHtml(card.id)}">
      <span class="four-mini-name">${escapeHtml(card.name)}${lock}</span>
      <span class="four-mini-stats"><span>${effectiveAttack(game, card)}</span><span>${card.currentHp}</span></span>
    </button>`;
  }

  function renderPlayerZone(zone, player) {
    if (!zone || !player) return;
    const game = four.game;
    const active = game.phase === "playing" && game.activeIndex === player.index;
    zone.classList.toggle("active", active);
    zone.innerHTML = `<div class="four-room-head"><span>${escapeHtml(player.name)}の講義室</span><span>${player.eliminated ? "脱落" : player.kind === "cpu" ? "CPU" : "HUMAN"}</span></div>
      <div class="four-room-grid">
        <div class="four-slot teacher" data-four-slot-zone="teacher" data-four-player="${player.index}">${player.board.teacher ? miniCard(player.board.teacher, game) : "教卓"}</div>
        ${player.board.seats.map((card, index) => {
          const blocked = player.seatBlocks[index] >= game.round;
          const available = localCanOperate(game) && player.index === game.activeIndex && four.selectedHandId && !card && !blocked;
          return `<div class="four-slot${blocked ? " blocked" : ""}${available ? " available" : ""}" data-four-slot-zone="seat" data-four-slot-index="${index}" data-four-player="${player.index}">${card ? miniCard(card, game) : `席${index + 1}`}</div>`;
        }).join("")}
      </div><div class="four-late-zone">遅刻ゾーン ${player.late.length ? player.late.length : "なし"}</div>`;
  }

  function statusTemplate(player, position) {
    if (!player) return "";
    const attackable = four.selectedAttackerId && adjacent(four.game.activeIndex, player.index) && !player.eliminated;
    return `<div class="four-status-name">${position === "bottom" ? "YOU / " : ""}${escapeHtml(player.name)}</div>
      <button type="button" class="four-status-values" data-four-life-target="${player.index}" ${attackable ? "" : "disabled"}>
        <span>気力 ${player.life}</span><span>戦意 ${player.will}/${player.maxWill}</span><span>P ${player.points}</span>
      </button>`;
  }

  function renderHands() {
    const map = positionMap();
    POSITIONS.forEach((position) => {
      const actualContainer = document.querySelector(`.four-hand-${position}`);
      const player = four.game.players[map[position]];
      if (!actualContainer || !player) return;
      const show = position === "bottom" || (!four.game.online && player.kind === "human" && player.index === four.game.activeIndex);
      actualContainer.innerHTML = player.hand.map((card) => show
        ? `<button class="four-hand-card ${card.type}${four.selectedHandId === card.id ? " selected" : ""}" type="button" data-four-hand-card="${card.id}">
            <strong>${escapeHtml(card.name)}</strong><br><span>戦意 ${card.cost}</span>${card.type !== "environment" ? `<br><span>${card.attack} / ${card.hp}</span>` : ""}
          </button>`
        : `<span class="four-card-back">手札</span>`).join("");
    });
  }

  function renderResults(game) {
    els.fourResultOverlay.classList.toggle("hidden", !game.gameOver);
    if (!game.gameOver) return;
    els.fourResultList.innerHTML = `<p>${escapeHtml(game.endReason)}</p>${game.rankings.map((entry) => `<div class="four-result-row">
      <span class="four-result-rank">${entry.rank}位</span><strong>${escapeHtml(entry.name)}</strong><span>${entry.points}P + 気力${entry.life} = <strong>${entry.score}</strong></span>
    </div>`).join("")}`;
  }

  function renderBattle() {
    const game = four.game;
    if (!game || api.state.screen !== "fourBattle") return;
    const map = positionMap();
    POSITIONS.forEach((position) => {
      const zone = document.querySelector(`.four-zone-${position}`);
      renderPlayerZone(zone, game.players[map[position]]);
      const status = document.getElementById(`fourStatus${position === "left" ? "A" : position === "top" ? "B" : position === "right" ? "C" : "Self"}`);
      if (status) {
        const player = game.players[map[position]];
        status.innerHTML = statusTemplate(player, position);
        status.classList.toggle("eliminated", Boolean(player?.eliminated));
      }
    });
    renderHands();
    const active = game.activeIndex >= 0 ? game.players[game.activeIndex] : null;
    els.fourTurnBanner.textContent = game.phase === "enemy" ? "共通敵の行動" : `${active?.name || "-"}のターン / ${game.round}ターン目`;
    els.fourSharedDeck.querySelector("strong").textContent = game.sharedDeck.length;
    els.fourSharedTrash.querySelector("strong").textContent = game.sharedTrash.length;
    els.fourEnemy.querySelector("strong").textContent = `${game.enemy.life} / ${game.enemy.maxLife}`;
    els.fourEnemy.classList.toggle("attackable", Boolean(four.selectedAttackerId && localCanOperate()));
    els.fourEnemy.classList.toggle("defeated", game.enemy.life <= 0);
    els.fourEnvironment.innerHTML = `環境マス<br><strong>${escapeHtml(game.environment?.name || "なし")}</strong>`;
    els.fourWillText.textContent = active ? `${active.will} / ${active.maxWill}` : "-";
    const operative = localCanOperate();
    els.fourPassButton.disabled = !operative || active.acted || !four.selectedHandId;
    els.fourEndTurnButton.disabled = !operative;
    els.fourLogList.innerHTML = game.log.map((entry) => `<div class="four-log-entry">${escapeHtml(entry)}</div>`).join("");
    renderResults(game);
  }

  function renderLobby() {
    const online = four.online;
    els.fourRoomCode.textContent = online.roomCode || "------";
    els.fourOnlineRole.textContent = online.connected ? (online.isHost ? "ホスト" : `プレイヤー${online.slot + 1}`) : "未接続";
    els.fourOnlineStatus.textContent = online.status || "最大4人が入室でき、空いた席はCPUが担当します。";
    els.fourLobbySeats.innerHTML = Array.from({ length: 4 }, (_, index) => {
      const occupant = online.players.find((player) => player.slot === index);
      return `<div class="four-lobby-seat${occupant ? " connected" : ""}"><span>席${index + 1}</span><strong>${occupant ? "プレイヤー" : "CPU予定"}</strong></div>`;
    }).join("");
    els.fourCreateButton.disabled = online.connected;
    els.fourJoinButton.disabled = online.connected;
    els.fourLeaveButton.disabled = !online.connected;
    els.fourOnlineStartButton.disabled = !online.connected || !online.isHost;
  }

  function render() {
    renderLobby();
    renderBattle();
  }

  function showSetup() {
    api.state.screen = "fourSetup";
    api.render();
    render();
  }

  function startLocal() {
    const humanCount = Math.max(1, Math.min(4, Number(els.fourLocalHumanCount.value) || 1));
    four.localHumanCount = humanCount;
    four.online.connected = false;
    four.game = initialState(humanCount);
    api.state.screen = "fourBattle";
    startPlayerTurn(four.game, 0);
    api.render();
    render();
    advanceAutomatedTurns();
  }

  function onlineServerUrl() {
    const query = new URLSearchParams(location.search).get("ws");
    if (query) return query;
    const stored = localStorage.getItem("chibattle-online-server-url-v1");
    if (stored) return stored;
    return location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "ws://localhost:8787" : "wss://chibatoru-online.onrender.com";
  }

  function fourRoomPayload(create, roomCode) {
    return { protocol: 1, mode: "four", roomId: roomCode, clientId: four.online.clientId, create };
  }

  function connectFour(create) {
    const code = create ? Math.random().toString(36).slice(2, 8).toUpperCase() : els.fourRoomInput.value.trim().toUpperCase();
    if (!code) { four.online.status = "部屋コードを入力してください。"; render(); return; }
    four.online.client?.close();
    four.online.status = "接続中...";
    four.online.roomCode = code;
    const client = new window.ChibatoruWebSocketClient(onlineServerUrl(), {
      onOpen: () => { four.online.status = "入室処理中..."; render(); },
      onMessage: handleFourMessage,
      onClose: () => { four.online.connected = false; four.online.status = "接続が切れました。"; render(); },
      onError: () => { four.online.status = "対戦サーバーに接続できません。"; render(); }
    });
    four.online.client = client;
    client.connect(fourRoomPayload(create, code));
    render();
  }

  function handleFourMessage(message) {
    if (message.type === "error") {
      four.online.status = message.message || "通信エラーです。";
    } else if (message.type === "fourJoined" || message.type === "fourLobby") {
      if (message.you) {
        four.online.slot = message.you.slot;
        four.online.isHost = Boolean(message.you.isHost);
      }
      four.online.connected = true;
      four.online.roomCode = message.roomId || four.online.roomCode;
      four.online.players = message.players || [];
      four.online.status = `${four.online.players.length}人が入室中です。`;
      if (message.snapshot) receiveSnapshot(message.snapshot);
      if (four.online.isHost && four.game?.online && four.online.started) {
        const connectedIds = new Set(four.online.players.map((player) => player.clientId));
        let replaced = false;
        four.game.players.forEach((player) => {
          if (player.kind === "human" && player.clientId !== four.online.clientId && !connectedIds.has(player.clientId)) {
            player.kind = "cpu";
            player.clientId = "";
            addLog(four.game, `${player.name}の接続が切れたため、CPUが引き継ぎました。`);
            replaced = true;
          }
        });
        if (replaced) {
          broadcastGame();
          advanceAutomatedTurns();
        }
      }
    } else if (message.type === "fourStart" || message.type === "fourState") {
      receiveSnapshot(message.snapshot);
    } else if (message.type === "fourCommand" && four.online.isHost) {
      applyAction(message.action || {}, message.senderId || "");
    }
    render();
  }

  function receiveSnapshot(snapshot) {
    if (!snapshot || snapshot.mode !== "four") return;
    four.game = snapshot;
    four.online.started = true;
    api.state.screen = "fourBattle";
    api.render();
    render();
    if (four.online.isHost) advanceAutomatedTurns();
  }

  function startOnline() {
    if (!four.online.isHost) return;
    const game = initialState(four.online.players.length, { online: true });
    game.players.forEach((player) => {
      const occupant = four.online.players.find((entry) => entry.slot === player.index);
      player.kind = occupant ? "human" : "cpu";
      player.clientId = occupant?.clientId || "";
      player.name = occupant ? `プレイヤー${player.index + 1}` : `CPU${player.index + 1}`;
    });
    four.game = game;
    startPlayerTurn(game, 0);
    sendFour("fourStart", { snapshot: serializeGame(game) });
    api.state.screen = "fourBattle";
    api.render();
    render();
    advanceAutomatedTurns();
  }

  function leaveOnline() {
    four.online.client?.close();
    four.online = { ...four.online, client: null, connected: false, roomCode: "", slot: -1, isHost: false, players: [], started: false, status: "" };
    render();
  }

  function handleBoardClick(event) {
    const game = four.game;
    if (!game || game.gameOver) return;
    const handCard = event.target.closest("[data-four-hand-card]");
    if (handCard && localCanOperate()) {
      four.selectedHandId = four.selectedHandId === handCard.dataset.fourHandCard ? "" : handCard.dataset.fourHandCard;
      four.selectedAttackerId = "";
      render();
      return;
    }
    const slot = event.target.closest("[data-four-slot-zone]");
    if (slot && four.selectedHandId && Number(slot.dataset.fourPlayer) === game.activeIndex) {
      submitAction({ type: "play", cardId: four.selectedHandId, zone: slot.dataset.fourSlotZone, index: Number(slot.dataset.fourSlotIndex) });
      return;
    }
    if (event.target.closest("#fourEnvironment") && four.selectedHandId) {
      submitAction({ type: "play", cardId: four.selectedHandId, zone: "environment" });
      return;
    }
    const boardCard = event.target.closest("[data-four-board-card]");
    if (boardCard) {
      const id = boardCard.dataset.fourBoardCard;
      const ref = findBoardCard(game, id);
      if (ref?.playerIndex === game.activeIndex && canAttack(game, ref) && localCanOperate()) {
        four.selectedAttackerId = four.selectedAttackerId === id ? "" : id;
        four.selectedHandId = "";
        render();
      } else if (four.selectedAttackerId && ref) {
        submitAction({ type: "attackCard", attackerId: four.selectedAttackerId, targetId: id });
      }
      return;
    }
    const life = event.target.closest("[data-four-life-target]");
    if (life && four.selectedAttackerId) submitAction({ type: "attackPlayer", attackerId: four.selectedAttackerId, targetIndex: Number(life.dataset.fourLifeTarget) });
  }

  els.onlineFourMatchButton?.addEventListener("click", showSetup);
  els.fourBackOnlineButton?.addEventListener("click", () => { api.state.screen = "online"; api.state.online.lobbyView = "menu"; api.render(); });
  els.fourLocalStartButton?.addEventListener("click", startLocal);
  els.fourCreateButton?.addEventListener("click", () => connectFour(true));
  els.fourJoinButton?.addEventListener("click", () => connectFour(false));
  els.fourLeaveButton?.addEventListener("click", leaveOnline);
  els.fourOnlineStartButton?.addEventListener("click", startOnline);
  els.fourBattleScreen?.addEventListener("click", handleBoardClick);
  els.fourEnemy?.addEventListener("click", () => { if (four.selectedAttackerId) submitAction({ type: "attackEnemy", attackerId: four.selectedAttackerId }); });
  els.fourPassButton?.addEventListener("click", () => submitAction({ type: "pass", discardId: four.selectedHandId }));
  els.fourEndTurnButton?.addEventListener("click", () => submitAction({ type: "endTurn" }));
  els.fourLogButton?.addEventListener("click", () => els.fourLogPanel.classList.toggle("hidden"));
  els.fourLogCloseButton?.addEventListener("click", () => els.fourLogPanel.classList.add("hidden"));
  els.fourBattleMenuButton?.addEventListener("click", () => els.fourMenuPanel.classList.toggle("hidden"));
  els.fourMenuCloseButton?.addEventListener("click", () => els.fourMenuPanel.classList.add("hidden"));
  els.fourQuitButton?.addEventListener("click", () => { clearTimeout(four.cpuTimer); api.state.screen = "fourSetup"; api.render(); render(); });
  els.fourResultBackButton?.addEventListener("click", () => { api.state.screen = "fourSetup"; api.render(); render(); });

  window.__chibattleFour = {
    four, render, initialState, createCard, drawOne, recycleSharedDeck, playCard,
    attackEnemy, attackPlayer, attackCard, passTurn, startPlayerTurn, endTurn,
    strengthForRound, chooseWeighted, enemyActionDefinition, runEnemyTurn,
    resolveEnemyAction, completeEnemyTurn, checkEndConditions, finishGame,
    adjacent, serializeGame, applyAction, startLocal
  };

  render();
})();
