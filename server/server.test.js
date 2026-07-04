"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const WebSocket = require("ws");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      COMMAND_RETRY_MS: "70",
      COMMAND_MAX_ATTEMPTS: "5",
      WAITING_ROOM_TIMEOUT_MS: "300000",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`server start timeout: ${stderr}`)), 4000);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      resolve(child);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited before startup (${code}): ${stderr}`));
    });
  });
}

function connectClient(url, roomId, clientId, create = false) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const client = { ws, messages: [] };
    const timer = setTimeout(() => reject(new Error(`join timeout: ${clientId}`)), 4000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "joinRoom", protocol: 1, roomId, clientId, create }));
    });
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      client.messages.push(message);
      if (message.type !== "playerJoined" || message.you?.clientId !== clientId) return;
      clearTimeout(timer);
      resolve(client);
    });
    ws.once("error", reject);
  });
}

function waitFor(client, predicate, fromIndex = 0, timeoutMs = 3000) {
  const existingIndex = client.messages.findIndex((message, index) => index >= fromIndex && predicate(message));
  if (existingIndex >= 0) return Promise.resolve({ message: client.messages[existingIndex], index: existingIndex });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.ws.off("message", onMessage);
      reject(new Error("message timeout"));
    }, timeoutMs);
    function onMessage(raw) {
      const message = JSON.parse(String(raw));
      if (!predicate(message)) return;
      clearTimeout(timer);
      client.ws.off("message", onMessage);
      resolve({ message, index: client.messages.length - 1 });
    }
    client.ws.on("message", onMessage);
  });
}

function send(client, message) {
  client.ws.send(JSON.stringify({ protocol: 1, ...message }));
}

function httpGet(port, pathname, password = "") {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (password) headers.authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
      headers
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.once("error", reject);
    req.end();
  });
}

function httpPost(port, pathname, password, body, contentType = "application/json") {
  return new Promise((resolve, reject) => {
    const headers = {
      "content-type": contentType,
      "content-length": Buffer.byteLength(body)
    };
    if (password) headers.authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "POST",
      headers
    }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody }));
    });
    req.once("error", reject);
    req.write(body);
    req.end();
  });
}

test("guest commands retry until the host confirms an authoritative snapshot", async (t) => {
  const port = await freePort();
  const child = await startServer(port);
  const url = `ws://127.0.0.1:${port}`;
  const roomId = "SYNC01";
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.ws.close());
    child.kill("SIGTERM");
  });

  const host = await connectClient(url, roomId, "host-test", true);
  const guest = await connectClient(url, roomId, "guest-test");
  clients.push(host, guest);

  const deckCounts = { test_card: 40 };
  send(host, { type: "deckUpdate", deckCounts, ready: true });
  send(guest, { type: "deckUpdate", deckCounts, ready: true });
  await waitFor(host, (message) => message.type === "deckUpdate");

  send(host, {
    type: "startGame",
    snapshot: { seq: 1, state: { currentSide: "opponent", gameOver: false } }
  });
  await waitFor(guest, (message) => message.type === "gameState" && message.snapshot?.seq === 1);

  const command = { id: "guest-end-1", type: "endTurn", payload: {}, createdAt: Date.now() };
  send(guest, { type: "endTurn", msgId: "end-envelope-1", command });
  await waitFor(host, (message) => message.type === "command" && message.command?.id === command.id && message.deliveryAttempt === 1);

  send(guest, {
    type: "endTurn",
    msgId: "end-envelope-2",
    command: { ...command, id: "guest-end-2" }
  });
  const pendingNotice = await waitFor(guest, (message) => message.type === "commandPending");
  assert.equal(pendingNotice.message.commandId, command.id);
  assert.equal(host.messages.filter((message) => message.command?.id === "guest-end-2").length, 0);

  await waitFor(host, (message) => message.type === "command" && message.command?.id === command.id && message.deliveryAttempt >= 2);
  send(host, {
    type: "gameState",
    msgId: "state-envelope-2",
    processedCommandId: command.id,
    snapshot: { seq: 2, state: { currentSide: "player", gameOver: false } }
  });
  const syncedState = await waitFor(guest, (message) => message.type === "gameState" && message.snapshot?.seq === 2);
  assert.equal(syncedState.message.snapshot.state.currentSide, "player");
  await waitFor(guest, (message) => message.type === "commandProcessed" && message.commandId === command.id);

  const deliveredCount = host.messages.filter((message) => message.command?.id === command.id).length;
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(host.messages.filter((message) => message.command?.id === command.id).length, deliveredCount);

  const guestMessageStart = guest.messages.length;
  send(guest, { type: "endTurn", msgId: "end-envelope-retry", command });
  await waitFor(guest, (message) => message.type === "commandProcessed" && message.commandId === command.id, guestMessageStart);
  assert.equal(host.messages.filter((message) => message.command?.id === command.id).length, deliveredCount);

  const forbiddenStart = guest.messages.length;
  send(guest, { type: "returnRoom", msgId: "guest-return-during-game" });
  const forbidden = await waitFor(guest, (message) => message.type === "error" && message.code === "forbidden", forbiddenStart);
  assert.match(forbidden.message.message, /ホスト/);
});

