"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8787);
const PROTOCOL_VERSION = 1;
const ROOM_TTL_MS = 1000 * 60 * 60 * 2;
const WAITING_ROOM_TIMEOUT_MS = Number(process.env.WAITING_ROOM_TIMEOUT_MS || 1000 * 60 * 5);
const COMMAND_RETRY_MS = Number(process.env.COMMAND_RETRY_MS || 1200);
const COMMAND_MAX_ATTEMPTS = Number(process.env.COMMAND_MAX_ATTEMPTS || 6);
const PROCESSED_COMMAND_LIMIT = 120;
const MAX_PENDING_COMMANDS_PER_PLAYER = 12;
const MAX_MESSAGE_BYTES = Number(process.env.MAX_MESSAGE_BYTES || 2 * 1024 * 1024);
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;
const MAX_DECK_CARDS = 60;
const MIN_DECK_CARDS = 40;
const SERVER_ID = "server";

// Keep this server-side catalog in sync with the browser's direct-deck catalog.
// The server deliberately owns a copy: clients are not authoritative for deck
// legality, and generated, token, and evolution-only cards must never become
// legal merely by being sent over the socket.
const DEFAULT_ROOM_RULE_ID = "normal";
const SPECIALTY_DEFINITIONS = Object.freeze({
  gakuyukai_item: Object.freeze({ id: "gakuyukai_item", name: "学友会・持ち物" }),
  cafeteria: Object.freeze({ id: "cafeteria", name: "食堂" }),
  design: Object.freeze({ id: "design", name: "デザイン" }),
  late: Object.freeze({ id: "late", name: "遅刻" }),
  expansion: Object.freeze({ id: "expansion", name: "展開・敵増殖" }),
  interference: Object.freeze({ id: "interference", name: "妨害・LO" }),
  shogi: Object.freeze({ id: "shogi", name: "将棋部" }),
  big: Object.freeze({ id: "big", name: "バカでかい型" }),
  vampire: Object.freeze({ id: "vampire", name: "ヴァンパイア" })
});
const SPECIALTY_CARD_IDS = Object.freeze({
  common: Object.freeze(["ai_chan", "alpha", "absolute_woman", "beta", "chaos_world", "circle_crab", "classroom", "course_registration_party", "environment_setup", "fridge_thief", "gamma", "general_student", "general_teacher", "go_away", "hair_crab", "happy_experience", "homeless_crab", "hondara", "impossible_pink_fat", "laughing_front_student", "on_demand_business", "oni_shima_ai", "sage_legacy", "smart_me", "summer_teacher", "ta", "three_gestures", "water_2l", "word_increaser"]),
  gakuyukai_item: Object.freeze(["abyss", "accelerate", "aggro_eater", "back_door", "chameleon", "dark_student_council", "dark_yuta", "deck_without", "delayed_student", "door_front", "door_war", "dropped_cards", "failure_student", "front_door", "full_throttle", "greeting_3000", "ikemasu", "kansai_voice_t", "paired_existence", "panpan", "red_happi", "scared_me", "set_log", "sexual_eye", "student_council", "success_student", "think_so", "trendy_student", "yocchan", "yoyu_announce", "yuta", "yuta_umbrella", "yutakun_yutakun"]),
  cafeteria: Object.freeze(["apprentice_vampire", "bento", "cafeteria", "cafeteria_lady", "chen_san", "curry_treater", "dry_meal_ticket", "fluid_pasta", "green_curry", "illegal_cafeteria", "impossible_high_note", "iv_pack", "onigiri_draw", "reversal", "tissue_distributor", "vampire", "vampirization", "wet_meal_ticket", "wood_gitch", "yakiniku", "zombie"]),
  design: Object.freeze(["acting_out_man", "back_question_student", "bird_a", "demon_a_plus", "design_domain", "diamond_dust", "donguri", "double_diamond", "fairy_t", "lightning_n", "music_detergent", "namen_tenno", "popular_c", "raptor_temple", "ruler", "suzaku", "ux_design_textbook"]),
  late: Object.freeze(["adjective_student", "cancel_student", "eaten_student", "hurried_student", "lazy_student", "no_late_time", "signal_professor_m", "substitute_attendance", "tokyo_tech_bro"]),
  expansion: Object.freeze(["aggro_king", "aggro_queen", "brother_capital", "college_student_vibe", "enemy_boss", "enemy_student", "extra_people", "extra_student", "kyushu_info_c", "loud_group", "midge", "night_pool", "night_pool_water", "organism", "pachin_uni", "perfect_mutant", "pro_k", "proliferating_enemy", "roar", "seat_taking_group", "single_cell", "sock_block", "trpg_member"]),
  interference: Object.freeze(["aggro_student", "angry_maker", "baka_mac", "bounce_day", "building_12_classroom", "capture", "cynical_student", "destroy_dos_attack", "dobby", "dont_worry", "dos_attack", "elite_open_chatter", "france_asakura", "full_lock", "handmade_ctoc", "handy_jet_engine", "i_got_it", "kyoto_sound_i", "live_person", "logic_hunter", "meguro_library", "ninety_three_teacher", "peaceful_mind", "philosophy_cheating", "quiet_please", "seat_rules", "sniper", "student_comedy", "suspicious_document", "thanks_all_students", "thin_item", "thin_professor_h", "ttb", "yamanashi_minimum_wage"]),
  shogi: Object.freeze(["aiben", "aiben_vs_nyotei_title_match", "forbidden_book", "furious_comeback", "gangi_fortress", "infight_shogi", "nyotei", "shogi_duel_field", "stand_up"]),
  big: Object.freeze(["ae_student", "best_friend", "big_laughter", "big_wall", "chigauyo", "cote_dazur", "crotch_febreze", "dorm_council", "favorite_number_s", "fire_touch", "go_home", "key", "lie_pekora", "loud_members", "lone_wolf", "loud_student", "one_eyed_peek", "padlock", "predator", "president", "protein_drinker", "rebirth_student", "seriously_hit", "small_omata", "smoke_flare", "super_ae_student", "ta_killer"]),
  vampire: Object.freeze([])
});
const NON_DIRECT_DECK_CARD_IDS = new Set([
  "beta", "gamma", "oni_shima_ai", "ta", "dark_student_council", "dark_yuta",
  "success_student", "dry_meal_ticket", "demon_a_plus", "double_diamond", "extra_student",
  "midge", "organism", "perfect_mutant", "roar", "suspicious_document", "key", "gitch", "gigi_blood"
]);
const DIRECT_DECK_CARD_IDS = new Set([
  ...Object.values(SPECIALTY_CARD_IDS).flat()
].filter((baseId) => !NON_DIRECT_DECK_CARD_IDS.has(baseId)));
const ACE_CARD_IDS = new Set([
  "tokyo_tech_bro", "brother_capital", "smoke_flare", "forbidden_book", "philosophy_cheating",
  "think_so", "illegal_cafeteria", "namen_tenno"
]);
const CARD_COPY_LIMITS = Object.freeze({
  circle_crab: 2,
  hair_crab: 1,
  homeless_crab: 1
});

// New room rules should be added here. Validation below reads this data instead
// of hard-coding rule IDs throughout the room and deck code.
const ROOM_RULE_DEFINITIONS = Object.freeze({
  normal: Object.freeze({
    id: "normal",
    name: "通常",
    description: "専攻を問わず通常デッキを使用します。",
    deck: Object.freeze({ formats: Object.freeze(["normal"]), minCards: MIN_DECK_CARDS, maxCards: MAX_DECK_CARDS, copyLimit: "standard", aceLimit: 1, specialty: "none" })
  }),
  specialty: Object.freeze({
    id: "specialty",
    name: "専攻",
    description: "選んだ専攻と共通カードだけで構成した専攻デッキを使用します。",
    deck: Object.freeze({ formats: Object.freeze(["specialty"]), minCards: MIN_DECK_CARDS, maxCards: MIN_DECK_CARDS, copyLimit: "standard", aceLimit: 1, specialty: "required" })
  }),
  chaos: Object.freeze({
    id: "chaos",
    name: "カオス",
    description: "すべての直接編成可能カードを、同名・エースぺ制限なしで使用します。",
    deck: Object.freeze({ formats: Object.freeze(["chaos"]), minCards: MIN_DECK_CARDS, maxCards: MAX_DECK_CARDS, copyLimit: "none", aceLimit: null, specialty: "none" })
  })
});
const ROOM_RULE_IDS = new Set(Object.keys(ROOM_RULE_DEFINITIONS));
const LOG_ADMIN_PASSWORD = process.env.CHIBATORU_LOG_ADMIN_PASSWORD || process.env.ADMIN_LOG_PASSWORD || "";
const RENDER_DISK_ROOT = "/var/data";
const DEFAULT_LOG_STORAGE_DIR = fs.existsSync(RENDER_DISK_ROOT)
  ? path.join(RENDER_DISK_ROOT, "chibatoru-online-logs")
  : path.join(os.tmpdir(), "chibatoru-online-logs");
