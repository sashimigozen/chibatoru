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

function connectSpectatorClient(url, roomId, clientId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const client = { ws, messages: [] };
    const timer = setTimeout(() => reject(new Error(`spectator join timeout: ${clientId}`)), 4000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "joinRoom", protocol: 1, roomId, clientId, spectate: true, role: "spectator" }));
    });
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      client.messages.push(message);
      if (message.type === "error") {
        clearTimeout(timer);
        reject(new Error(message.code || message.message || "spectator error"));
        return;
      }
      if (message.type !== "playerJoined" || message.you?.clientId !== clientId) return;
      clearTimeout(timer);
      resolve(client);
    });
    ws.once("error", reject);
  });
}

function connectRandomClient(url, clientId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const client = { ws, messages: [] };
    const timer = setTimeout(() => reject(new Error(`random match timeout: ${clientId}`)), 4000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "randomMatch", protocol: 1, clientId }));
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

function createNormalDeckCounts() {
  const ids = [
    "general_student", "aggro_student", "aggro_king", "single_cell", "adjective_student", "yuta", "aggro_queen",
    "ae_student", "hurried_student", "lazy_student", "cancel_student", "back_question_student", "best_friend", "laughing_front_student"
  ];
  return Object.fromEntries(ids.map((baseId) => [baseId, 3]));
}

function createLateSpecialtyDeckCounts() {
  const counts = {};
  [
    "general_student", "absolute_woman", "fridge_thief", "classroom", "environment_setup",
    "go_away", "happy_experience", "hondara", "water_2l", "word_increaser"
  ].forEach((baseId) => { counts[baseId] = 3; });
  ["adjective_student", "cancel_student", "eaten_student", "hurried_student", "lazy_student"]
    .forEach((baseId) => { counts[baseId] = 2; });
  return counts;
}

function createChaosDeckCounts(baseId = "general_student") {
  return { [baseId]: 40 };
}

function normalDeckDescriptor(deckCounts = createNormalDeckCounts()) {
  return { deckCounts, deckFormat: "normal", specialtyId: "" };
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

test("random match pairs waiting clients into one room", async (t) => {
  const port = await freePort();
  const child = await startServer(port);
  const url = `ws://127.0.0.1:${port}`;
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.ws.close());
    child.kill("SIGTERM");
  });

  const first = await connectRandomClient(url, "random-a");
  clients.push(first);
  const firstJoin = first.messages.find((message) => message.type === "playerJoined" && message.you?.clientId === "random-a");
  assert.equal(firstJoin.you.role, "host");
  assert.equal(firstJoin.matchType, "random");
  assert.equal(firstJoin.hasOpponent, false);
  assert.match(firstJoin.roomId, /^R[A-Z0-9]{6}$/);

  const second = await connectRandomClient(url, "random-b");
  clients.push(second);
  const secondJoin = second.messages.find((message) => message.type === "playerJoined" && message.you?.clientId === "random-b");
  assert.equal(secondJoin.you.role, "guest");
  assert.equal(secondJoin.matchType, "random");
  assert.equal(secondJoin.roomId, firstJoin.roomId);
  assert.equal(secondJoin.hasOpponent, true);

  const hostUpdate = await waitFor(first, (message) =>
    message.type === "playerJoined"
    && message.roomId === firstJoin.roomId
    && message.players?.some((player) => player.clientId === "random-b" && player.role === "guest"));
  assert.equal(hostUpdate.message.matchType, "random");
});

