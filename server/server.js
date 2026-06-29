"use strict";

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8787);
const PROTOCOL_VERSION = 1;
const ROOM_TTL_MS = 1000 * 60 * 60 * 2;
const WAITING_ROOM_TIMEOUT_MS = Number(process.env.WAITING_ROOM_TIMEOUT_MS || 1000 * 60 * 5);
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;
const MAX_DECK_CARDS = 60;
const MIN_DECK_CARDS = 40;
const SERVER_ID = "server";

const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Chibatoru WebSocket server");
});

const wss = new WebSocketServer({ server });

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
    if (room.players.size === 0 && room.updatedAt < cutoff) rooms.delete(roomId);
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
  broadcast(room, {
    type: "gameState",
    senderId: SERVER_ID,
    roomSessionId: room.sessionId,
    snapshot: room.state
  }, player.clientId);
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
  const validationError = validateTurnCommand(room, player, commandType);
  if (validationError) {
    sendError(ws, validationError, "invalid_turn");
    return;
  }
  const host = hostOf(room);
  if (!host) {
    sendError(ws, "ホストがいません。", "host_missing");
    return;
  }
  if (player.role === "host") return;
  send(host.ws, {
    type: "command",
    senderId: player.clientId,
    roomSessionId: room.sessionId,
    command
  });
}

function handleReturnRoom(ws, message) {
  const { room, player } = requireJoined(ws);
  if (!room || !player) return;
  room.started = false;
  room.state = null;
  room.currentTurn = "";
  room.snapshotSeq = 0;
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
    case "playReveal": {
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chibatoru WebSocket server listening on ${PORT}`);
});