const LOG_STORAGE_DIR = process.env.CHIBATORU_LOG_DIR || DEFAULT_LOG_STORAGE_DIR;
const MAX_STORED_LOGS = Number(process.env.MAX_STORED_LOGS || 300);
const MAX_IMPORT_BYTES = Number(process.env.MAX_IMPORT_BYTES || 8 * 1024 * 1024);

const rooms = new Map();
const randomMatchQueue = [];
const onlineBattleLogs = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, onlineLogs: onlineBattleLogs.size }));
    return;
  }
  if (url.pathname === "/rooms.json") {
    handlePublicRoomsJson(res);
    return;
  }
  if (url.pathname === "/admin/logs/backup.json") {
    handleAdminLogsBackupJson(req, res);
    return;
  }
  if (url.pathname === "/admin/logs" || url.pathname.startsWith("/admin/logs/")) {
    handleAdminLogsRequest(req, res, url);
    return;
  }
  if (url.pathname === "/admin/logs.json") {
    handleAdminLogsJson(req, res);
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Chibatoru WebSocket server");
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

function now() {
  return Date.now();
}

function normalizeRoomId(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function roomRuleDefinition(ruleId) {
  const id = String(ruleId || "").trim();
  return ROOM_RULE_IDS.has(id) ? ROOM_RULE_DEFINITIONS[id] : null;
}

function publicRoomRule(ruleId) {
  const rule = roomRuleDefinition(ruleId) || ROOM_RULE_DEFINITIONS[DEFAULT_ROOM_RULE_ID];
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    deck: {
      formats: [...rule.deck.formats],
      minCards: rule.deck.minCards,
      maxCards: rule.deck.maxCards,
      copyLimit: rule.deck.copyLimit,
      aceLimit: rule.deck.aceLimit,
      specialty: rule.deck.specialty
    }
  };
}

function normalizeDeckFormat(value) {
  const format = String(value || "").trim().toLowerCase();
  return format || "normal";
}

function normalizeSpecialtyId(value) {
  return String(value || "").trim().toLowerCase().slice(0, 80);
}

function deckDescriptorFromMessage(message = {}, previous = null) {
  const hasDeckFormat = hasOwn(message, "deckFormat");
  const hasSpecialtyId = hasOwn(message, "specialtyId");
  const hasDeckCounts = hasOwn(message, "deckCounts");
  return {
    deckFormat: hasDeckFormat
      ? normalizeDeckFormat(message.deckFormat)
      : normalizeDeckFormat(previous?.deckFormat || "normal"),
    specialtyId: hasSpecialtyId
      ? normalizeSpecialtyId(message.specialtyId)
      : normalizeSpecialtyId(previous?.specialtyId || ""),
    deckCounts: hasDeckCounts ? message.deckCounts : (previous?.deckCounts ?? null)
  };
}

function specialtyAllowedCardIds(specialtyId) {
  if (!SPECIALTY_DEFINITIONS[specialtyId]) return new Set();
  return new Set([
    ...(SPECIALTY_CARD_IDS.common || []),
    ...(SPECIALTY_CARD_IDS[specialtyId] || [])
  ].filter((baseId) => DIRECT_DECK_CARD_IDS.has(baseId)));
}

function maxCopiesForCard(baseId) {
  return CARD_COPY_LIMITS[baseId] ?? 3;
}

function validateDeckDescriptor(ruleId, descriptor) {
  const rule = roomRuleDefinition(ruleId);
  const safeDescriptor = descriptor || {};
  const deckFormat = normalizeDeckFormat(safeDescriptor.deckFormat || "normal");
  const specialtyId = normalizeSpecialtyId(safeDescriptor.specialtyId || "");
  const errors = [];
  const illegalCardIds = [];
  const invalidCountIds = [];
  const copyOverages = [];
  let size = 0;
  let aceCount = 0;

  if (!rule) {
    return {
      valid: false,
      ruleId: String(ruleId || ""),
      deckFormat,
      specialtyId,
      size,
      errors: ["この部屋の対戦ルールが無効です。"],
      illegalCardIds,
      invalidCountIds,
      copyOverages,
      aceCount
    };
  }

  if (!rule.deck.formats.includes(deckFormat)) {
    errors.push(`${rule.name}ルールでは${rule.deck.formats.join("/")}デッキを選んでください。`);
  }

  const counts = safeDescriptor.deckCounts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    errors.push("デッキ内容がありません。");
  } else {
    const allowedSpecialtyCards = rule.deck.specialty === "required"
      ? specialtyAllowedCardIds(specialtyId)
      : null;
    if (rule.deck.specialty === "required" && !SPECIALTY_DEFINITIONS[specialtyId]) {
      errors.push("専攻デッキの専攻を選んでください。");
    }

    Object.entries(counts).forEach(([baseId, rawCount]) => {
      const count = Number(rawCount);
      if (!Number.isSafeInteger(count) || count < 0) {
        invalidCountIds.push(baseId);
        return;
      }
      if (count === 0) return;
      if (!DIRECT_DECK_CARD_IDS.has(baseId)) {
        illegalCardIds.push(baseId);
        return;
      }
      size += count;
      if (rule.deck.copyLimit === "standard" && count > maxCopiesForCard(baseId)) {
        copyOverages.push(baseId);
      }
      if (ACE_CARD_IDS.has(baseId)) aceCount += count;
      if (allowedSpecialtyCards && !allowedSpecialtyCards.has(baseId)) {
        illegalCardIds.push(baseId);
      }
    });
  }

  if (invalidCountIds.length) errors.push("デッキ枚数は0以上の整数で指定してください。");
  if (illegalCardIds.length) errors.push("直接編成できないカード、または選択した専攻に含まれないカードがあります。");
  if (copyOverages.length) errors.push("同名カードの枚数制限を超えています。");
  if (rule.deck.aceLimit !== null && aceCount > rule.deck.aceLimit) {
    errors.push("エースぺは1種類かつ1枚までです。");
  }
  if (size < rule.deck.minCards || size > rule.deck.maxCards) {
    const lengthLabel = rule.deck.minCards === rule.deck.maxCards
      ? `${rule.deck.minCards}枚`
      : `${rule.deck.minCards}〜${rule.deck.maxCards}枚`;
    errors.push(`デッキは${lengthLabel}にしてください。`);
  }

  return {
    valid: errors.length === 0,
    ruleId: rule.id,
    deckFormat,
    specialtyId,
    size,
    errors,
    illegalCardIds: [...new Set(illegalCardIds)],
    invalidCountIds,
    copyOverages: [...new Set(copyOverages)],
    aceCount
  };
}

function deckValidationForPlayer(room, player) {
  if (!room || !player || !isBattleRole(player.role)) {
    return { valid: false, errors: ["対戦者のデッキではありません。"] };
  }
  return validateDeckDescriptor(room.ruleId, player);
}

function deckValidationMessage(validation) {
  return validation?.errors?.[0] || "デッキが対戦ルールを満たしていません。";
}