test("host-owned room rules synchronize and enforce normal, chaos, and specialty decks", async (t) => {
  const port = await freePort();
  const child = await startServer(port);
  const url = `ws://127.0.0.1:${port}`;
  const roomId = "RULE01";
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.ws.close());
    child.kill("SIGTERM");
  });

  const host = await connectClient(url, roomId, "host-rule", true);
  const guest = await connectClient(url, roomId, "guest-rule");
  clients.push(host, guest);

  const initialJoin = host.messages.find((message) => message.type === "playerJoined" && message.you?.clientId === "host-rule");
  assert.equal(initialJoin.ruleId, "normal");
  assert.equal(initialJoin.roomRule?.name, "通常");

  const deniedStart = guest.messages.length;
  send(guest, { type: "setRoomRule", ruleId: "chaos" });
  const denied = await waitFor(guest, (message) => message.type === "error" && message.code === "forbidden", deniedStart);
  assert.match(denied.message.message, /ホスト/);

  const normalInvalidStart = host.messages.length;
  send(host, {
    type: "deckUpdate",
    deckCounts: createChaosDeckCounts(),
    deckFormat: "normal",
    specialtyId: "",
    ready: true
  });
  const normalInvalid = await waitFor(host, (message) => message.type === "error" && message.code === "invalid_deck", normalInvalidStart);
  assert.match(normalInvalid.message.message, /同名/);

  const aceInvalidStart = guest.messages.length;
  const tooManyAces = createNormalDeckCounts();
  tooManyAces.think_so = 2;
  send(guest, { type: "deckUpdate", ...normalDeckDescriptor(tooManyAces), ready: true });
  const aceInvalid = await waitFor(guest, (message) => message.type === "error" && message.code === "invalid_deck", aceInvalidStart);
  assert.match(aceInvalid.message.message, /エース/);

  const chaosUpdateStart = guest.messages.length;
  send(host, { type: "setRoomRule", ruleId: "chaos" });
  const chaosUpdate = await waitFor(guest, (message) => message.type === "roomRuleChanged" && message.ruleId === "chaos", chaosUpdateStart);
  assert.equal(chaosUpdate.message.roomRule?.name, "カオス");
  assert.equal(chaosUpdate.message.players.find((player) => player.clientId === "host-rule")?.ready, false);

  const syncedRoomState = await waitFor(guest, (message) => message.type === "roomState" && message.ruleId === "chaos", chaosUpdate.index + 1);
  assert.equal(syncedRoomState.message.roomRule?.id, "chaos");

  const tokenInvalidStart = host.messages.length;
  send(host, {
    type: "deckUpdate",
    deckCounts: createChaosDeckCounts("midge"),
    deckFormat: "chaos",
    specialtyId: "",
    ready: true
  });
  const tokenInvalid = await waitFor(host, (message) => message.type === "error" && message.code === "invalid_deck", tokenInvalidStart);
  assert.match(tokenInvalid.message.message, /直接編成/);

  const chaosDeck = createChaosDeckCounts();
  send(host, { type: "deckUpdate", deckCounts: chaosDeck, deckFormat: "chaos", specialtyId: "", ready: true });
  send(guest, { type: "deckUpdate", deckCounts: chaosDeck, deckFormat: "chaos", specialtyId: "", ready: true });
  await waitFor(host, (message) => message.type === "deckUpdate" && message.deckFormat === "chaos" && message.ready === true);

  const specialtyUpdateStart = guest.messages.length;
  send(host, { type: "setRoomRule", ruleId: "specialty" });
  const specialtyUpdate = await waitFor(guest, (message) => message.type === "roomRuleChanged" && message.ruleId === "specialty", specialtyUpdateStart);
  assert.equal(specialtyUpdate.message.players.find((player) => player.clientId === "host-rule")?.ready, false);
  assert.equal(specialtyUpdate.message.players.find((player) => player.clientId === "guest-rule")?.deckValid, false);

  const wrongSpecialtyCounts = createLateSpecialtyDeckCounts();
  wrongSpecialtyCounts.general_student -= 1;
  wrongSpecialtyCounts.ruler = 1;
  const wrongSpecialtyStart = host.messages.length;
  send(host, {
    type: "deckUpdate",
    deckCounts: wrongSpecialtyCounts,
    deckFormat: "specialty",
    specialtyId: "late",
    ready: true
  });
  const wrongSpecialty = await waitFor(host, (message) => message.type === "error" && message.code === "invalid_deck", wrongSpecialtyStart);
  assert.match(wrongSpecialty.message.message, /専攻/);

  const specialtyDeck = createLateSpecialtyDeckCounts();
  send(host, { type: "deckUpdate", deckCounts: specialtyDeck, deckFormat: "specialty", specialtyId: "late", ready: true });
  send(guest, { type: "deckUpdate", deckCounts: specialtyDeck, deckFormat: "specialty", specialtyId: "late", ready: true });
  await waitFor(host, (message) => message.type === "deckUpdate" && message.deckFormat === "specialty" && message.ready === true);

  const startIndex = guest.messages.length;
  send(host, {
    type: "startGame",
    snapshot: { seq: 1, state: { currentSide: "player", gameOver: false } }
  });
  const started = await waitFor(guest, (message) => message.type === "startGame" && message.snapshot?.seq === 1, startIndex);
  assert.equal(started.message.ruleId, "specialty");
  assert.equal(started.message.roomRule?.id, "specialty");

  const afterStartChange = host.messages.length;
  send(host, { type: "setRoomRule", ruleId: "normal" });
  const changeRejected = await waitFor(host, (message) => message.type === "error" && message.code === "game_started", afterStartChange);
  assert.match(changeRejected.message.message, /開始後/);
});

