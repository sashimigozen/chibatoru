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
const LOG_ADMIN_PASSWORD = process.env.CHIBATORU_LOG_ADMIN_PASSWORD || process.env.ADMIN_LOG_PASSWORD || "";
const LOG_STORAGE_DIR = process.env.CHIBATORU_LOG_DIR || path.join(os.tmpdir(), "chibatoru-online-logs");
const MAX_STORED_LOGS = Number(process.env.MAX_STORED_LOGS || 300);

const rooms = new Map();
const onlineBattleLogs = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, onlineLogs: onlineBattleLogs.size }));
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

function createSessionId() {
  return `srv-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
    body { margin: 0; background: #f7f5ee; color: #1f2a24; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; line-height: 1.7; }
    .page { width: min(1160px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 56px; }
    .panel { background: #fffdf7; border: 1px solid #d9d0bf; border-radius: 8px; box-shadow: 0 12px 32px rgba(39, 34, 24, 0.1); padding: 22px; margin-bottom: 18px; }
    h1, h2, p { margin-top: 0; }
    h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.1; }
    a { color: #2f6b4f; font-weight: 800; text-underline-offset: 3px; }
    code { background: #efe7d6; border-radius: 5px; padding: 2px 6px; }
    table { width: 100%; border-collapse: collapse; min-width: 900px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #d9d0bf; text-align: left; vertical-align: top; }
    th { background: #efe7d6; color: #4c4332; font-size: 13px; }
    .table-wrap { overflow-x: auto; border: 1px solid #d9d0bf; border-radius: 8px; background: #fff; }
    .badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; background: #dcefe5; color: #2f6b4f; font-size: 12px; font-weight: 900; }
    .badge.pending { background: #fff0cc; color: #815d16; }
    .muted { color: #5d6b62; }
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
      <p><a href="/admin/logs.json">JSON一覧を開く</a></p>
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

function handleAdminLogsJson(req, res) {
  if (!requireAdmin(req, res)) return;
  jsonResponse(res, 200, { logs: listLogSummaries() });
}

function handleAdminLogsRequest(req, res, url) {
  if (!requireAdmin(req, res)) return;
  if (url.pathname === "/admin/logs") {
    htmlResponse(res, 200, renderAdminLogsPage());
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

function playerPublicState(player) {
  return {
    clientId: player.clientId,
    role: player.role,
    deckName: player.role === "spectator" ? "" : (player.deckName || "__current"),
    ready: player.role === "spectator" ? false : Boolean(player.ready)
  };
}

function roomPlayers(room) {
  return [...room.players.values()].map(playerPublicState);
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
  if (!room?.state) return;
  send(ws, {
    type: "gameState",
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    snapshot: room.state
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

function deckTotal(deckCounts) {
  if (!deckCounts || typeof deckCounts !== "object" || Array.isArray(deckCounts)) return 0;
  return Object.values(deckCounts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function isDeckValid(deckCounts) {
  const total = deckTotal(deckCounts);
  return total >= MIN_DECK_CARDS && total <= MAX_DECK_CARDS;
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
      rooms.delete(roomId);
    }
  });
}

function joinRoom(ws, message) {
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
    sendError(ws, "部屋が見つかりません。部屋コードを確認してください。", "room_not_found");
    return;
  }
  if (!room) {
    room = {
      roomId,
      sessionId: message.roomSessionId || createSessionId(),
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
    rooms.set(roomId, room);
  }

  const existing = room.players.get(clientId);
  let role = existing?.role || "";
  if (!role) {
    if (message.create && ![...room.players.values()].some((player) => player.role === "host")) {
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

  const player = {
    clientId,
    role,
    ws,
    ready: role === "spectator" ? false : Boolean(message.ready),
    deckName: role === "spectator" ? "" : (message.deckName || "__current"),
    deckCounts: role === "spectator" ? null : (message.deckCounts || null),
    joinedAt: existing?.joinedAt || now(),
    lastSeenAt: now()
  };
  room.players.set(clientId, player);
  room.updatedAt = now();
  ws.roomId = roomId;
  ws.clientId = clientId;

  const joinedMessage = {
    type: "playerJoined",
    senderId: SERVER_ID,
    roomId,
    roomSessionId: room.sessionId,
    you: playerPublicState(player),
    players: roomPlayers(room),
    hasOpponent: roomHasOpponent(room, role),
    started: room.started
  };
  send(ws, joinedMessage);
  broadcast(room, joinedMessage, clientId);
  if (room.state) {
    send(ws, {
      type: "gameState",
      senderId: SERVER_ID,
      roomSessionId: room.sessionId,
      snapshot: room.state
    });
  }
  if (role === "host" && room.started) {
    room.pendingCommands.forEach((_pending, commandId) => deliverPendingCommand(room, commandId));
  }
  refreshWaitingRoomTimer(room);
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
  const ready = Boolean(message.ready);
  if (ready && !isDeckValid(message.deckCounts)) {
    sendError(ws, "デッキは40〜60枚で準備OKにしてください。", "invalid_deck");
    return;
  }
  player.deckName = message.deckName || "__current";
  player.deckCounts = message.deckCounts || null;
  player.ready = ready;
  broadcast(room, { ...message, senderId: player.clientId, roomSessionId: room.sessionId }, player.clientId);
  broadcast(room, {
    type: "playerJoined",
    senderId: SERVER_ID,
    roomId: room.roomId,
    roomSessionId: room.sessionId,
    you: null,
    players: roomPlayers(room),
    hasOpponent: true,
    started: room.started
  });
}

function handleRoomState(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  if (player.role !== "host") {
    sendError(ws, "部屋状態はホストだけが送信できます。", "forbidden");
    return;
  }
  broadcast(room, { ...message, senderId: player.clientId, roomSessionId: room.sessionId }, player.clientId);
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
  const allReady = joinedBattlePlayers.every((joinedPlayer) => joinedPlayer.ready && isDeckValid(joinedPlayer.deckCounts));
  if (!allReady) {
    sendError(ws, "2人とも有効なデッキで準備OKにしてください。", "not_ready");
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
  broadcast(room, {
    type: "startGame",
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    snapshot: room.state
  });
  broadcast(room, {
    type: "gameState",
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    snapshot: room.state
  });
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
  broadcast(room, {
    type: "gameState",
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    snapshot: room.state,
    processedCommandId
  }, player.clientId);
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
    case "deckUpdate":
      handleDeckUpdate(ws, message);
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
      const { room } = requireJoined(ws);
      if (room?.state) send(ws, { type: "gameState", senderId: SERVER_ID, roomSessionId: room.sessionId, snapshot: room.state });
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