function createSessionId() {
  return `srv-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createRandomRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    const roomId = `R${suffix}`;
    if (!rooms.has(roomId)) return roomId;
  }
  return `R${now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-8)}`;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function publicJsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function htmlResponse(res, statusCode, html) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isAdminAuthorized(req) {
  if (!LOG_ADMIN_PASSWORD) return false;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const password = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : decoded;
  const expected = Buffer.from(LOG_ADMIN_PASSWORD);
  const actual = Buffer.from(password);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function requireAdmin(req, res) {
  if (!LOG_ADMIN_PASSWORD) {
    htmlResponse(res, 503, adminPageShell(`
      <section class="panel">
        <h1>ログ管理は未設定です</h1>
        <p>Renderの環境変数に <code>CHIBATORU_LOG_ADMIN_PASSWORD</code> を設定すると、管理者だけがオンライン対戦ログを見られるようになります。</p>
      </section>
    `));
    return false;
  }
  if (isAdminAuthorized(req)) return true;
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="Chibatoru online logs", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end("管理者パスワードが必要です。");
  return false;
}

function safeLogFileName(gameId) {
  return String(gameId || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140);
}

function ensureLogDir() {
  fs.mkdirSync(LOG_STORAGE_DIR, { recursive: true });
}

function trimStoredLogs() {
  const logs = [...onlineBattleLogs.values()].sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  onlineBattleLogs.clear();
  logs.slice(0, MAX_STORED_LOGS).forEach((log) => onlineBattleLogs.set(log.gameId, log));
}

function writeLogToDisk(log) {
  try {
    ensureLogDir();
    const file = path.join(LOG_STORAGE_DIR, `${safeLogFileName(log.gameId)}.json`);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
  } catch (error) {
    console.warn("online log disk write skipped", error.message);
  }
}

function normalizeImportedLog(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const events = Array.isArray(raw.events) ? raw.events : [];
  const gameId = String(raw.gameId || events.find((event) => event?.gameId)?.gameId || "").slice(0, 160);
  if (!gameId) return null;
  const summary = raw.summary && typeof raw.summary === "object"
    ? { ...summarizeAnalyticsEvents(events), ...raw.summary }
    : summarizeAnalyticsEvents(events);
  return {
    ...raw,
    gameId,
    receivedAt: raw.receivedAt || new Date().toISOString(),
    protocolVersion: raw.protocolVersion || PROTOCOL_VERSION,
    final: Boolean(raw.final || summary.winner),
    summary,
    events
  };
}

function importOnlineBattleLogs(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.logs)
      ? payload.logs
      : payload?.gameId
        ? [payload]
        : [];
  let imported = 0;
  candidates.forEach((candidate) => {
    const log = normalizeImportedLog(candidate);
    if (!log) return;
    onlineBattleLogs.set(log.gameId, log);
    imported += 1;
  });
  trimStoredLogs();
  onlineBattleLogs.forEach((log) => writeLogToDisk(log));
  return imported;
}

function loadLogsFromDisk() {
  try {
    if (!fs.existsSync(LOG_STORAGE_DIR)) return;
    const files = fs.readdirSync(LOG_STORAGE_DIR)
      .filter((file) => file.endsWith(".json"))
      .slice(0, MAX_STORED_LOGS * 2);
    files.forEach((file) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(LOG_STORAGE_DIR, file), "utf8"));
        if (parsed?.gameId) onlineBattleLogs.set(parsed.gameId, parsed);
      } catch {}
    });
    trimStoredLogs();
  } catch (error) {
    console.warn("online log disk load skipped", error.message);
  }
}

function cardName(card) {
  return card?.cardName || card?.name || card?.cardId || card?.baseId || "";
}

function summarizeAnalyticsEvents(events) {
  const start = events.find((event) => event.eventType === "game_start")?.game || null;
  const final = [...events].reverse().find((event) => event.eventType === "game_end")?.final || null;
  const actions = events.filter((event) => event.eventType === "action");
  const effects = events.filter((event) => event.eventType === "effect");
  const playedCards = actions
    .filter((event) => ["play_card", "play_environment", "reserve_late", "evolve", "use_item"].includes(event.actionType))
    .map((event) => event.cardName || event.cardId)
    .filter(Boolean);
  const lethalCard = cardName(final?.lethalCard);
  return {
    mode: start?.mode || "",
    startedAt: start?.startedAt || "",
    finishedAt: final?.finishedAt || "",
    firstSide: start?.firstSide || "",
    winner: final?.winner || "",
    reason: final?.reason || "",
    finalTurn: final?.finalTurn ?? null,
    lethalCard,
    eventCount: events.length,
    actionCount: actions.length,
    effectCount: effects.length,
    deckNames: {
      player: start?.decks?.player?.deckName || "",
      opponent: start?.decks?.opponent?.deckName || ""
    },
    frequentlyPlayedCards: countTop(playedCards, 12)
  };
}

function countTop(values, limit) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function normalizeAnalyticsLog(room, player, payload) {
  const events = Array.isArray(payload.events) ? payload.events : [];
  const gameId = String(payload.gameId || events.find((event) => event.gameId)?.gameId || room.sessionId || createSessionId()).slice(0, 160);
  const summary = summarizeAnalyticsEvents(events);
  return {
    gameId,
    roomId: room.roomId,
    roomSessionId: room.sessionId,
    receivedAt: new Date().toISOString(),
    receivedFromRole: player.role,
    protocolVersion: PROTOCOL_VERSION,
    clientVersion: payload.version || "",
    final: Boolean(payload.final || summary.winner),
    summary,
    events
  };
}

function saveOnlineBattleLog(room, player, payload) {
  const log = normalizeAnalyticsLog(room, player, payload || {});
  onlineBattleLogs.set(log.gameId, log);
  trimStoredLogs();
  writeLogToDisk(log);
  return log;
}

function handleAnalyticsLog(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (player.role !== "host") {
    sendError(ws, "対戦ログはホストだけが送信できます。", "forbidden");
    return;
  }
  if (!room.started) return;
  const log = saveOnlineBattleLog(room, player, message);
  send(ws, {
    type: "analyticsLogSaved",
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    gameId: log.gameId,
    eventCount: log.summary.eventCount
  });
}

function listLogSummaries() {
  return [...onlineBattleLogs.values()]
    .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
    .map((log) => ({
      gameId: log.gameId,
      roomId: log.roomId,
      receivedAt: log.receivedAt,
      final: log.final,
      ...log.summary
    }));
}

function adminPageShell(body) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>チバトル 管理ログ</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f1f5f9;
      --panel: #ffffff;
      --ink: #122033;
      --muted: #536276;
      --line: #b8c3d3;
      --accent: #2457d6;
      --accent-soft: #dbeafe;
      --surface: #edf3f8;
      --panel-soft: #f8fbff;
      --teal: #0f766e;
      --amber: #b45309;
      --shadow: 0 10px 24px rgba(15, 23, 42, 0.1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(180deg, #f8fbff 0%, var(--surface) 58%, #e9eff6 100%);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Yu Gothic", YuGothic, sans-serif;
      line-height: 1.7;
    }
    .page { width: min(1160px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 56px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); padding: 22px; margin-bottom: 18px; }
    h1, h2, p { margin-top: 0; }
    h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.1; letter-spacing: 0; }
    h2 { letter-spacing: 0; }
    a { color: var(--accent); font-weight: 800; text-underline-offset: 3px; }
    code { background: var(--accent-soft); color: #14356f; border-radius: 5px; padding: 2px 6px; }
    table { width: 100%; border-collapse: collapse; min-width: 900px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: var(--panel-soft); color: #24364d; font-size: 13px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); scrollbar-gutter: stable; }
    .badge { display: inline-flex; min-height: 22px; align-items: center; padding: 3px 8px; border-radius: 999px; background: #ddf8e8; color: #166534; font-size: 12px; font-weight: 900; }
    .badge.pending { background: #fff2bf; color: var(--amber); }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .button { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: #ffffff; padding: 8px 14px; font: inherit; font-weight: 800; cursor: pointer; text-decoration: none; }
    .button.secondary { background: var(--accent-soft); color: var(--accent); }
    .button.backup { min-height: 46px; background: var(--teal); border-color: var(--teal); font-size: 17px; box-shadow: 0 8px 18px rgba(15, 118, 110, 0.18); }
    textarea { width: 100%; min-height: 320px; border: 1px solid var(--line); border-radius: 8px; background: #ffffff; color: var(--ink); padding: 12px; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; }
    .file-drop-zone { display: grid; min-height: 176px; place-items: center; border: 2px dashed #8aa7cd; border-radius: 8px; background: #f4f8ff; color: #29486f; padding: 24px; text-align: center; cursor: pointer; transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease; }
    .file-drop-zone:hover, .file-drop-zone:focus-visible, .file-drop-zone.drag-active { border-color: var(--accent); background: #e8f1ff; box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12); outline: none; }
    .file-drop-zone.loaded { border-style: solid; border-color: var(--teal); background: #ecfdf5; color: #166534; }
    .file-drop-zone strong { display: block; margin-bottom: 6px; font-size: 19px; }
    .file-drop-zone input { display: none; }
    .file-status { min-height: 28px; margin: 10px 0 0; font-weight: 700; }
    .file-status.error { color: #b42318; }
    .import-json-editor { margin-top: 18px; }
    .notice { border: 1px solid #9ec5fe; border-left: 5px solid var(--accent); border-radius: 8px; background: #eef6ff; color: #14356f; padding: 10px 12px; }
    .muted { color: var(--muted); }
  </style>
</head>
<body>
  <main class="page">${body}</main>
</body>
</html>`;
}

function renderAdminLogsPage() {
  const logs = listLogSummaries();
  const rows = logs.map((log) => `
    <tr>
      <td><a href="/admin/logs/${encodeURIComponent(log.gameId)}">${escapeHtml(log.gameId)}</a></td>
      <td>${escapeHtml(log.receivedAt)}</td>
      <td><span class="badge ${log.final ? "" : "pending"}">${log.final ? "終局" : "進行中"}</span></td>
      <td>${escapeHtml(log.winner || "-")}</td>
      <td>${escapeHtml(log.reason || "-")}</td>
      <td>${escapeHtml(log.deckNames?.player || "-")}<br><span class="muted">${escapeHtml(log.deckNames?.opponent || "-")}</span></td>
      <td>${escapeHtml(log.eventCount)}</td>
    </tr>
  `).join("");
  return adminPageShell(`
    <section class="panel">
      <h1>チバトル オンライン対戦ログ</h1>
      <p class="muted">管理者だけが見られるログ一覧です。プレイヤーの個人名は保存せず、カードバランス分析に必要な対戦イベントを保存します。</p>
      <p class="muted">保存先: <code>${escapeHtml(LOG_STORAGE_DIR)}</code></p>
      <p class="actions">
        <a class="button backup" href="/admin/logs/backup.json" download>バックアップJSONをダウンロード</a>
        <a class="button secondary" href="/admin/logs.json">JSON一覧を開く</a>
        <a class="button secondary" href="/admin/logs/import">JSONをインポート</a>
      </p>
      <p class="muted">更新や再デプロイの前は、まずバックアップJSONを保存してください。</p>
    </section>
    <section class="panel">
      <h2>保存済みログ ${logs.length}件</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>gameId</th><th>受信日時</th><th>状態</th><th>勝者</th><th>理由</th><th>デッキ</th><th>イベント数</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="7" class="muted">まだオンライン対戦ログはありません。</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `);
}