test("public room list exposes spectatable battles and allows spectator joins", async (t) => {
  const port = await freePort();
  const child = await startServer(port);
  const url = `ws://127.0.0.1:${port}`;
  const roomId = "WATCH01";
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.ws.close());
    child.kill("SIGTERM");
  });

  const host = await connectClient(url, roomId, "host-watch", true);
  const guest = await connectClient(url, roomId, "guest-watch");
  clients.push(host, guest);

  const deckCounts = createNormalDeckCounts();
  send(host, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
  send(guest, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
  await waitFor(host, (message) => message.type === "deckUpdate");

  const beforeStart = await httpGet(port, "/rooms.json");
  assert.equal(beforeStart.statusCode, 200);
  assert.equal(beforeStart.headers["access-control-allow-origin"], "*");
  assert.deepEqual(JSON.parse(beforeStart.body).rooms, []);

  send(host, {
    type: "startGame",
    snapshot: { seq: 1, state: { currentSide: "player", gameOver: false } }
  });
  await waitFor(guest, (message) => message.type === "gameState" && message.snapshot?.seq === 1);

  const afterStart = await httpGet(port, "/rooms.json");
  const rooms = JSON.parse(afterStart.body).rooms;
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].roomId, roomId);
  assert.equal(rooms[0].started, true);
  assert.equal(rooms[0].players, 2);

  const spectator = await connectSpectatorClient(url, roomId, "spectator-watch");
  clients.push(spectator);
  const spectatorJoin = spectator.messages.find((message) => message.type === "playerJoined");
  assert.equal(spectatorJoin.you.role, "spectator");
  assert.equal(spectatorJoin.hasOpponent, true);
});

test("reward card styles are shared with the opponent and spectators", async (t) => {
  const port = await freePort();
  const child = await startServer(port);
  const url = `ws://127.0.0.1:${port}`;
  const roomId = "STYLE01";
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.ws.close());
    child.kill("SIGTERM");
  });

  const host = await connectClient(url, roomId, "host-style", true);
  const guest = await connectClient(url, roomId, "guest-style");
  clients.push(host, guest);

  const deckCounts = createNormalDeckCounts();
  const hostUpdateStart = host.messages.length;
  send(guest, {
    type: "deckUpdate",
    ...normalDeckDescriptor(deckCounts),
    ready: true,
    cardStyles: { vampire: "reward", unexpected: "reward", lazy_student: "normal" }
  });
  const sharedGuestStyles = await waitFor(host, (message) =>
    message.type === "playerJoined"
    && message.players?.some((player) => player.clientId === "guest-style" && player.cardStyles?.vampire === "reward"), hostUpdateStart);
  const guestPublicState = sharedGuestStyles.message.players.find((player) => player.clientId === "guest-style");
  assert.equal(guestPublicState.cardStyles.vampire, "reward");
  assert.equal(guestPublicState.cardStyles.unexpected, "reward");
  assert.equal(guestPublicState.cardStyles.lazy_student, undefined);

  send(host, {
    type: "deckUpdate",
    ...normalDeckDescriptor(deckCounts),
    ready: true,
    cardStyles: { bird_a: "reward" }
  });
  await waitFor(guest, (message) =>
    message.type === "playerJoined"
    && message.players?.some((player) => player.clientId === "host-style" && player.cardStyles?.bird_a === "reward"));

  send(host, {
    type: "startGame",
    snapshot: { seq: 1, state: { currentSide: "player", gameOver: false } }
  });
  await waitFor(guest, (message) => message.type === "gameState" && message.snapshot?.seq === 1);

  const spectator = await connectSpectatorClient(url, roomId, "spectator-style");
  clients.push(spectator);
  const spectatorJoin = spectator.messages.find((message) => message.type === "playerJoined" && message.you?.clientId === "spectator-style");
  const hostState = spectatorJoin.players.find((player) => player.clientId === "host-style");
  const spectatorGuestState = spectatorJoin.players.find((player) => player.clientId === "guest-style");
  assert.equal(hostState.cardStyles.bird_a, "reward");
  assert.equal(spectatorGuestState.cardStyles.vampire, "reward");
});