test("admin logs require a password and store host analytics logs", async (t) => {
  const port = await freePort();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "chibatoru-log-test-"));
  const child = await startServer(port, {
    CHIBATORU_LOG_ADMIN_PASSWORD: "secret",
    CHIBATORU_LOG_DIR: logDir
  });
  const url = `ws://127.0.0.1:${port}`;
  const roomId = "LOG01";
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.ws.close());
    child.kill("SIGTERM");
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  const unauthorized = await httpGet(port, "/admin/logs");
  assert.equal(unauthorized.statusCode, 401);

  const host = await connectClient(url, roomId, "host-log", true);
  const guest = await connectClient(url, roomId, "guest-log");
  clients.push(host, guest);

  const deckCounts = { test_card: 40 };
  send(host, { type: "deckUpdate", deckCounts, ready: true });
  send(guest, { type: "deckUpdate", deckCounts, ready: true });
  await waitFor(host, (message) => message.type === "deckUpdate");
  send(host, {
    type: "startGame",
    snapshot: { seq: 1, state: { currentSide: "player", gameOver: false } }
  });
  await waitFor(guest, (message) => message.type === "gameState" && message.snapshot?.seq === 1);

  send(guest, {
    type: "analyticsLog",
    gameId: "guest-should-not-save",
    events: []
  });
  await waitFor(guest, (message) => message.type === "error" && message.code === "forbidden");

  send(host, {
    type: "analyticsLog",
    gameId: "game-admin-test",
    final: true,
    version: "test",
    events: [
      { eventType: "game_start", gameId: "game-admin-test", eventSeq: 1, game: { gameId: "game-admin-test", mode: "online", startedAt: "2026-07-05T00:00:00.000Z", firstSide: "player", decks: { player: { deckName: "A" }, opponent: { deckName: "B" } } } },
      { eventType: "game_end", gameId: "game-admin-test", eventSeq: 2, final: { winner: "player", reason: "test win", finalTurn: 3 } }
    ]
  });
  await waitFor(host, (message) => message.type === "analyticsLogSaved" && message.gameId === "game-admin-test");

  const list = await httpGet(port, "/admin/logs", "secret");
  assert.equal(list.statusCode, 200);
  assert.match(list.body, /game-admin-test/);
  assert.match(list.body, /test win/);

  const json = await httpGet(port, "/admin/logs/game-admin-test.json", "secret");
  assert.equal(json.statusCode, 200);
  const parsed = JSON.parse(json.body);
  assert.equal(parsed.gameId, "game-admin-test");
  assert.equal(parsed.summary.winner, "player");
  assert.equal(parsed.events.length, 2);

  const importPage = await httpGet(port, "/admin/logs/import", "secret");
  assert.equal(importPage.statusCode, 200);
  assert.match(importPage.body, /ログJSONインポート/);

  const importedPayload = {
    logs: [{
      gameId: "imported-log",
      receivedAt: "2026-07-05T00:10:00.000Z",
      final: true,
      events: [
        { eventType: "game_start", gameId: "imported-log", eventSeq: 1, game: { mode: "online", decks: { player: { deckName: "C" }, opponent: { deckName: "D" } } } },
        { eventType: "game_end", gameId: "imported-log", eventSeq: 2, final: { winner: "opponent", reason: "import win" } }
      ]
    }]
  };
  const importResult = await httpPost(port, "/admin/logs/import", "secret", JSON.stringify(importedPayload));
  assert.equal(importResult.statusCode, 200);
  assert.match(importResult.body, /1件のログをインポートしました/);

  const imported = await httpGet(port, "/admin/logs/imported-log.json", "secret");
  assert.equal(imported.statusCode, 200);
  const importedParsed = JSON.parse(imported.body);
  assert.equal(importedParsed.gameId, "imported-log");
  assert.equal(importedParsed.summary.reason, "import win");
});