function renderAdminImportPage(message = "", kind = "muted") {
  return adminPageShell(`
    <section class="panel">
      <p><a href="/admin/logs">ログ一覧へ戻る</a></p>
      <h1>ログJSONインポート</h1>
      <p class="muted">「バックアップJSONをダウンロード」で保存したJSONの中身を貼り付けると、保存済みログを復元できます。</p>
      ${message ? `<p class="${kind === "ok" ? "notice" : "muted"}">${escapeHtml(message)}</p>` : ""}
    </section>
    <section class="panel">
      <form id="logImportForm" method="post" action="/admin/logs/import">
        <label class="file-drop-zone" id="logFileDropZone" for="logFileInput" tabindex="0">
          <input id="logFileInput" type="file" accept=".json,.jsonl,application/json,application/x-ndjson">
          <span>
            <strong>ログファイルをここにドロップ</strong>
            JSON・JSONLファイルを選択する場合は、ここをクリック
          </span>
        </label>
        <p class="file-status muted" id="logFileStatus" aria-live="polite">ファイルを読み込むと、下の欄で内容を確認できます。</p>
        <p class="import-json-editor"><textarea id="logsJson" name="logsJson" spellcheck="false" placeholder='{"logs":[...]}'></textarea></p>
        <p class="actions">
          <button class="button" type="submit">インポートする</button>
          <a class="button secondary" href="/admin/logs">キャンセル</a>
        </p>
      </form>
    </section>
    <script>
      (() => {
        const dropZone = document.getElementById("logFileDropZone");
        const fileInput = document.getElementById("logFileInput");
        const textarea = document.getElementById("logsJson");
        const status = document.getElementById("logFileStatus");
        const maxBytes = ${MAX_IMPORT_BYTES};
        let dragDepth = 0;

        function showStatus(text, isError = false) {
          status.textContent = text;
          status.classList.toggle("error", isError);
          status.classList.toggle("muted", !isError);
        }

        function normalizeJsonLines(text) {
          const events = text.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
          if (!events.length || events.some((event) => !event || typeof event !== "object" || Array.isArray(event))) {
            throw new Error("JSONLの対戦イベントを読み取れませんでした。");
          }
          const grouped = new Map();
          events.forEach((event) => {
            const gameId = String(event.gameId || "");
            if (!gameId) throw new Error("gameIdのないイベントが含まれています。");
            if (!grouped.has(gameId)) grouped.set(gameId, []);
            grouped.get(gameId).push(event);
          });
          const logs = [...grouped.entries()].map(([gameId, groupedEvents]) => ({ gameId, events: groupedEvents }));
          return logs.length === 1 ? logs[0] : { logs };
        }

        async function readLogFile(file) {
          if (!file) return;
          dropZone.classList.remove("loaded");
          if (file.size > maxBytes) {
            showStatus("ファイルが大きすぎます。8MB以下のファイルを選んでください。", true);
            return;
          }
          try {
            const rawText = await file.text();
            let payload;
            try {
              payload = JSON.parse(rawText);
            } catch {
              payload = normalizeJsonLines(rawText);
            }
            textarea.value = JSON.stringify(payload, null, 2);
            dropZone.classList.add("loaded");
            showStatus(file.name + " を読み込みました。内容を確認して「インポートする」を押してください。");
            textarea.focus();
          } catch (error) {
            showStatus("ファイルを読み取れませんでした: " + error.message, true);
          }
        }

        dropZone.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          fileInput.click();
        });
        fileInput.addEventListener("change", () => readLogFile(fileInput.files?.[0]));
        dropZone.addEventListener("dragenter", (event) => {
          event.preventDefault();
          dragDepth += 1;
          dropZone.classList.add("drag-active");
        });
        dropZone.addEventListener("dragover", (event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        });
        dropZone.addEventListener("dragleave", (event) => {
          event.preventDefault();
          dragDepth = Math.max(0, dragDepth - 1);
          if (!dragDepth) dropZone.classList.remove("drag-active");
        });
        dropZone.addEventListener("drop", (event) => {
          event.preventDefault();
          dragDepth = 0;
          dropZone.classList.remove("drag-active");
          readLogFile(event.dataTransfer?.files?.[0]);
        });
      })();
    </script>
  `);
}