test("private card choice requests and responses relay between host and guest", async (t) => {
  const port = await freePort();
  const child = await startServer(port);
  const url = `ws://127.0.0.1:${port}`;
  const roomId = "CHOICE01";
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.ws.close());
    child.kill("SIGTERM");
  });

  const host = await connectClient(url, roomId, "host-choice", true);
  const guest = await connectClient(url, roomId, "guest-choice");
  clients.push(host, guest);

  const deckCounts = createNormalDeckCounts();
  send(host, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
  send(guest, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
  await waitFor(host, (message) => message.type === "deckUpdate");
  send(host, {
    type: "startGame",
    snapshot: { seq: 1, state: { currentSide: "opponent", gameOver: false } }
  });
  await waitFor(guest, (message) => message.type === "gameState" && message.snapshot?.seq === 1);

  const pairs = [
    ["thinItemChoiceRequest", "thinItemChoiceResponse", { handCount: 5 }, { keepIds: ["a", "b", "c", "d"] }],
    ["badStudentDiscardRequest", "badStudentDiscardResponse", { discardCount: 2 }, { discardIds: ["a", "b"] }],
    ["logicHunterChoiceRequest", "logicHunterChoiceResponse", { cards: [{ instanceId: "host-card-1", name: "テストカード" }] }, { discardId: "host-card-1" }],
    ["courseRegistrationChoiceRequest", "courseRegistrationChoiceResponse", { sourceName: "履修登録結論パ" }, { accepted: true, selectedIds: ["a", "b", "c", "d", "e"] }],
    ["titleMatchChoiceRequest", "titleMatchChoiceResponse", { sourceName: "アイベンVSにょていタイトルマッチ" }, { discardIds: ["a"] }],
    ["philosophyCheatingChoiceRequest", "philosophyCheatingChoiceResponse", { cards: [{ instanceId: "host-item-1", name: "持ち物", type: "item" }] }, { selectedIds: ["host-item-1"] }]
  ];

  for (const [requestType, responseType, requestPayload, responsePayload] of pairs) {
    const requestId = `${requestType}-1`;
    const guestStart = guest.messages.length;
    send(host, { type: requestType, requestId, ...requestPayload });
    const relayedRequest = await waitFor(guest, (message) =>
      message.type === requestType && message.requestId === requestId, guestStart);
    assert.equal(relayedRequest.message.senderId, "host-choice");

    const hostStart = host.messages.length;
    send(guest, { type: responseType, requestId, ...responsePayload });
    const relayedResponse = await waitFor(host, (message) =>
      message.type === responseType && message.requestId === requestId, hostStart);
    assert.equal(relayedResponse.message.senderId, "guest-choice");
  }
});

test("host receives the current guest deck only through private deck updates", async (t) => {
  const port = await freePort();
  const child = await startServer(port);
  const url = `ws://127.0.0.1:${port}`;
  const roomId = "DECK01";
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.ws.close());
    child.kill("SIGTERM");
  });

  const host = await connectClient(url, roomId, "host-deck", true);
  const guest = await connectClient(url, roomId, "guest-deck");
  clients.push(host, guest);
  const counts = createNormalDeckCounts();
  const hostStart = host.messages.length;
  const guestStart = guest.messages.length;
  send(guest, { type: "deckUpdate", deckName: "guest-normal", ...normalDeckDescriptor(counts), ready: true });
  const privateUpdate = await waitFor(host, (message) =>
    message.type === "privateDeckUpdate"
    && message.playerId === "guest-deck"
    && message.deckName === "guest-normal", hostStart);
  assert.deepEqual(privateUpdate.message.deckCounts, counts);
  assert.equal(privateUpdate.message.deckFormat, "normal");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(guest.messages.slice(guestStart).some((message) => message.type === "privateDeckUpdate"), false);
});

