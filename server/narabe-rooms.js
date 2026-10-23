'use strict';
const crypto = require('node:crypto');
const E = require('./narabe-engine.js');

// Completely separate room map and messages: no normal-battle state or learning logs.
function createNarabeRooms({ cpuDelay = 650, random = Math.random } = {}) {
  const rooms = new Map();
  const send = (ws, data) => { if (ws.readyState === 1) ws.send(JSON.stringify(data)); };
  function broadcast(room) {
    room.updated = Date.now();
    room.people.forEach((p, seat) => send(p.ws, { type: 'state', code: room.code, seat, host: seat === 0,
      people: room.people.map(x => ({ name: x.name, ready: x.ready })), game: room.game ? { ...E.view(room.game, seat), presenting: Boolean(room.presenting) } : null }));
  }
  function cpu(room) {
    clearTimeout(room.timer);
    if (!room.game || room.game.over || room.presenting) return;
    const seat=E.actorSeats(room.game).find(seat=>seat>=room.people.length);
    if(seat===undefined)return;
    room.timer = setTimeout(() => {
      const action=E.aiAction(room.game,seat);
      if(action)E.act(room.game,seat,action,random);
      broadcast(room); cpu(room);
    }, cpuDelay);
    room.timer.unref?.();
  }
  function releaseDeal(room, force = false) {
    if (!room.presenting || (!force && !room.people.every(p => p.ws.readyState !== 1 || room.dealReady.has(p)))) return;
    clearTimeout(room.dealTimer); room.presenting = false; broadcast(room); cpu(room);
  }
  const sweep = setInterval(() => {
    for (const [code, room] of rooms) if (Date.now() - room.updated > 2 * 60 * 60 * 1000) {
      clearTimeout(room.timer); clearTimeout(room.dealTimer); room.people.forEach(p => p.ws.close(1000, '部屋の有効期限が切れました')); rooms.delete(code);
    }
  }, 60000); sweep.unref?.();
  function connect(ws) {
    let room = null, person = null, count = 0, second = 0;
    ws.on('message', raw => {
      try {
        if (raw.length > 4096) return ws.close(1009);
        const now = Math.floor(Date.now() / 1000); if (second !== now) { second = now; count = 0; }
        if (++count > 30) return ws.close(1008);
        const m = JSON.parse(raw.toString());
        if (!room) {
          if (!['create', 'join'].includes(m.type)) throw Error('部屋を作成、または入室してください。');
          if (m.type === 'create') {
            if (rooms.size >= 200) throw Error('部屋が混み合っています。');
            let code; do { code = crypto.randomInt(100000, 1000000).toString(); } while (rooms.has(code));
            room = { code, people: [], game: null, updated: Date.now(), timer: null }; rooms.set(code, room);
          } else {
            room = rooms.get(String(m.code || '').trim());
            if (!room) throw Error('部屋が見つかりません。');
            if (room.game || room.people.length >= 6) { room = null; throw Error('開始済み、または満員の部屋です。'); }
          }
          person = { ws, name: String(m.name || 'チバトル学生').trim().slice(0, 20) || 'チバトル学生', ready: false };
          room.people.push(person); broadcast(room); return;
        }
        const seat = room.people.indexOf(person);
        if (seat < 0) return;
        if (m.type === 'ready' && !room.game) { person.ready = !person.ready; broadcast(room); }
        else if (m.type === 'start' && seat === 0 && !room.game) {
          const total = Number(m.total);
          if (!Number.isInteger(total) || total < Math.max(2, room.people.length) || total > 6) throw Error('人数は入室者以上の2〜6人を選んでください。');
          if (!room.people.every(p => p.ready)) throw Error('全員の準備OKを待ってください。');
          const names = room.people.map(p => p.name);
          while (names.length < total) names.push(`CPU ${names.length - room.people.length + 1}`);
          room.game = E.create(names,random); room.presenting = true; room.dealReady = new Set();
          room.dealTimer = setTimeout(() => releaseDeal(room, true), 30000); room.dealTimer.unref?.();
          broadcast(room);
        } else if (m.type === 'dealt' && room.game) {
          room.dealReady.add(person); releaseDeal(room);
        } else if (m.type === 'action' && room.game && (m.revision === room.game.revision
          || (m.action?.type==='choice' && Number.isInteger(m.action.requestId)
            && m.action.requestId===room.game.pending?.requestId))) {
          if (room.presenting) throw Error('全員の配札演出が終わるまでお待ちください。');
          if (!E.act(room.game, seat, m.action || {},random)) throw Error('今はその操作を行えません。');
          broadcast(room); cpu(room);
        }
      } catch (err) { send(ws, { type: 'error', message: err instanceof SyntaxError ? '通信データが不正です。' : err.message }); }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (!room || !person) return;
      const seat = room.people.indexOf(person); if (seat < 0) return;
      if (room.game) { E.forfeit(room.game, seat); releaseDeal(room); broadcast(room); cpu(room); }
      else { room.people.splice(seat, 1); room.people.forEach(p => { p.ready = false; }); broadcast(room); }
      if (!room.people.some(p => p.ws.readyState === 1)) { clearTimeout(room.timer); clearTimeout(room.dealTimer); rooms.delete(room.code); }
    });
    send(ws, { type: 'hello', mode: 'narabe', version: 1 });
  }
  return { connect, close() { clearInterval(sweep); rooms.forEach(r => { clearTimeout(r.timer); clearTimeout(r.dealTimer); r.people.forEach(p => p.ws.close()); }); rooms.clear(); } };
}
module.exports = { createNarabeRooms };