function renderAdminLogDetail(log) {
  const topCards = (log.summary.frequentlyPlayedCards || [])
    .map((card) => `<span class="badge">${escapeHtml(card.name)} ${escapeHtml(card.count)}</span>`)
    .join(" ");
  return adminPageShell(`
    <section class="panel">
      <p><a href="/admin/logs">ログ一覧へ戻る</a></p>
      <h1>${escapeHtml(log.gameId)}</h1>
      <p class="muted">受信日時: ${escapeHtml(log.receivedAt)} / 部屋: ${escapeHtml(log.roomId)}</p>
      <p>
        <a href="/admin/logs/${encodeURIComponent(log.gameId)}.json">JSONで開く</a>
        ・
        <a href="/admin/logs/${encodeURIComponent(log.gameId)}.jsonl">JSONLで開く</a>
      </p>
    </section>
    <section class="panel">
      <h2>概要</h2>
      <p>勝者: <strong>${escapeHtml(log.summary.winner || "-")}</strong></p>
      <p>理由: ${escapeHtml(log.summary.reason || "-")}</p>
      <p>最終ターン: ${escapeHtml(log.summary.finalTurn ?? "-")} / リーサル: ${escapeHtml(log.summary.lethalCard || "-")}</p>
      <p>デッキ: ${escapeHtml(log.summary.deckNames?.player || "-")} vs ${escapeHtml(log.summary.deckNames?.opponent || "-")}</p>
      <p>よく使われたカード: ${topCards || '<span class="muted">なし</span>'}</p>
    </section>
    <section class="panel">
      <h2>イベント</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>種類</th><th>ターン</th><th>side</th><th>カード</th><th>内容</th></tr></thead>
          <tbody>${log.events.map((event) => `
            <tr>
              <td>${escapeHtml(event.eventSeq || "")}</td>
              <td>${escapeHtml(event.eventType || "")}</td>
              <td>${escapeHtml(event.turn || "")}</td>
              <td>${escapeHtml(event.side || "")}</td>
              <td>${escapeHtml(event.cardName || event.source?.cardName || "")}</td>
              <td><code>${escapeHtml(JSON.stringify(compactEventForTable(event)))}</code></td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    </section>
  `);
}

function compactEventForTable(event) {
  if (event.eventType === "action") return {
    actionType: event.actionType,
    targetZone: event.targetZone,
    targetSeat: event.targetSeat,
    targetCardId: event.targetCardId
  };
  if (event.eventType === "effect") return {
    effectType: event.effectType,
    drawCount: event.drawCount,
    chosenTargets: event.chosenTargets,
    damageDistribution: event.damageDistribution
  };
  if (event.eventType === "game_end") return event.final;
  return {};
}

function findLogByPath(pathname) {
  const match = pathname.match(/^\/admin\/logs\/([^/]+?)(?:\.(jsonl|json))?$/);
  if (!match) return { log: null, format: "" };
  const gameId = decodeURIComponent(match[1]);
  return { log: onlineBattleLogs.get(gameId) || null, format: match[2] || "html" };
}

function readBody(req, onDone) {
  let body = "";
  let tooLarge = false;
  let done = false;
  function finish(error, value) {
    if (done) return;
    done = true;
    onDone(error, value);
  }
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > MAX_IMPORT_BYTES) {
      tooLarge = true;
      req.destroy();
    }
  });
  req.on("end", () => finish(null, body));
  req.on("error", (error) => finish(tooLarge ? new Error("インポートJSONが大きすぎます。") : error));
}

function handleAdminLogsJson(req, res) {
  if (!requireAdmin(req, res)) return;
  jsonResponse(res, 200, { logs: listLogSummaries() });
}

function backupFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `chibatoru-online-logs-${stamp}.json`;
}

function buildAdminLogsBackupPayload() {
  return {
    exportedAt: new Date().toISOString(),
    count: onlineBattleLogs.size,
    logs: [...onlineBattleLogs.values()]
      .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
  };
}

function handleAdminLogsBackupJson(req, res) {
  if (!requireAdmin(req, res)) return;
  const body = JSON.stringify(buildAdminLogsBackupPayload(), null, 2);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${backupFileName()}"`,
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function handleAdminLogsImport(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    htmlResponse(res, 200, renderAdminImportPage());
    return;
  }
  if (req.method !== "POST") {
    htmlResponse(res, 405, renderAdminImportPage("インポートはPOSTだけ対応しています。"));
    return;
  }
  readBody(req, (error, body) => {
    if (error) {
      htmlResponse(res, 400, renderAdminImportPage(error.message));
      return;
    }
    try {
      const contentType = req.headers["content-type"] || "";
      const jsonText = contentType.includes("application/x-www-form-urlencoded")
        ? new URLSearchParams(body).get("logsJson")
        : body;
      const payload = JSON.parse(jsonText || "");
      const imported = importOnlineBattleLogs(payload);
      htmlResponse(res, 200, renderAdminImportPage(`${imported}件のログをインポートしました。`, "ok"));
    } catch (parseError) {
      htmlResponse(res, 400, renderAdminImportPage(`JSONを読み取れませんでした: ${parseError.message}`));
    }
  });
}

function handleAdminLogsRequest(req, res, url) {
  if (!requireAdmin(req, res)) return;
  if (url.pathname === "/admin/logs") {
    htmlResponse(res, 200, renderAdminLogsPage());
    return;
  }
  if (url.pathname === "/admin/logs/import") {
    handleAdminLogsImport(req, res);
    return;
  }
  const { log, format } = findLogByPath(url.pathname);
  if (!log) {
    htmlResponse(res, 404, adminPageShell(`<section class="panel"><h1>ログが見つかりません</h1><p><a href="/admin/logs">一覧へ戻る</a></p></section>`));
    return;
  }
  if (format === "json") {
    jsonResponse(res, 200, log);
    return;
  }
  if (format === "jsonl") {
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(`${log.events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    return;
  }
  htmlResponse(res, 200, renderAdminLogDetail(log));
}

function send(ws, message) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify({
    protocol: PROTOCOL_VERSION,
    sentAt: now(),
    ...message
  }));
  return true;
}

function sendError(ws, message, code = "bad_request") {
  send(ws, { type: "error", code, message, senderId: SERVER_ID });
}

function normalizeCardStyles(cardStyles) {
  if (!cardStyles || typeof cardStyles !== "object" || Array.isArray(cardStyles)) return {};
  return Object.fromEntries(Object.entries(cardStyles)
    .filter(([baseId, mode]) => /^[a-z0-9_]{1,80}$/i.test(baseId) && mode === "reward")
    .slice(0, 64));
}

function playerPublicState(player, room = null) {
  const validation = room && isBattleRole(player.role)
    ? deckValidationForPlayer(room, player)
    : null;
  return {
    clientId: player.clientId,
    role: player.role,
    deckName: player.role === "spectator" ? "" : (player.deckName || "__current"),
    deckFormat: player.role === "spectator" ? "" : normalizeDeckFormat(player.deckFormat || "normal"),
    specialtyId: player.role === "spectator" ? "" : normalizeSpecialtyId(player.specialtyId || ""),
    deckValid: player.role === "spectator" ? false : Boolean(validation?.valid),
    deckValidationErrors: player.role === "spectator" ? [] : (validation?.errors || []),
    cardStyles: player.role === "spectator" ? {} : (player.cardStyles || {}),
    ready: player.role === "spectator" ? false : Boolean(player.ready)
  };
}

function roomPlayers(room) {
  return [...room.players.values()].map((player) => playerPublicState(player, room));
}

// Deck contents are needed by the authoritative host to create the initial
// game snapshot, but are not part of ordinary public room state.  Re-send the
// guest descriptor whenever either player joins/rejoins so a stale descriptor
// can never be used after a disconnect.
function privateDeckUpdateMessage(room, deckOwner) {
  if (!room || !deckOwner || !isBattleRole(deckOwner.role)) return null;
  const validation = deckValidationForPlayer(room, deckOwner);
  return {
    type: "privateDeckUpdate",
    senderId: SERVER_ID,
    roomId: room.roomId,
    roomSessionId: room.sessionId,
    ruleId: room.ruleId,
    playerId: deckOwner.clientId,
    deckOwnerId: deckOwner.clientId,
    deckName: deckOwner.deckName || "__current",
    deckFormat: normalizeDeckFormat(deckOwner.deckFormat || "normal"),
    specialtyId: normalizeSpecialtyId(deckOwner.specialtyId || ""),
    deckCounts: deckOwner.deckCounts || null,
    cardStyles: deckOwner.cardStyles || {},
    ready: Boolean(deckOwner.ready),
    deckValid: Boolean(validation?.valid),
    deckValidationErrors: validation?.errors || []
  };
}

function sendPrivateDeckUpdateToHost(room, deckOwner) {
  const host = hostOf(room);
  if (!host || !deckOwner || host.clientId === deckOwner.clientId) return false;
  const message = privateDeckUpdateMessage(room, deckOwner);
  return message ? send(host.ws, message) : false;
}

function syncPrivateGuestDeckToHost(room) {
  const host = hostOf(room);
  const guest = guestOf(room);
  if (!host || !guest) return false;
  return sendPrivateDeckUpdateToHost(room, guest);
}

function isBattleRole(role) {
  return role === "host" || role === "guest";
}

function battlePlayers(room) {
  return [...room.players.values()].filter((player) => isBattleRole(player.role));
}

function roomHasOpponent(room, role) {
  if (role === "spectator") return battlePlayers(room).length === 2;
  return battlePlayers(room).some((player) => player.role !== role);
}

function publicRoomState(room) {
  const host = hostOf(room);
  const guest = guestOf(room);
  return {
    roomId: room.roomId,
    matchType: room.matchType || "private",
    ruleId: room.ruleId,
    roomRule: publicRoomRule(room.ruleId),
    started: Boolean(room.started),
    players: battlePlayers(room).length,
    spectators: [...room.players.values()].filter((player) => player.role === "spectator").length,
    hostReady: Boolean(host?.ready),
    guestReady: Boolean(guest?.ready),
    updatedAt: room.updatedAt,
    createdAt: room.createdAt
  };
}

function listSpectatableRooms() {
  return [...rooms.values()]
    .filter((room) => room.started && hostOf(room) && guestOf(room))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(publicRoomState);
}

function handlePublicRoomsJson(res) {
  publicJsonResponse(res, 200, {
    rooms: listSpectatableRooms(),
    generatedAt: now()
  });
}

function broadcast(room, message, exceptClientId = "") {
  room.players.forEach((player) => {
    if (player.clientId === exceptClientId) return;
    send(player.ws, message);
  });
}

function hostOf(room) {
  return [...room.players.values()].find((player) => player.role === "host") || null;
}

function guestOf(room) {
  return [...room.players.values()].find((player) => player.role === "guest") || null;
}

function createRoom(roomId, sessionId = "", matchType = "private") {
  return {
    roomId,
    sessionId: sessionId || createSessionId(),
    matchType,
    ruleId: DEFAULT_ROOM_RULE_ID,
    players: new Map(),
    started: false,
    state: null,
    currentTurn: "",
    snapshotSeq: 0,
    pendingCommands: new Map(),
    processedCommandIds: [],
    waitingTimer: null,
    createdAt: now(),
    updatedAt: now()
  };
}

function removeRandomQueueRoom(roomId) {
  let index = randomMatchQueue.length;
  while (index > 0) {
    index -= 1;
    if (randomMatchQueue[index] === roomId) randomMatchQueue.splice(index, 1);
  }
}

function pruneRandomMatchQueue() {
  let index = randomMatchQueue.length;
  while (index > 0) {
    index -= 1;
    const room = rooms.get(randomMatchQueue[index]);
    if (!room || room.matchType !== "random" || room.started || guestOf(room) || !hostOf(room)) {
      randomMatchQueue.splice(index, 1);
    }
  }
}

function findRandomWaitingRoom(clientId) {
  pruneRandomMatchQueue();
  return randomMatchQueue
    .map((roomId) => rooms.get(roomId))
    .find((room) => {
      const host = hostOf(room);
      return room && host && host.clientId !== clientId && !guestOf(room) && !room.started;
    }) || null;
}

function clearPendingCommand(room, commandId) {
  const pending = room?.pendingCommands?.get(commandId);
  if (!pending) return null;
  if (pending.timer) clearTimeout(pending.timer);
  room.pendingCommands.delete(commandId);
  return pending;
}

function clearAllPendingCommands(room) {
  if (!room?.pendingCommands) return;
  [...room.pendingCommands.keys()].forEach((commandId) => clearPendingCommand(room, commandId));
}

function rememberProcessedCommand(room, commandId) {
  if (!commandId || room.processedCommandIds.includes(commandId)) return;
  room.processedCommandIds.push(commandId);
  while (room.processedCommandIds.length > PROCESSED_COMMAND_LIMIT) room.processedCommandIds.shift();
}

function sendLatestState(room, ws) {
  if (!room?.state || !ws) return;
  const player = [...room.players.values()].find((entry) => entry.ws === ws) || null;
  sendSnapshotMessage(room, player, "gameState");
}

// The host remains authoritative and therefore retains its complete state.
// Other recipients only receive card backs for hands they are not allowed to
// inspect. Keeping an array of opaque placeholders preserves hand counts for
// the client UI without leaking a base ID, name, instance ID, or card state.
function hiddenHandPlaceholders(hand) {
  return Array.isArray(hand) ? hand.map(() => ({ hidden: true })) : [];
}

function snapshotForRecipient(snapshot, recipient) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const hiddenSides = recipient?.role === "guest"
    ? ["player"]
    : recipient?.role === "spectator"
      ? ["player", "opponent"]
      : [];
  if (hiddenSides.length === 0) return snapshot;

  const copy = JSON.parse(JSON.stringify(snapshot));
  const players = copy?.state?.players;
  if (!players || typeof players !== "object") return copy;
  hiddenSides.forEach((side) => {
    if (Array.isArray(players[side]?.hand)) {
      players[side].hand = hiddenHandPlaceholders(players[side].hand);
    }
  });
  return copy;
}

function sendSnapshotMessage(room, recipient, type, extra = {}) {
  if (!room?.state || !recipient?.ws) return false;
  return send(recipient.ws, {
    type,
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    ...extra,
    snapshot: snapshotForRecipient(room.state, recipient)
  });
}

function broadcastSnapshotMessage(room, type, extra = {}, exceptClientId = "") {
  room.players.forEach((recipient) => {
    if (recipient.clientId === exceptClientId) return;
    sendSnapshotMessage(room, recipient, type, extra);
  });
}

function sendCommandProcessed(room, player, commandId) {
  if (!player || !commandId) return;
  send(player.ws, {
    type: "commandProcessed",
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    commandId,
    snapshotSeq: room.snapshotSeq
  });
}

function failPendingCommand(room, commandId) {
  const pending = clearPendingCommand(room, commandId);
  if (!pending) return;
  const sender = room.players.get(pending.senderId);
  if (!sender) return;
  sendError(sender.ws, "操作の同期を確認できませんでした。最新状態へ再同期します。", "command_timeout");
  sendLatestState(room, sender.ws);
}

function deliverPendingCommand(room, commandId) {
  const pending = room?.pendingCommands?.get(commandId);
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  if (pending.attempts >= COMMAND_MAX_ATTEMPTS) {
    failPendingCommand(room, commandId);
    return;
  }
  pending.attempts += 1;
  const host = hostOf(room);
  if (host) {
    send(host.ws, {
      type: "command",
      senderId: pending.senderId,
      roomSessionId: room.sessionId,
      command: pending.command,
      deliveryAttempt: pending.attempts
    });
  }
  pending.timer = setTimeout(() => deliverPendingCommand(room, commandId), COMMAND_RETRY_MS);
  pending.timer.unref?.();
}

function completePendingCommand(room, commandId) {
  if (!commandId) return;
  const pending = clearPendingCommand(room, commandId);
  rememberProcessedCommand(room, commandId);
  if (!pending) return;
  sendCommandProcessed(room, room.players.get(pending.senderId), commandId);
}

function clearWaitingRoomTimer(room) {
  if (!room?.waitingTimer) return;
  clearTimeout(room.waitingTimer);
  room.waitingTimer = null;
}

function closeWaitingRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.started || guestOf(room)) return;
  const host = hostOf(room);
  if (!host) return;
  room.players.forEach((player) => {
    sendError(player.ws, "5分間相手が入室しなかったため、部屋を閉じました。もう一度部屋を作ってください。", "room_timeout");
  });
  clearWaitingRoomTimer(room);
  clearAllPendingCommands(room);
  removeRandomQueueRoom(roomId);
  rooms.delete(roomId);
  room.players.forEach((player) => {
    try { player.ws.close(4002, "room_timeout"); } catch {}
  });
}

function refreshWaitingRoomTimer(room) {
  if (!room) return;
  clearWaitingRoomTimer(room);
  if (room.started || guestOf(room) || !hostOf(room)) return;
  room.waitingTimer = setTimeout(() => closeWaitingRoom(room.roomId), WAITING_ROOM_TIMEOUT_MS);
  room.waitingTimer.unref?.();
}

function roomPlayerJoinedMessage(room, player = null) {
  return {
    type: "playerJoined",
    senderId: SERVER_ID,
    roomId: room.roomId,
    roomSessionId: room.sessionId,
    matchType: room.matchType || "private",
    ruleId: room.ruleId,
    roomRule: publicRoomRule(room.ruleId),
    you: player ? playerPublicState(player, room) : null,
    players: roomPlayers(room),
    hasOpponent: player
      ? roomHasOpponent(room, player.role)
      : battlePlayers(room).length === 2,
    started: room.started
  };
}

function roomStateMessage(room, options = {}) {
  const host = hostOf(room);
  const guest = guestOf(room);
  const message = {
    type: "roomState",
    senderId: options.senderId || SERVER_ID,
    roomId: room.roomId,
    roomSessionId: room.sessionId,
    matchType: room.matchType || "private",
    ruleId: room.ruleId,
    roomRule: publicRoomRule(room.ruleId),
    players: roomPlayers(room),
    hostReady: Boolean(host?.ready),
    guestReady: Boolean(guest?.ready),
    hostDeckName: host?.deckName || "",
    guestDeckName: guest?.deckName || "",
    hostDeckFormat: host?.deckFormat || "normal",
    guestDeckFormat: guest?.deckFormat || "normal",
    hostSpecialtyId: host?.specialtyId || "",
    guestSpecialtyId: guest?.specialtyId || "",
    hostDeckValid: Boolean(host && deckValidationForPlayer(room, host).valid),
    guestDeckValid: Boolean(guest && deckValidationForPlayer(room, guest).valid),
    status: typeof options.status === "string" ? options.status.slice(0, 240) : ""
  };
  if (Number.isSafeInteger(Number(options.roomStateSeq))) {
    message.roomStateSeq = Number(options.roomStateSeq);
  }
  return message;
}

function broadcastRoomState(room, options = {}, exceptClientId = "") {
  broadcast(room, roomStateMessage(room, options), exceptClientId);
}

function revalidateRoomPlayers(room) {
  battlePlayers(room).forEach((player) => {
    if (!deckValidationForPlayer(room, player).valid) player.ready = false;
  });
}

function sideForRole(role) {
  if (role === "host") return "player";
  if (role === "guest") return "opponent";
  return "";
}

function snapshotCurrentTurn(snapshot) {
  const currentSide = snapshot?.state?.currentSide;
  return currentSide === "player" || currentSide === "opponent" ? currentSide : "";
}

function commandFromMessage(message) {
  if (message.command && typeof message.command === "object") return message.command;
  return {
    id: message.msgId || "",
    type: message.type,
    payload: message.payload || {},
    createdAt: message.sentAt || now()
  };
}

function validateTurnCommand(room, player, commandType) {
  if (!room.started) return "対戦がまだ開始されていません。";
  const allowedBeforeTurn = new Set(["rps", "order", "mulligan", "concede"]);
  if (allowedBeforeTurn.has(commandType)) return "";
  if (!room.currentTurn) return "";
  if (room.currentTurn !== sideForRole(player.role)) {
    return "現在はあなたのターンではありません。";
  }
  return "";
}

function cleanupRooms() {
  const cutoff = now() - ROOM_TTL_MS;
  rooms.forEach((room, roomId) => {
    if (room.players.size === 0 && room.updatedAt < cutoff) {
      clearAllPendingCommands(room);
      removeRandomQueueRoom(roomId);
      rooms.delete(roomId);
    }
  });
  pruneRandomMatchQueue();
}

function joinRoom(ws, message) {
  const roomId = normalizeRoomId(message.roomId);
  const clientId = String(message.clientId || "").slice(0, 80);
  const wantsSpectator = message.spectate === true || message.role === "spectator";
  if (!ROOM_CODE_PATTERN.test(roomId)) {
    sendError(ws, "部屋コードは4〜12文字の英数字で指定してください。", "invalid_room");
    return;
  }
  if (!clientId) {
    sendError(ws, "clientId がありません。", "invalid_client");
    return;
  }

  let room = rooms.get(roomId);
  if (!room && !message.create) {
    sendError(ws, "部屋が見つかりません。部屋コードを確認してください。", "room_not_found");
    return;
  }
  if (wantsSpectator && (!room || !room.started || battlePlayers(room).length < 2)) {
    sendError(ws, "この部屋はまだ観戦できません。対戦中の部屋を選んでください。", "not_spectatable");
    return;
  }
  if (!room) {
    room = createRoom(roomId, message.roomSessionId || createSessionId(), message.matchType === "random" ? "random" : "private");
    rooms.set(roomId, room);
  }

  const existing = room.players.get(clientId);
  let role = existing?.role || "";
  if (!role) {
    if (wantsSpectator) {
      role = "spectator";
    } else if (message.create && ![...room.players.values()].some((player) => player.role === "host")) {
      role = "host";
    } else if (![...room.players.values()].some((player) => player.role === "guest")) {
      role = "guest";
    } else {
      role = "spectator";
    }
  }

  if (existing?.ws && existing.ws !== ws) {
    try { existing.ws.close(4001, "replaced"); } catch {}
  }

  const descriptor = role === "spectator" ? null : deckDescriptorFromMessage(message, existing);
  const descriptorValidation = descriptor ? validateDeckDescriptor(room.ruleId, descriptor) : null;
  const player = {
    clientId,
    role,
    ws,
    ready: role === "spectator" ? false : (Boolean(message.ready) && Boolean(descriptorValidation?.valid)),
    deckName: role === "spectator"
      ? ""
      : (hasOwn(message, "deckName") ? (message.deckName || "__current") : (existing?.deckName || "__current")),
    deckFormat: role === "spectator" ? "" : descriptor.deckFormat,
    specialtyId: role === "spectator" ? "" : descriptor.specialtyId,
    deckCounts: role === "spectator" ? null : descriptor.deckCounts,
    cardStyles: role === "spectator" ? {} : normalizeCardStyles(message.cardStyles ?? existing?.cardStyles),
    joinedAt: existing?.joinedAt || now(),
    lastSeenAt: now()
  };
  room.players.set(clientId, player);
  room.updatedAt = now();
  ws.roomId = roomId;
  ws.clientId = clientId;

  const joinedMessage = roomPlayerJoinedMessage(room, player);
  send(ws, joinedMessage);
  broadcast(room, joinedMessage, clientId);
  syncPrivateGuestDeckToHost(room);
  if (room.state) {
    sendSnapshotMessage(room, player, "gameState");
  }
  if (role === "host" && room.started) {
    room.pendingCommands.forEach((_pending, commandId) => deliverPendingCommand(room, commandId));
  }
  if (room.matchType === "random") {
    if (guestOf(room)) {
      removeRandomQueueRoom(room.roomId);
    } else if (role === "host" && !randomMatchQueue.includes(room.roomId)) {
      randomMatchQueue.push(room.roomId);
    }
  }
  refreshWaitingRoomTimer(room);
}

function handleRandomMatch(ws, message) {
  const clientId = String(message.clientId || "").slice(0, 80);
  if (!clientId) {
    sendError(ws, "clientId がありません。", "invalid_client");
    return;
  }

  const waitingRoom = findRandomWaitingRoom(clientId);
  if (waitingRoom) {
    removeRandomQueueRoom(waitingRoom.roomId);
    joinRoom(ws, {
      ...message,
      type: "joinRoom",
      roomId: waitingRoom.roomId,
      create: false,
      matchType: "random"
    });
    return;
  }

  const roomId = createRandomRoomId();
  joinRoom(ws, {
    ...message,
    type: "joinRoom",
    roomId,
    create: true,
    roomSessionId: message.roomSessionId || createSessionId(),
    matchType: "random"
  });
  pruneRandomMatchQueue();
}

function requireJoined(ws) {
  const room = rooms.get(ws.roomId);
  const player = room?.players.get(ws.clientId);
  if (!room || !player) {
    sendError(ws, "部屋に参加していません。", "not_joined");
    return {};
  }
  player.lastSeenAt = now();
  room.updatedAt = now();
  return { room, player };
}

function handleDeckUpdate(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (!isBattleRole(player.role)) {
    sendError(ws, "観戦者はデッキや準備状態を変更できません。", "forbidden");
    return;
  }
  const descriptor = deckDescriptorFromMessage(message, player);
  const validation = validateDeckDescriptor(room.ruleId, descriptor);
  const requestedReady = Boolean(message.ready);
  player.deckName = hasOwn(message, "deckName") ? (message.deckName || "__current") : (player.deckName || "__current");
  player.deckFormat = descriptor.deckFormat;
  player.specialtyId = descriptor.specialtyId;
  player.deckCounts = descriptor.deckCounts;
  player.cardStyles = normalizeCardStyles(message.cardStyles ?? player.cardStyles);
  player.ready = requestedReady && validation.valid;
  room.updatedAt = now();
  broadcast(room, {
    type: "deckUpdate",
    senderId: player.clientId,
    roomSessionId: room.sessionId,
    roomId: room.roomId,
    ruleId: room.ruleId,
    roomRule: publicRoomRule(room.ruleId),
    deckName: player.deckName,
    deckFormat: player.deckFormat,
    specialtyId: player.specialtyId,
    deckCounts: player.deckCounts,
    cardStyles: player.cardStyles,
    ready: player.ready,
    deckValid: validation.valid,
    deckValidationErrors: validation.errors
  }, player.clientId);
  // The host receives the deck descriptor through a recipient-only message.
  // This is also the path used after a guest reconnects.
  sendPrivateDeckUpdateToHost(room, player);
  broadcast(room, roomPlayerJoinedMessage(room));
  if (requestedReady && !validation.valid) {
    sendError(ws, deckValidationMessage(validation), "invalid_deck");
  }
}

function handleSetRoomRule(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (player.role !== "host") {
    sendError(ws, "対戦ルールはホストだけが変更できます。", "forbidden");
    return;
  }
  if (room.started) {
    sendError(ws, "対戦開始後に対戦ルールは変更できません。", "game_started");
    return;
  }
  const ruleId = String(message.ruleId || "").trim();
  const rule = roomRuleDefinition(ruleId);
  if (!rule) {
    sendError(ws, "指定された対戦ルールは存在しません。", "invalid_rule");
    return;
  }
  room.ruleId = rule.id;
  revalidateRoomPlayers(room);
  room.updatedAt = now();
  const host = hostOf(room);
  const guest = guestOf(room);
  broadcast(room, {
    type: "roomRuleChanged",
    senderId: SERVER_ID,
    roomId: room.roomId,
    roomSessionId: room.sessionId,
    matchType: room.matchType || "private",
    ruleId: room.ruleId,
    roomRule: publicRoomRule(room.ruleId),
    players: roomPlayers(room),
    hostReady: Boolean(host?.ready),
    guestReady: Boolean(guest?.ready),
    hasOpponent: battlePlayers(room).length === 2,
    started: room.started
  });
  broadcastRoomState(room, {
    status: `ホストが対戦ルールを「${rule.name}」に変更しました。`
  });
}

function handleRoomState(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (player.role !== "host") {
    sendError(ws, "部屋状態はホストだけが送信できます。", "forbidden");
    return;
  }
  broadcastRoomState(room, {
    senderId: player.clientId,
    roomStateSeq: message.roomStateSeq,
    status: message.status
  }, player.clientId);
}

function handleStartGame(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (player.role !== "host") {
    sendError(ws, "対戦開始はホストだけが実行できます。", "forbidden");
    return;
  }
  const joinedBattlePlayers = battlePlayers(room);
  if (joinedBattlePlayers.length !== 2) {
    sendError(ws, "2人そろうまで開始できません。", "not_ready");
    return;
  }
  revalidateRoomPlayers(room);
  const allReady = joinedBattlePlayers.every((joinedPlayer) =>
    joinedPlayer.ready && validateDeckDescriptor(room.ruleId, joinedPlayer).valid);
  if (!allReady) {
    broadcast(room, roomPlayerJoinedMessage(room));
    sendError(ws, "2人とも現在の対戦ルールで有効なデッキを選び、準備OKにしてください。", "not_ready");
    return;
  }
  if (!message.snapshot) {
    sendError(ws, "開始時のゲーム状態がありません。", "invalid_state");
    return;
  }
  room.started = true;
  clearWaitingRoomTimer(room);
  room.state = message.snapshot;
  room.snapshotSeq = Math.max(room.snapshotSeq, Number(message.snapshot.seq) || 0);
  room.currentTurn = snapshotCurrentTurn(message.snapshot);
  room.updatedAt = now();
  broadcastSnapshotMessage(room, "startGame", {
    ruleId: room.ruleId,
    roomRule: publicRoomRule(room.ruleId),
    players: roomPlayers(room)
  });
  broadcastSnapshotMessage(room, "gameState", { ruleId: room.ruleId });
}

function handleGameState(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (player.role !== "host") {
    sendError(ws, "ゲーム状態はホストだけが更新できます。", "forbidden");
    return;
  }
  if (!room.started || !message.snapshot) return;
  const seq = Number(message.snapshot.seq) || 0;
  if (seq && seq < room.snapshotSeq) return;
  room.state = message.snapshot;
  room.snapshotSeq = Math.max(room.snapshotSeq, seq);
  room.currentTurn = snapshotCurrentTurn(message.snapshot) || room.currentTurn;
  room.updatedAt = now();
  const processedCommandId = String(message.processedCommandId || "").slice(0, 120);
  broadcastSnapshotMessage(room, "gameState", { processedCommandId }, player.clientId);
  completePendingCommand(room, processedCommandId);
}

function handlePlayerCommand(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (!isBattleRole(player.role)) {
    sendError(ws, "観戦者は対戦を操作できません。", "forbidden");
    return;
  }
  const command = commandFromMessage(message);
  const commandType = command.type || message.type;
  const commandId = String(command.id || "").slice(0, 120);
  if (!commandId) {
    sendError(ws, "操作IDがありません。", "invalid_command");
    return;
  }
  if (player.role === "host") return;
  if (room.processedCommandIds.includes(commandId)) {
    sendLatestState(room, player.ws);
    sendCommandProcessed(room, player, commandId);
    return;
  }
  if (room.pendingCommands.has(commandId)) {
    deliverPendingCommand(room, commandId);
    return;
  }
  const validationError = validateTurnCommand(room, player, commandType);
  if (validationError) {
    sendError(ws, validationError, "invalid_turn");
    const authoritativeHost = hostOf(room);
    if (authoritativeHost) {
      send(authoritativeHost.ws, {
        type: "syncRequest",
        senderId: SERVER_ID,
        roomSessionId: room.sessionId,
        reason: "turn_validation"
      });
    }
    return;
  }
  const host = hostOf(room);
  if (!host) {
    sendError(ws, "ホストがいません。", "host_missing");
    return;
  }
  if (commandType === "endTurn") {
    const existingEndTurn = [...room.pendingCommands.values()].find((pending) =>
      pending.senderId === player.clientId && pending.command.type === "endTurn");
    if (existingEndTurn) {
      send(ws, {
        type: "commandPending",
        senderId: SERVER_ID,
        roomSessionId: room.sessionId,
        commandId: existingEndTurn.command.id
      });
      return;
    }
  }
  const pendingForPlayer = [...room.pendingCommands.values()].filter((pending) =>
    pending.senderId === player.clientId).length;
  if (pendingForPlayer >= MAX_PENDING_COMMANDS_PER_PLAYER) {
    sendError(ws, "未処理の操作が多すぎます。同期完了を待ってください。", "too_many_pending_commands");
    return;
  }
  room.pendingCommands.set(commandId, {
    command: { ...command, id: commandId },
    senderId: player.clientId,
    attempts: 0,
    timer: null
  });
  deliverPendingCommand(room, commandId);
}

function handlePrivateChoiceRelay(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (!room.started) {
    sendError(ws, "対戦がまだ開始されていません。", "not_started");
    return;
  }
  if (!isBattleRole(player.role)) {
    sendError(ws, "観戦者は選択効果を送信できません。", "forbidden");
    return;
  }
  const isRequest = String(message.type || "").endsWith("Request");
  const target = isRequest ? guestOf(room) : hostOf(room);
  if (isRequest && player.role !== "host") {
    sendError(ws, "選択依頼はホストだけが送信できます。", "forbidden");
    return;
  }
  if (!isRequest && player.role !== "guest") {
    sendError(ws, "選択結果はゲストだけが送信できます。", "forbidden");
    return;
  }
  if (!target) {
    sendError(ws, "選択効果の送信先が見つかりません。", "target_missing");
    return;
  }
  send(target.ws, { ...message, senderId: player.clientId, roomSessionId: room.sessionId });
}

function handleOneEyedPeekReveal(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (!room.started) {
    sendError(ws, "対戦がまだ開始されていません。", "not_started");
    return;
  }
  if (player.role !== "host") {
    sendError(ws, "片目カンニングの公開情報はホストが送信します。", "forbidden");
    return;
  }
  if (message.sourceBaseId !== "one_eyed_peek") {
    sendError(ws, "片目カンニング以外の非公開公開メッセージは送信できません。", "invalid_reveal");
    return;
  }
  const guest = guestOf(room);
  if (!guest) {
    sendError(ws, "公開先の相手が見つかりません。", "target_missing");
    return;
  }
  // Derive the reveal from the authoritative snapshot instead of trusting a
  // client-provided card list. This message is deliberately sent only to the
  // guest who used the effect; observers never receive it.
  const hand = room.state?.state?.players?.player?.hand;
  send(guest.ws, {
    type: "oneEyedPeekReveal",
    senderId: player.clientId,
    roomSessionId: room.sessionId,
    cards: Array.isArray(hand) ? hand : []
  });
}

function handleReturnRoom(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  const guestCanReturnAfterGame = player.role === "guest" && Boolean(room.state?.state?.gameOver);
  if (player.role !== "host" && !guestCanReturnAfterGame) {
    sendError(ws, "対戦中の部屋状態はホストだけが変更できます。", "forbidden");
    return;
  }
  room.started = false;
  room.state = null;
  room.currentTurn = "";
  room.snapshotSeq = 0;
  clearAllPendingCommands(room);
  room.processedCommandIds = [];
  room.players.forEach((joinedPlayer) => {
    joinedPlayer.ready = false;
  });
  refreshWaitingRoomTimer(room);
  broadcast(room, { ...message, senderId: player.clientId, roomSessionId: room.sessionId }, player.clientId);
}

function routeMessage(ws, raw) {
  const message = safeJsonParse(raw);
  if (!message || typeof message !== "object") {
    sendError(ws, "JSONメッセージとして読み取れません。", "invalid_json");
    return;
  }
  if (message.protocol && message.protocol !== PROTOCOL_VERSION) {
    sendError(ws, "通信プロトコルのバージョンが一致しません。", "protocol_mismatch");
    return;
  }
  if (message.msgId && message.type !== "ack") send(ws, { type: "ack", ackId: message.msgId, senderId: SERVER_ID });

  switch (message.type) {
    case "joinRoom":
      joinRoom(ws, message);
      break;
    case "randomMatch":
      handleRandomMatch(ws, message);
      break;
    case "deckUpdate":
      handleDeckUpdate(ws, message);
      break;
    case "setRoomRule":
      handleSetRoomRule(ws, message);
      break;
    case "roomState":
      handleRoomState(ws, message);
      break;
    case "startGame":
      handleStartGame(ws, message);
      break;
    case "gameState":
      handleGameState(ws, message);
      break;
    case "analyticsLog":
      handleAnalyticsLog(ws, message);
      break;
    case "playCard":
    case "endTurn":
    case "gameAction":
      handlePlayerCommand(ws, message);
      break;
    case "syncRequest": {
      const { room, player } = requireJoined(ws);
      if (room?.state) sendSnapshotMessage(room, player, "gameState");
      break;
    }
    case "snapshotAck":
    case "ack":
      break;
    case "playReveal":
    case "evolutionReveal":
    case "donguriReveal": {
      const { room, player } = requireJoined(ws);
      if (room && player && isBattleRole(player.role)) {
        broadcast(room, { ...message, senderId: player.clientId, roomSessionId: room.sessionId }, player.clientId);
      } else if (room && player) {
        sendError(ws, "観戦者は対戦演出を送信できません。", "forbidden");
      }
      break;
    }
    case "thinItemChoiceRequest":
    case "thinItemChoiceResponse":
    case "badStudentDiscardRequest":
    case "badStudentDiscardResponse":
    case "logicHunterChoiceRequest":
    case "logicHunterChoiceResponse":
    case "courseRegistrationChoiceRequest":
    case "courseRegistrationChoiceResponse":
    case "titleMatchChoiceRequest":
    case "titleMatchChoiceResponse":
    case "philosophyCheatingChoiceRequest":
    case "philosophyCheatingChoiceResponse":
      handlePrivateChoiceRelay(ws, message);
      break;
    case "oneEyedPeekReveal":
      handleOneEyedPeekReveal(ws, message);
      break;
    case "returnRoom":
      handleReturnRoom(ws, message);
      break;
    case "ping":
      send(ws, { type: "pong", pingId: message.msgId, senderId: SERVER_ID });
      break;
    default:
      sendError(ws, `未対応のメッセージです: ${message.type || "unknown"}`, "unknown_type");
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => routeMessage(ws, raw));
  ws.on("close", () => {
    const room = rooms.get(ws.roomId);
    if (!room || !ws.clientId) return;
    const player = room.players.get(ws.clientId);
    if (!player || player.ws !== ws) return;
    room.players.delete(ws.clientId);
    room.updatedAt = now();
    if (room.matchType === "random" && !guestOf(room)) removeRandomQueueRoom(room.roomId);
    refreshWaitingRoomTimer(room);
    if (player.role === "guest") {
      [...room.pendingCommands.entries()].forEach(([commandId, pending]) => {
        if (pending.senderId === player.clientId) clearPendingCommand(room, commandId);
      });
    }
    if (isBattleRole(player.role)) {
      broadcast(room, {
        type: "opponentDisconnected",
        senderId: SERVER_ID,
        roomSessionId: room.sessionId,
        disconnectedRole: player.role,
        players: roomPlayers(room),
        message: "対戦者の接続が切れました。再入室を待っています。"
      });
    }
  });
});

setInterval(cleanupRooms, 1000 * 60 * 10).unref();

loadLogsFromDisk();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chibatoru WebSocket server listening on ${PORT}`);
});
