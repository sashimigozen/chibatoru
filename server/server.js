"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");
const Replay = require("../online-replay.js");
const CardFace = require("../card-face.js");
const { renderTimeline } = require("./admin-log-timeline.js");
const { createD1LogStore, createArchiveQueue } = require("./d1-log-store.js");
const narabeRooms = require("./narabe-rooms.js").createNarabeRooms();

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
const PLAYER_PROFILE_USERNAME_MAX = 20;
const PLAYER_PROFILE_AVATAR_IDS = new Set([
  "user", "cpu", "smile", "glasses", "cap", "hair", "robot_round", "robot_antenna"
]);
const DEFAULT_PLAYER_PROFILE_COMMENT_PARTS = Object.freeze(["対戦よろしく", "お願いします", "エンジョイ"]);
const DEFAULT_PLAYER_PROFILE = Object.freeze({
  username: "チバトル学生",
  avatarId: "user",
  favoriteCardId: "",
  favoriteCardStyle: "normal",
  commentParts: DEFAULT_PLAYER_PROFILE_COMMENT_PARTS
});

// Keep this server-side catalog in sync with the browser's direct-deck catalog.
// The server deliberately owns a copy: clients are not authoritative for deck
// legality, and generated-only cards and tokens must never become legal merely
// by being sent over the socket.
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
// Generated from the regular client's catalog, never the experimental runtime.
// The checked-in copy keeps Render's server directory independently deployable.
const CARD_CATALOG = require("./card-catalog.json");
const SPECIALTY_CARD_IDS = CARD_CATALOG.specialties;
const DIRECT_DECK_CARD_IDS = new Set(CARD_CATALOG.direct);
const ACE_CARD_IDS = new Set(CARD_CATALOG.aces);
const CARD_COPY_LIMITS = Object.freeze(CARD_CATALOG.copyLimits);