test("snapshots redact hidden hands and one-eyed peek reveals only to its guest", async (t) => {
  const port = await freePort();
  const child = await startServer(port);
  const url = `ws://127.0.0.1:${port}`;
  const roomId = "HIDE01";
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.ws.close());
    child.kill("SIGTERM");
  });

  const host = await connectClient(url, roomId, "host-hide", true);
  const guest = await connectClient(url, roomId, "guest-hide");
  clients.push(host, guest);
  const deckCounts = createNormalDeckCounts();
  send(host, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
  send(guest, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
  await waitFor(host, (message) => message.type === "deckUpdate");

  const snapshot = {
    seq: 1,
    state: {
      currentSide: "player",
      gameOver: false,
      players: {
        player: {
          hand: [{ instanceId: "host-secret", baseId: "general_student", name: "ホスト秘密カード" }]
        },
        opponent: {
          hand: [{ instanceId: "guest-secret", baseId: "aggro_student", name: "ゲスト秘密カード" }]
        }
      }
    }
  };
  const guestStart = guest.messages.length;
  send(host, { type: "startGame", snapshot });
  const guestStarted = await waitFor(guest, (message) => message.type === "startGame" && message.snapshot?.seq === 1, guestStart);
  assert.deepEqual(guestStarted.message.snapshot.state.players.player.hand, [{ hidden: true }]);
  assert.equal(guestStarted.message.snapshot.state.players.opponent.hand[0].name, "ゲスト秘密カード");

  const spectator = await connectSpectatorClient(url, roomId, "spectator-hide");
  clients.push(spectator);
  const spectatorState = await waitFor(spectator, (message) => message.type === "gameState" && message.snapshot?.seq === 1);
  assert.deepEqual(spectatorState.message.snapshot.state.players.player.hand, [{ hidden: true }]);
  assert.deepEqual(spectatorState.message.snapshot.state.players.opponent.hand, [{ hidden: true }]);

  const guestRevealStart = guest.messages.length;
  const spectatorRevealStart = spectator.messages.length;
  send(host, { type: "oneEyedPeekReveal", sourceBaseId: "one_eyed_peek" });
  const reveal = await waitFor(guest, (message) => message.type === "oneEyedPeekReveal", guestRevealStart);
  assert.equal(reveal.message.cards.length, 1);
  assert.equal(reveal.message.cards[0].name, "ホスト秘密カード");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(spectator.messages.slice(spectatorRevealStart).some((message) => message.type === "oneEyedPeekReveal"), false);

  const forbiddenStart = guest.messages.length;
  send(guest, { type: "oneEyedPeekReveal", sourceBaseId: "one_eyed_peek" });
  const forbidden = await waitFor(guest, (message) => message.type === "error" && message.code === "forbidden", forbiddenStart);
  assert.match(forbidden.message.message, /ホスト/);
});

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

  const deckCounts = createNormalDeckCounts();
  send(host, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
  send(guest, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
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

  const deckCounts = createNormalDeckCounts();
  send(host, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
  send(guest, { type: "deckUpdate", ...normalDeckDescriptor(deckCounts), ready: true });
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
  assert.match(list.body, /バックアップJSONをダウンロード/);

  const backup = await httpGet(port, "/admin/logs/backup.json", "secret");
  assert.equal(backup.statusCode, 200);
  assert.match(backup.headers["content-disposition"], /^attachment; filename="chibatoru-online-logs-/);
  const backupParsed = JSON.parse(backup.body);
  assert.equal(backupParsed.count, 1);
  assert.equal(backupParsed.logs[0].gameId, "game-admin-test");
  assert.equal(backupParsed.logs[0].events.length, 2);

  const json = await httpGet(port, "/admin/logs/game-admin-test.json", "secret");
  assert.equal(json.statusCode, 200);
  const parsed = JSON.parse(json.body);
  assert.equal(parsed.gameId, "game-admin-test");
  assert.equal(parsed.summary.winner, "player");
  assert.equal(parsed.events.length, 2);

  const importPage = await httpGet(port, "/admin/logs/import", "secret");
  assert.equal(importPage.statusCode, 200);
  assert.match(importPage.body, /ログJSONインポート/);
  assert.match(importPage.body, /ログファイルをここにドロップ/);
  assert.match(importPage.body, /id="logFileInput"/);
  assert.match(importPage.body, /normalizeJsonLines/);

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