// New room rules should be added here. Validation below reads this data instead
// of hard-coding rule IDs throughout the room and deck code.
const ROOM_RULE_DEFINITIONS = Object.freeze({
  normal: Object.freeze({
    id: "normal",
    name: "通常",
    description: "専攻を問わず通常デッキを使用します。",
    deck: Object.freeze({ formats: Object.freeze(["normal"]), minCards: MIN_DECK_CARDS, maxCards: MAX_DECK_CARDS, copyLimit: "standard", aceLimit: 0, specialty: "none" })
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
    description: "すべてのカードの戦意は0。自分のターン開始時、手札が5枚になるまで引きます（5枚以上なら引きません）。同名・エースぺ制限なしで編成できます。",
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
const deletedLogIds = new Set();
const LOG_INACTIVE_MS = 30 * 60 * 1000;
let cloudLogStore = null;
try { cloudLogStore = createD1LogStore(); } catch { console.warn("D1の接続設定が無効です。環境変数を確認してください。"); }
const cloudLogQueue = createArchiveQueue(cloudLogStore);

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
  if (url.pathname === "/admin/logs/learning.json") {
    if (!requireAdmin(req, res)) return;
    const logs = [...onlineBattleLogs.values()].filter(log => Replay.learningEligibility(log).eligible);
    jsonResponse(res, 200, { schemaVersion: 1, purpose: "human-online-review", requiresReview: true, count: logs.length, logs });
    return;
  }
  if (url.pathname === "/admin/logs/archive" || url.pathname.startsWith("/admin/logs/archive/")) {
    if (!requireAdmin(req, res)) return;
    void handleCloudArchive(req, res, url);
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

function aceRuleErrorMessage(aceLimit) {
  if (aceLimit === 0) return "エースぺは通常ルールでは使用できません。";
  if (aceLimit === 1) return "エースぺは1デッキにつき1種類・1枚までです。";
  return "";
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
  const aceIds = new Set();
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
      if (ACE_CARD_IDS.has(baseId)) {
        aceCount += count;
        aceIds.add(baseId);
      }
      if (allowedSpecialtyCards && !allowedSpecialtyCards.has(baseId)) {
        illegalCardIds.push(baseId);
      }
    });
  }

  if (invalidCountIds.length) errors.push("デッキ枚数は0以上の整数で指定してください。");
  if (illegalCardIds.length) errors.push("直接編成できないカード、または選択した専攻に含まれないカードがあります。");
  if (copyOverages.length) errors.push("同名カードの枚数制限を超えています。");
  const aceTypes = aceIds.size;
  if (rule.deck.aceLimit !== null && (aceCount > rule.deck.aceLimit || aceTypes > rule.deck.aceLimit)) {
    errors.push(aceRuleErrorMessage(rule.deck.aceLimit));
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
    aceCount,
    aceTypes
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

const diskLogPending = new Map();
let diskLogWriting = false;
let diskLogFlush = Promise.resolve();
function flushDiskLogs() {
  if (diskLogWriting) return diskLogFlush;
  diskLogFlush = runDiskLogFlush();
  return diskLogFlush;
}
async function runDiskLogFlush() {
  diskLogWriting = true;
  try {
    ensureLogDir();
    for (const [id, log] of diskLogPending) {
      diskLogPending.delete(id);
      if (deletedLogIds.has(id)) continue;
      const file = path.join(LOG_STORAGE_DIR, `${safeLogFileName(id)}.json`);
      try {
        await fs.promises.writeFile(`${file}.pending`, JSON.stringify(log));
        if (deletedLogIds.has(id)) await fs.promises.rm(`${file}.pending`, { force: true });
        else await fs.promises.rename(`${file}.pending`, file);
      } catch (error) {
        if (!deletedLogIds.has(id) && !diskLogPending.has(id)) diskLogPending.set(id, log);
        throw error;
      }
      if (deletedLogIds.has(id)) await fs.promises.rm(file, { force: true });
    }
  } catch (error) { console.warn("online log disk write skipped", error.message); }
  finally { diskLogWriting = false; }
}
function writeLogToDisk(log) {
  if (deletedLogIds.has(log.gameId)) return;
  cloudLogQueue.enqueue(log);
  diskLogPending.set(log.gameId, log);
  if (log.final) void flushDiskLogs();
}
setInterval(() => { void flushDiskLogs(); }, 1000).unref();

function closeInactiveLog(log, currentTime = Date.now()) {
  const updated = Date.parse(log.receivedAt);
  if (log.final || !Number.isFinite(updated) || currentTime - updated < LOG_INACTIVE_MS) return false;
  log.final = true;
  log.closedReason = "inactive";
  log.closedAt = new Date(updated + LOG_INACTIVE_MS).toISOString();
  log.learning = Replay.learningEligibility(log);
  return true;
}
async function closeInactiveLogs() {
  for (const log of onlineBattleLogs.values()) if (closeInactiveLog(log)) writeLogToDisk(log);
  try { await cloudLogStore?.closeInactive?.(new Date(Date.now() - LOG_INACTIVE_MS).toISOString()); }
  catch { /* Keep the last saved log readable when the archive is unavailable. */ }
}
setInterval(() => { void closeInactiveLogs(); }, 60000).unref();

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
  summary.playerNames = { ...room.battleLogPlayerNames };
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
  const gameId = String(payload.gameId || "");
  if (deletedLogIds.has(gameId)) return null;
  const previous = onlineBattleLogs.get(gameId);
  const sameRoom = previous?.roomSessionId === room.sessionId;
  let events = Array.isArray(payload.events) ? payload.events : [];
  if (Number.isSafeInteger(payload.eventOffset)) {
    const existing = sameRoom ? previous.events : [];
    if (payload.eventOffset < 0 || payload.eventOffset > existing.length) return false;
    events = existing.slice(0, payload.eventOffset).concat(events);
    // Retries cannot remove a newer suffix.
    if (events.length < existing.length) events = existing;
    const first = payload.trace?.entries?.[0]?.seq;
    if (first > (sameRoom ? previous.trace?.entries?.length || 0 : 0) + 1) return false;
  }
  const chosenFirstSide = events.findLast(event => event.eventType === "order_choice")?.firstSide;
  if (chosenFirstSide) events = events.map(event => event.eventType === "game_start" && event.game
    ? { ...event, game: { ...event.game, firstSide: chosenFirstSide } } : event);
  const log = normalizeAnalyticsLog(room, player, { ...payload, events });
  room.lastAnalyticsGameId = log.gameId;
  const start = log.events.find(event => event.eventType === "game_start")?.game;
  log.source = "online-human-v1";
  log.serverVerifiedHumanMatch = Boolean(room.humanReplayMatch && start?.mode === "online"
    && start?.participants?.player === "human" && start?.participants?.opponent === "human");
  log.ruleId = room.ruleId;
  log.trace = Replay.mergeTrace(sameRoom ? previous.trace : null, payload.trace, { mutate: true });
  log.incidents = [...(room.replayIncidents || [])];
  if (sameRoom && previous.events.length >= log.events.length) {
    log.events = previous.events;
    log.summary = { ...previous.summary, playerNames: log.summary.playerNames };
    log.final = previous.final || log.final;
    if (previous.closedReason) { log.closedReason = previous.closedReason; log.closedAt = previous.closedAt; }
  }
  // Only new data refreshes the inactivity clock; retries are not activity.
  const changed = !sameRoom || log.events.length > previous.events.length
    || (payload.trace?.entries?.at(-1)?.seq || 0) > (previous.savedTraceSeq || 0)
    || log.final !== previous.final;
  if (sameRoom && !changed) log.receivedAt = previous.receivedAt;
  else if (!payload.final) { delete log.closedReason; delete log.closedAt; log.final = Boolean(log.summary.winner); }
  log.savedTraceSeq = log.trace.entries.length;
  log.learning = Replay.learningEligibility(log);
  onlineBattleLogs.set(log.gameId, log);
  trimStoredLogs();
  if (changed) writeLogToDisk(log);
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
  if (log === false) {
    send(ws, { type: "analyticsLogResync", senderId: SERVER_ID, roomSessionId: room.sessionId, gameId: message.gameId });
    return;
  }
  send(ws, {
    type: "analyticsLogSaved",
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    gameId: message.gameId,
    eventCount: log?.summary.eventCount || 0
  });
}

function handleDownloadBattleLog(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  const log = onlineBattleLogs.get(String(message.gameId || ""));
  if (player.role !== "host" || !log || log.gameId !== room.lastAnalyticsGameId
    || log.roomSessionId !== room.sessionId || !log.final) {
    sendError(ws, "この対戦の詳細ログはホストが試合終了後に保存できます。", "log_not_available");
    return;
  }
  send(ws, { type: "battleLogDownload", senderId: SERVER_ID, roomSessionId: room.sessionId, gameId: log.gameId, log });
}

async function handleCloudArchive(req, res, url) {
  if (!cloudLogStore) { htmlResponse(res, 503, adminPageShell('<section class="panel"><h1>クラウド保存は未設定です</h1><a href="/admin/logs?storage=local">一時保存ログ</a></section>')); return; }
  try {
    if (url.pathname.startsWith("/admin/logs/archive/")) {
      const download = url.pathname.endsWith(".json");
      const id = decodeURIComponent(url.pathname.slice("/admin/logs/archive/".length).replace(/\.json$/, ""));
      const log = await cloudLogStore.get(id);
      if (!log) {
        if (download) jsonResponse(res, 404, { error: "ログが見つかりません。" });
        else htmlResponse(res, 404, adminPageShell('<section class="panel"><h1>ログが見つかりません</h1><a href="/admin/logs">一覧へ戻る</a></section>'));
        return;
      }
      if (closeInactiveLog(log)) await cloudLogStore.closeInactive?.(new Date(Date.now() - LOG_INACTIVE_MS).toISOString());
      if (download) {
        res.setHeader("content-disposition", `attachment; filename="${safeLogFileName(id)}.json"`);
        jsonResponse(res, 200, log);
      } else htmlResponse(res, 200, renderAdminLogDetail(normalizeImportedLog(log), { archive: true }));
      return;
    }
    await closeInactiveLogs();
    const page = await cloudLogStore.list((url.searchParams.get("cursor") || "").slice(0, 160));
    const rows = page.logs.map(log => `<tr><td><a href="/admin/logs/archive/${encodeURIComponent(log.gameId)}">${escapeHtml(logMatchTitle(log))}</a><br><span class="muted">${escapeHtml(log.gameId)}</span></td><td>${escapeHtml(log.receivedAt)}</td><td><span class="badge ${log.final ? "" : "pending"}">${log.final ? "終了" : "途中"}</span></td><td><a href="/admin/logs/archive/${encodeURIComponent(log.gameId)}.json" download>保存</a> ${logDeleteForm(log, true)}</td></tr>`).join("");
    htmlResponse(res, 200, adminPageShell(`<section class="panel"><h1>クラウド保存ログ</h1><p class="actions"><a class="button secondary" href="/admin/logs?storage=local">一時保存ログ</a></p><div class="table-wrap"><table><thead><tr><th>対戦</th><th>保存日時</th><th>状態</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="4">ログはありません。</td></tr>'}</tbody></table></div>${page.nextCursor ? `<a href="/admin/logs/archive?cursor=${encodeURIComponent(page.nextCursor)}">次のページ</a>` : ""}</section>`));
  } catch { htmlResponse(res, 503, adminPageShell('<section class="panel"><h1>クラウド記録を取得できませんでした</h1><a href="/admin/logs">再読み込み</a> ・ <a href="/admin/logs?storage=local">一時保存ログ</a></section>')); }
}

function listLogSummaries() {
  for (const log of onlineBattleLogs.values()) if (closeInactiveLog(log)) writeLogToDisk(log);
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

function logDeleteToken(gameId) {
  return crypto.createHmac("sha256", LOG_ADMIN_PASSWORD).update(`delete-log:${gameId}`).digest("hex");
}
function logDeleteForm(log, archive = false) {
  return `<form method="post" action="/admin/logs/${encodeURIComponent(log.gameId)}/delete" style="display:inline" onsubmit="return confirm('このログを削除しますか？')"><input type="hidden" name="token" value="${logDeleteToken(log.gameId)}"><input type="hidden" name="archive" value="${archive ? "1" : "0"}"><button type="submit" class="button secondary">削除</button></form>`;
}
function handleDeleteLog(req, res, url) {
  if (req.method !== "POST") { jsonResponse(res, 405, { error: "POST required" }); return; }
  const gameId = decodeURIComponent(url.pathname.slice("/admin/logs/".length, -"/delete".length));
  if (!gameId || gameId.length > 160 || gameId.includes("/")) { jsonResponse(res, 400, { error: "Invalid log" }); return; }
  readBody(req, (error, body) => {
    const data = new URLSearchParams(body || "");
    if (error || data.get("token") !== logDeleteToken(gameId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
    void (async () => {
      try {
        // Cancel queued/in-flight cloud writes before deleting either copy.
        await cloudLogQueue.delete(gameId);
        deletedLogIds.add(gameId);
        diskLogPending.delete(gameId);
        onlineBattleLogs.delete(gameId);
        await fs.promises.rm(path.join(LOG_STORAGE_DIR, `${safeLogFileName(gameId)}.json`), { force: true });
        res.writeHead(303, { location: data.get("archive") === "1" ? "/admin/logs" : "/admin/logs?storage=local", "cache-control": "no-store" }); res.end();
      } catch { htmlResponse(res, 503, adminPageShell('<section class="panel"><h1>削除できませんでした</h1><a href="/admin/logs">一覧へ戻る</a></section>')); }
    })();
  });
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
    .deck-link { border: 0; padding: 0; background: none; color: var(--accent); font: inherit; font-weight: 800; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; overflow-wrap: anywhere; }
    .deck-dialog { border: 0; padding: 0; background: transparent; max-width: 96vw; max-height: 90vh; overflow: visible; }
    .deck-dialog::backdrop { background: rgba(15, 23, 42, .58); }
    body:has(.deck-dialog[open]) { overflow: hidden; }
    .log-toc > div { display:flex; flex-wrap:wrap; gap:8px 16px; }
    .log-toc a { font-size:14px; }
    .log-section { scroll-margin-top:16px; }
    .log-section h3 { margin:22px 0 8px; font-size:17px; }
    .log-section h4 { margin:14px 0 6px; font-size:14px; color:var(--muted); }
    .log-turn-player { color:var(--muted); font-weight:700; }
    .log-cards { list-style:none; display:flex; flex-wrap:wrap; gap:6px; padding:0; margin:8px 0 16px; }
    .log-cards li { border:1px solid var(--line); background:var(--panel-soft); border-radius:6px; padding:4px 9px; overflow-wrap:anywhere; }
    .log-metrics, .log-board { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:12px 0; }
    .log-metrics > div, .log-board > div { background:var(--panel-soft); border:1px solid var(--line); border-radius:6px; padding:10px 12px; min-width:0; overflow-wrap:anywhere; }
    .log-metrics strong, .log-metrics span { display:block; }
    .log-metrics span { font-size:14px; }
    .log-metric-card { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; }
    .log-metric-copy { min-width:0; }
    .log-mini-classroom { --occupant-color:#2563eb; position:relative; width:108px; margin:0; font-size:11px; line-height:1.4; }
    .log-mini-classroom.opponent { --occupant-color:#d44857; }
    .log-mini-classroom figcaption { color:var(--muted); text-align:center; margin-bottom:4px; }
    .log-mini-teacher { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); align-items:center; gap:2px; margin-bottom:4px; }
    .log-mini-seats { display:grid; grid-template-columns:repeat(3,1fr); gap:2px; }
    .log-mini-slot { display:flex !important; align-items:center; justify-content:center; width:100%; height:25px; padding:0; border:1px solid var(--line); border-radius:2px; background:#fff; }
    .log-mini-teacher .log-mini-slot { grid-column:2; }
    .log-mini-slot.occupied { cursor:help; }
    .log-mini-dot { display:block; width:11px; height:11px; background:var(--occupant-color); border-radius:50%; }
    .log-mini-slot:focus-visible { outline:2px solid var(--occupant-color); outline-offset:2px; }
    .log-mini-tooltip { display:none !important; position:absolute; z-index:4; right:0; bottom:calc(100% + 5px); width:max-content; max-width:min(240px,70vw); padding:6px 9px; background:var(--ink); color:white; font:12px/1.5 sans-serif !important; border-radius:5px; box-shadow:var(--shadow); pointer-events:none; }
    .log-mini-slot:hover .log-mini-tooltip, .log-mini-slot:focus .log-mini-tooltip { display:block !important; }
    .log-mini-missing { color:var(--muted); width:108px; text-align:center; font-size:12px; }

    .log-board ul { margin:6px 0; padding-left:20px; font-size:14px; }
    .log-actions { list-style:none; padding:0; margin:8px 0 18px; }
    .log-actions li { display:flex; gap:10px; border-bottom:1px solid var(--line); padding:10px 0; overflow-wrap:anywhere; }
    .log-event-seq { flex-shrink:0; min-width:32px; font-size:12px; color:var(--muted); padding-top:3px; }
    .log-check { margin:16px 0; background:var(--panel-soft); border:1px solid var(--line); border-radius:6px; padding:12px; }
    .log-check summary, .log-raw summary { cursor:pointer; font-weight:800; }
    .log-to-top { font-size:13px; }
    @media(max-width:600px) { .log-metrics, .log-board { grid-template-columns:1fr; } }
    .muted { color: var(--muted); }
  </style>
</head>
<body>
  <main class="page">${body}</main>
</body>
</html>`;
}

function logMatchTitle(log) {
  const names = log.summary?.playerNames || log.playerNames || {};
  const label = (name, fallback) => typeof name === "string"
    ? name.trim().slice(0, PLAYER_PROFILE_USERNAME_MAX) || fallback : fallback;
  return `${label(names.player, "プレイヤー")} vs ${label(names.opponent, "対戦相手")}`;
}

function renderAdminLogsPage() {
  const logs = listLogSummaries();
  const rows = logs.map((log) => `
    <tr>
      <td><a href="/admin/logs/${encodeURIComponent(log.gameId)}">${escapeHtml(logMatchTitle(log))}</a><br><span class="muted">${escapeHtml(log.gameId)}</span></td>
      <td>${escapeHtml(log.receivedAt)}</td>
      <td><span class="badge ${log.final ? "" : "pending"}">${log.final ? "終了" : "途中"}</span></td>
      <td>${escapeHtml(log.winner || "-")}</td>
      <td>${escapeHtml(log.reason || "-")}</td>
      <td>${escapeHtml(log.deckNames?.player || "-")}<br><span class="muted">${escapeHtml(log.deckNames?.opponent || "-")}</span></td>
      <td>${escapeHtml(log.eventCount)}</td>
      <td>${logDeleteForm(log)}</td>
    </tr>
  `).join("");
  return adminPageShell(`
    <section class="panel">
      <h1>一時保存ログ</h1>
      <p class="actions">
        <a class="button secondary" href="/admin/logs/archive">クラウド保存ログ</a>
        <a class="button secondary" href="/admin/logs/backup.json" download>まとめて保存</a>
        <a class="button secondary" href="/admin/logs/learning.json" download>分析候補を保存</a>
        <a class="button secondary" href="/admin/logs/import">ログを読み込む</a>
      </p>
      ${cloudLogQueue.status.error ? `<p class="notice">${escapeHtml(cloudLogQueue.status.error)}</p>` : ""}
    </section>
    <section class="panel">
      <h2>保存済みログ ${logs.length}件</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>対戦</th><th>受信日時</th><th>状態</th><th>勝者</th><th>理由</th><th>デッキ</th><th>イベント数</th><th>操作</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="8" class="muted">まだオンライン対戦ログはありません。</td></tr>`}</tbody>
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
      ${message ? `<p class="${kind === "ok" ? "notice" : "muted"}">${escapeHtml(message)}</p>` : ""}
    </section>
    <section class="panel">
      <form id="logImportForm" method="post" action="/admin/logs/import">
        <label class="file-drop-zone" id="logFileDropZone" for="logFileInput" tabindex="0">
          <input id="logFileInput" type="file" accept=".json,.jsonl,application/json,application/x-ndjson">
          <span>
            <strong>ログファイルをここにドロップ</strong>
            ファイルを選択
          </span>
        </label>
        <p class="file-status muted" id="logFileStatus" aria-live="polite"></p>
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
            showStatus(file.name + " を読み込みました。");
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

function renderAdminLogDecks(log) {
  const events = Array.isArray(log.events) ? log.events : [];
  const game = events.find(event => event.eventType === "game_start")?.game || log.game || {};
  const final = [...events].reverse().find(event => event.eventType === "game_end")?.final || log.finalResult || {};
  const names = log.summary?.playerNames || log.playerNames || {};
  const decks = ["player", "opponent"].map(side => {
    const deck = game.decks?.[side] || {};
    const recordedNames = new Map();
    for (const card of Array.isArray(final.cardStats) ? final.cardStats : []) {
      if (card?.side === side && card.cardId && card.cardName) recordedNames.set(card.cardId, card.cardName);
    }
    for (const event of events) {
      if (event.side === side && event.cardId && event.cardName && !recordedNames.has(event.cardId)) {
        recordedNames.set(event.cardId, event.cardName);
      }
    }
    const counts = deck.deckList;
    const cards = counts && typeof counts === "object" && !Array.isArray(counts)
      ? Object.entries(counts).filter(([, count]) => Number.isSafeInteger(count) && count > 0)
        .map(([id, count]) => ({ id, count, name: recordedNames.get(id) || CARD_CATALOG.names?.[id] || id })) : [];
    const label = typeof names[side] === "string" && names[side].trim()
      ? names[side].trim().slice(0, PLAYER_PROFILE_USERNAME_MAX) : side === "player" ? "プレイヤー" : "対戦相手";
    const deckName = deck.deckName || log.summary?.deckNames?.[side] || "デッキ名なし";
    const typeLabels = { student: "学生", teacher: "教師", vampire: "吸血", item: "持物", environment: "環境" };
    // Use the normal deck viewer's type / cost / evolution order.
    const order = CARD_CATALOG.deckOrder || [];
    cards.sort((a, b) => (order.indexOf(a.id) < 0 ? Infinity : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? Infinity : order.indexOf(b.id)));
    const cardGrid = cards.map(card => {
      const base = CARD_CATALOG.display?.[card.id];
      const type = typeLabels[base?.type] ? base.type : "student";
      const hasStats = base && !["item", "environment"].includes(type);
      const badge = (kind, value) => `<span class="card-stat stat-${kind}"${kind === "cost" ? ` aria-label="戦意${escapeHtml(value)}"` : ""}>${escapeHtml(value)}</span>`;
      const markup = CardFace.render({ nameHtml: escapeHtml(card.name),
        typeHtml: base ? `<div class="card-type" title="${type === "vampire" ? "ヴァンパイア" : type === "item" ? "持ち物" : typeLabels[type]}">${typeLabels[type]}</div>` : "",
        costBadge: base && !base.noCost ? badge("cost", base.cost ?? 0) : "",
        attackBadge: hasStats ? badge("attack", base.attack ?? 0) : "",
        hpBadge: hasStats ? badge("hp", base.hp ?? 0) : "",
        defenseBadge: hasStats && base.defense > 0 ? badge("defense", `防${base.defense}`) : "" });
      return `<div class="card deck-window-card ${type}" role="img" aria-label="${escapeHtml(card.name)} ${card.count}枚" data-card-id="${escapeHtml(card.id)}">${markup}<span class="deck-copy-badge">x${card.count}</span></div>`;
    }).join("");
    return `<dialog class="deck-dialog" id="deck-${side}" aria-label="${escapeHtml(deckName)}" data-deck-side="${side}">
      <div class="deck-view-host"><template>
        <link rel="stylesheet" href="/admin/logs/deck-cards.css?v=1">
        <style>
          :host { display:block; font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
          .deck-window { box-sizing:border-box; max-width:96vw; }
          .deck-window-head h2 { overflow-wrap:anywhere; }
          .deck-window-grid { min-height:0; }
          .card.deck-window-card { cursor:default; }
          .card.deck-window-card .hand-card-stats { display:none; }
        </style>
        <section class="deck-window">
          <div class="deck-window-head"><div><h2>${escapeHtml(deckName)}</h2>
          <div class="small-info">${escapeHtml(label)} · ${cards.reduce((sum, card) => sum + card.count, 0)}枚・${cards.length}種類</div></div>
          <button class="button secondary" type="button" data-close>閉じる</button></div>
          ${cards.length ? `<div class="deck-window-grid">${cardGrid}</div>` : '<p>デッキ内容の記録がありません。</p>'}
        </section>
      </template></div>
    </dialog>`;
  });
  return `${decks.join("")}
    <script>
      document.querySelectorAll('.deck-dialog').forEach(dialog => {
        const host = dialog.querySelector('.deck-view-host');
        const template = host.querySelector('template');
        const root = host.attachShadow({mode:'open'});
        root.append(template.content.cloneNode(true));
        template.remove();
        root.querySelector('[data-close]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
        const sync = () => root.querySelectorAll('.card-scale-stage').forEach(stage => {
          const card = stage.parentElement;
          stage.style.setProperty('--card-template-scale', String(Math.min(card.clientWidth / 420, card.clientHeight / 640)));
        });
        const resize = new ResizeObserver(sync);
        root.querySelectorAll('.deck-window-card').forEach(card => resize.observe(card));
        document.querySelector('[data-open-deck="' + dialog.id + '"]').addEventListener('click', () => {
          dialog.showModal();
          sync();
          root.querySelector('[data-close]').focus();
        });
      });
    </script>`;

}

function renderAdminLogDetail(log, { archive = false } = {}) {
  if (closeInactiveLog(log) && !archive) writeLogToDisk(log);
  const logBase = archive ? "/admin/logs/archive" : "/admin/logs";
  const listUrl = archive || !cloudLogStore ? "/admin/logs" : "/admin/logs?storage=local";
  const topCards = (log.summary.frequentlyPlayedCards || [])
    .map((card) => `<span class="badge">${escapeHtml(card.name)} ${escapeHtml(card.count)}</span>`)
    .join(" ");
  return adminPageShell(`
    <section class="panel">
      <p><a href="${listUrl}">ログ一覧へ戻る</a></p>
      <h1>${escapeHtml(logMatchTitle(log))}</h1>
      <p class="muted">gameId: ${escapeHtml(log.gameId)}</p>
      <p class="muted">受信日時: ${escapeHtml(log.receivedAt)} / 部屋: ${escapeHtml(log.roomId)}</p>
      <div class="actions"><a class="button secondary" href="${logBase}/${encodeURIComponent(log.gameId)}.json" download>ログを保存</a> ${logDeleteForm(log, archive)}</div>
    </section>
    <section class="panel">
      <h2>概要</h2>
      <p>状態: ${log.final ? "終了" : "途中"}${log.closedReason === "inactive" ? "（30分更新なし）" : ""}</p>
      <p>勝者: <strong>${escapeHtml(log.summary.playerNames?.[log.summary.winner] || ({player:"プレイヤー",opponent:"対戦相手",draw:"引き分け"}[log.summary.winner]) || log.summary.winner || "-")}</strong></p>
      <p>理由: ${escapeHtml(log.summary.reason || "-")}</p>
      <p>最終ターン: ${escapeHtml(log.summary.finalTurn ?? "-")} / リーサル: ${escapeHtml(log.summary.lethalCard || "-")}</p>
      <p>デッキ: ${["player", "opponent"].map(side => {
        const game = log.events.find(event => event.eventType === "game_start")?.game || log.game || {};
        const name = game.decks?.[side]?.deckName || log.summary.deckNames?.[side] || "デッキ名なし";
        return `<button type="button" class="deck-link" data-open-deck="deck-${side}" aria-haspopup="dialog">${escapeHtml(name)}</button>`;
      }).join(" vs ")}</p>
      <p>よく使われたカード: ${topCards || '<span class="muted">なし</span>'}</p>
    </section>
    ${renderAdminLogDecks(log)}
    ${renderTimeline(log)}
    <details class="panel log-raw" id="log-raw">
      <summary>元データ（イベント一覧）</summary>
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
    </details>
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
  if (url.pathname.endsWith("/delete")) { handleDeleteLog(req, res, url); return; }
  if (url.pathname === "/admin/logs/deck-cards.css") {
    const source = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
    const css = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join("\n").replaceAll(":root", ":host");
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "private, max-age=0, must-revalidate" });
    res.end(css);
    return;
  }
  if (url.pathname === "/admin/logs") {
    if (cloudLogStore && url.searchParams.get("storage") !== "local") {
      void handleCloudArchive(req, res, url);
      return;
    }
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
  const room = rooms.get(ws.roomId);
  if (room?.started && !room.state?.state?.gameOver && isBattleRole(room.players.get(ws.clientId)?.role)) {
    room.replayIncidents = [...(room.replayIncidents || []), { type: "server_error", code, at: new Date().toISOString() }].slice(-100);
  }
  send(ws, { type: "error", code, message, senderId: SERVER_ID });
}

function normalizeCardStyles(cardStyles) {
  if (!cardStyles || typeof cardStyles !== "object" || Array.isArray(cardStyles)) return {};
  return Object.fromEntries(Object.entries(cardStyles)
    .filter(([baseId, mode]) => /^[a-z0-9_]{1,80}$/i.test(baseId) && ["rare", "superRare", "ultraRare", "secretRare", "reward", "prism"].includes(mode))
    .map(([baseId, mode]) => [baseId, mode === "prism" && baseId !== "king_ghidorah_bed" ? "reward" : mode])
    // All 255 pack cards can have selected styles, plus existing rewards.
    // Keep a bounded input while retaining validation and WS payload limits.
    .slice(0, 512));
}

function normalizePlayerProfile(profile, previous = null) {
  const fallback = previous && typeof previous === "object" && !Array.isArray(previous)
    ? previous
    : DEFAULT_PLAYER_PROFILE;
  const source = profile && typeof profile === "object" && !Array.isArray(profile)
    ? profile
    : fallback;
  const username = String(source.username || "").trim().slice(0, PLAYER_PROFILE_USERNAME_MAX)
    || DEFAULT_PLAYER_PROFILE.username;
  const avatarId = PLAYER_PROFILE_AVATAR_IDS.has(source.avatarId)
    ? source.avatarId
    : DEFAULT_PLAYER_PROFILE.avatarId;
  const favoriteCardId = typeof source.favoriteCardId === "string"
    && /^[a-z0-9_]{1,80}$/i.test(source.favoriteCardId)
    ? source.favoriteCardId
    : "";
  const requestedFavoriteCardStyle = ["normal", "rare", "superRare", "ultraRare", "secretRare", "reward", "prism"].includes(source.favoriteCardStyle)
    ? source.favoriteCardStyle
    : "normal";
  const favoriteCardStyle = !favoriteCardId
    ? "normal"
    : requestedFavoriteCardStyle === "prism" && favoriteCardId !== "king_ghidorah_bed"
      ? "reward"
      : requestedFavoriteCardStyle;
  const commentSource = Array.isArray(source.commentParts) ? source.commentParts : [];
  const commentParts = DEFAULT_PLAYER_PROFILE_COMMENT_PARTS.map((fallbackComment, index) => {
    const comment = typeof commentSource[index] === "string" ? commentSource[index].trim().slice(0, 32) : "";
    return comment || fallbackComment;
  });
  return { username, avatarId, favoriteCardId, favoriteCardStyle, commentParts };
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
    profile: normalizePlayerProfile(player.profile),
    ready: player.role === "spectator" ? false : Boolean(player.ready)
  };
}

function roomPlayers(room) {
  return [...room.players.values()].map((player) => playerPublicState(player, room));
}

function roomSpectatorCount(room) {
  return [...room.players.values()].filter((player) => player.role === "spectator").length;
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
    profile: normalizePlayerProfile(deckOwner.profile),
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
    spectators: roomSpectatorCount(room),
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

function fourPlayers(room) {
  return [...room.players.values()]
    .filter((player) => Number.isInteger(player.fourSlot))
    .sort((a, b) => a.fourSlot - b.fourSlot);
}

function fourHostOf(room) {
  return fourPlayers(room).find((player) => player.fourSlot === 0) || null;
}

function fourPublicPlayer(player) {
  return { clientId: player.clientId, slot: player.fourSlot, isHost: player.fourSlot === 0 };
}

function fourSnapshotForRecipient(snapshot, recipient) {
  if (!snapshot || snapshot.mode !== "four" || !Number.isInteger(recipient?.fourSlot)) return snapshot;
  const copy = JSON.parse(JSON.stringify(snapshot));
  if (!Array.isArray(copy.players)) return copy;
  copy.players.forEach((player, index) => {
    if (index === recipient.fourSlot || !Array.isArray(player.hand)) return;
    player.hand = player.hand.map(() => ({ hidden: true }));
  });
  return copy;
}

function sendFourSnapshot(room, recipient, type) {
  return send(recipient.ws, {
    type,
    senderId: SERVER_ID,
    roomId: room.roomId,
    snapshot: fourSnapshotForRecipient(room.state, recipient)
  });
}

function fourLobbyMessage(room, recipient = null, type = "fourLobby") {
  return {
    type,
    senderId: SERVER_ID,
    roomId: room.roomId,
    you: recipient ? fourPublicPlayer(recipient) : null,
    players: fourPlayers(room).map(fourPublicPlayer),
    started: Boolean(room.started)
  };
}

function broadcastFourLobby(room, joined = null) {
  fourPlayers(room).forEach((recipient) => {
    send(recipient.ws, fourLobbyMessage(room, recipient, joined?.clientId === recipient.clientId ? "fourJoined" : "fourLobby"));
  });
}

function joinFourRoom(ws, message) {
  const roomId = normalizeRoomId(message.roomId);
  const clientId = String(message.clientId || "").slice(0, 80);
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
    sendError(ws, "部屋が見つかりません。", "room_not_found");
    return;
  }
  if (!room) {
    room = createRoom(roomId, message.roomSessionId || createSessionId(), "four");
    room.mode = "four";
    rooms.set(roomId, room);
  }
  if (room.mode !== "four") {
    sendError(ws, "この部屋はチバトルふぉーの部屋ではありません。", "wrong_room_mode");
    return;
  }
  const existing = room.players.get(clientId);
  let slot = existing?.fourSlot;
  if (!Number.isInteger(slot)) {
    const occupied = new Set(fourPlayers(room).map((player) => player.fourSlot));
    slot = [0, 1, 2, 3].find((candidate) => !occupied.has(candidate));
  }
  if (!Number.isInteger(slot)) {
    sendError(ws, "この部屋は4人です。", "room_full");
    return;
  }
  if (room.started && !existing) {
    sendError(ws, "すでに対戦が始まっています。", "game_started");
    return;
  }
  if (existing?.ws && existing.ws !== ws) {
    try { existing.ws.close(4001, "replaced"); } catch {}
  }
  const player = { clientId, role: "four", fourSlot: slot, ws, joinedAt: existing?.joinedAt || now(), lastSeenAt: now() };
  room.players.set(clientId, player);
  room.updatedAt = now();
  ws.roomId = roomId;
  ws.clientId = clientId;
  broadcastFourLobby(room, player);
  if (room.state) sendFourSnapshot(room, player, room.started ? "fourStart" : "fourState");
}

function handleFourStart(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player || room.mode !== "four") return;
  if (player.fourSlot !== 0) {
    sendError(ws, "ホストだけが対戦を開始できます。", "forbidden");
    return;
  }
  if (!message.snapshot || message.snapshot.mode !== "four" || !Array.isArray(message.snapshot.players) || message.snapshot.players.length !== 4) {
    sendError(ws, "開始時の4人戦状態が正しくありません。", "invalid_state");
    return;
  }
  room.started = true;
  room.state = message.snapshot;
  room.updatedAt = now();
  fourPlayers(room).forEach((recipient) => sendFourSnapshot(room, recipient, "fourStart"));
}

function handleFourState(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player || room.mode !== "four" || !room.started) return;
  if (player.fourSlot !== 0) {
    sendError(ws, "4人戦状態はホストが更新します。", "forbidden");
    return;
  }
  if (!message.snapshot || message.snapshot.mode !== "four") return;
  room.state = message.snapshot;
  room.updatedAt = now();
  fourPlayers(room).forEach((recipient) => {
    if (recipient.clientId !== player.clientId) sendFourSnapshot(room, recipient, "fourState");
  });
}

function handleFourCommand(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player || room.mode !== "four" || !room.started) return;
  const activeIndex = Number(room.state?.activeIndex);
  if (!Number.isInteger(activeIndex) || activeIndex !== player.fourSlot) {
    sendError(ws, "現在はあなたの手番ではありません。", "invalid_turn");
    return;
  }
  const host = fourHostOf(room);
  if (!host) {
    sendError(ws, "ホストがいません。", "host_missing");
    return;
  }
  send(host.ws, {
    type: "fourCommand",
    senderId: player.clientId,
    roomId: room.roomId,
    action: message.action && typeof message.action === "object" ? message.action : {}
  });
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
// Guests receive card backs for the opponent's hand. Spectators are allowed to
// inspect both players' hands, while still remaining unable to operate them.
function hiddenHandPlaceholders(hand) {
  return Array.isArray(hand) ? hand.map(() => ({ hidden: true })) : [];
}

function mergeSnapshotAnalytics(previous, snapshot) {
  const incoming = snapshot?.state?.analytics;
  if (!Number.isSafeInteger(incoming?.eventOffset)) return snapshot;
  const existing = previous?.state?.analytics?.game?.gameId === incoming.game?.gameId ? previous.state.analytics.events : [];
  if (incoming.eventOffset < 0 || incoming.eventOffset > existing.length) return snapshot;
  const analytics = { ...incoming, events: existing.slice(0, incoming.eventOffset).concat(incoming.events || []) };
  delete analytics.eventOffset;
  return { ...snapshot, state: { ...snapshot.state, analytics } };
}

function snapshotForRecipient(snapshot, recipient) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const hiddenSides = recipient?.role === "guest"
    ? ["player"]
    : [];
  const analytics = snapshot.state?.analytics;
  let transmitted = snapshot;
  if (analytics?.events && recipient?.logDeltaSupported) {
    const offset = recipient.analyticsGameId === analytics.game?.gameId ? recipient.analyticsCount || 0 : 0;
    transmitted = { ...snapshot, state: { ...snapshot.state, analytics: { ...analytics,
      eventOffset: offset, events: analytics.events.slice(offset) } } };
    recipient.analyticsGameId = analytics.game?.gameId;
    recipient.analyticsCount = analytics.events.length;
  }
  const copy = JSON.parse(JSON.stringify(transmitted));
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
    logDeltaSupported: true,
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
  if (message.mode === "four") {
    joinFourRoom(ws, message);
    return;
  }
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
  const profile = normalizePlayerProfile(hasOwn(message, "profile") ? message.profile : null, existing?.profile);
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
    profile,
    logDeltaSupported: message.logDeltaSupported === true,
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
  if (hasOwn(message, "profile")) {
    player.profile = normalizePlayerProfile(message.profile, player.profile);
  }
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
    profile: normalizePlayerProfile(player.profile),
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

// プロフィールだけを更新する経路。観戦者にも許可し、デッキ・準備状態や
// 対戦スナップショットには触れず、サーバーが持つ本人の情報を全員へ配信する。
function handleProfileUpdate(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player || !message.profile || typeof message.profile !== "object") return;
  player.profile = normalizePlayerProfile(message.profile, player.profile);
  broadcast(room, {
    type: "profileUpdate",
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    players: roomPlayers(room)
  });
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
  room.battleLogPlayerNames = {
    player: normalizePlayerProfile(hostOf(room)?.profile).username,
    opponent: normalizePlayerProfile(guestOf(room)?.profile).username
  };
  room.humanReplayMatch = !message.snapshot.state?.aiBattle?.active
    && !message.snapshot.state?.training?.active && !message.snapshot.state?.dungeon?.active
    && !message.snapshot.state?.testMode;
  room.replayIncidents = [];
  clearWaitingRoomTimer(room);
  room.state = mergeSnapshotAnalytics(room.state, message.snapshot);
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
  room.state = mergeSnapshotAnalytics(room.state, message.snapshot);
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
    case "profileUpdate":
      handleProfileUpdate(ws, message);
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
    case "fourStart":
      handleFourStart(ws, message);
      break;
    case "fourState":
      handleFourState(ws, message);
      break;
    case "fourCommand":
      handleFourCommand(ws, message);
      break;
    case "analyticsLog":
      handleAnalyticsLog(ws, message);
      break;
    case "downloadBattleLog":
      handleDownloadBattleLog(ws, message);
      break;
    case "playCard":
    case "endTurn":
    case "gameAction":
      handlePlayerCommand(ws, message);
      break;
    case "syncRequest": {
      const { room, player } = requireJoined(ws);
      if (room?.state) { player.analyticsCount = 0; player.analyticsGameId = ""; sendSnapshotMessage(room, player, "gameState"); }
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
      if (message.profileSync === true) handleProfileUpdate(ws, message);
      send(ws, { type: "pong", pingId: message.msgId, senderId: SERVER_ID });
      break;
    default:
      sendError(ws, `未対応のメッセージです: ${message.type || "unknown"}`, "unknown_type");
  }
}

wss.on("connection", (ws, request) => {
  // Seven-only namespace; do not register normal battle routing or analytics.
  if (new URL(request.url || "/", "http://localhost").pathname === "/narabe") {
    narabeRooms.connect(ws);
    return;
  }
  ws.on("message", (raw) => routeMessage(ws, raw));
  ws.on("close", () => {
    const room = rooms.get(ws.roomId);
    if (!room || !ws.clientId) return;
    const player = room.players.get(ws.clientId);
    if (!player || player.ws !== ws) return;
    room.players.delete(ws.clientId);
    room.updatedAt = now();
    if (room.mode === "four") {
      broadcastFourLobby(room);
      return;
    }
    if (room.matchType === "random" && !guestOf(room)) removeRandomQueueRoom(room.roomId);
    refreshWaitingRoomTimer(room);
    if (player.role === "guest") {
      [...room.pendingCommands.entries()].forEach(([commandId, pending]) => {
        if (pending.senderId === player.clientId) clearPendingCommand(room, commandId);
      });
    }
    if (isBattleRole(player.role)) {
      if (room.started) {
        room.replayIncidents = [...(room.replayIncidents || []), { type: "disconnect", role: player.role, at: new Date().toISOString() }];
        onlineBattleLogs.forEach(log => {
          if (log.roomSessionId !== room.sessionId || log.final) return;
          log.incidents = [...room.replayIncidents];
          log.learning = Replay.learningEligibility(log);
          writeLogToDisk(log);
        });
      }
      broadcast(room, {
        type: "opponentDisconnected",
        senderId: SERVER_ID,
        roomSessionId: room.sessionId,
        disconnectedRole: player.role,
        players: roomPlayers(room),
        message: "対戦者の接続が切れました。再入室を待っています。"
      });
    } else if (player.role === "spectator") {
      broadcast(room, {
        type: "spectatorCount",
        senderId: SERVER_ID,
        roomSessionId: room.sessionId,
        spectatorCount: roomSpectatorCount(room),
        players: roomPlayers(room),
        spectatorNames: [...room.players.values()]
          .filter((member) => member.role === "spectator")
          .map((member) => normalizePlayerProfile(member.profile).username)
      });
    }
  });
});

setInterval(cleanupRooms, 1000 * 60 * 10).unref();

loadLogsFromDisk();
void closeInactiveLogs();

process.once("SIGTERM", async () => {
  server.close();
  await flushDiskLogs();
  await cloudLogQueue.flush();
  process.exit(0);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chibatoru WebSocket server listening on ${PORT}`);
});
