/* The economy is one authoritative record. Existing style saves are a replayable
 * projection, never the authority for CP or a purchase. No card rules live here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChibattleGachaCore = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const KEY = "chibattle-gacha-v1";
  const PERSONAL_GIFT_ID = "personal-cp:2026-10-10";
  const BACKUP_KEYS = ["chibattle-saved-decks-v1", "chibattle-specialty-decks-v1", "chibattle-chaos-decks-v1", "chibattle-player-profile-v1", "chibattle-dungeon-card-styles-v1", "chibattle-dungeon-run-v1", "chibattle-dungeon-pending-reward-v1", "chibattle-deleted-starter-decks-v1", "chibattle-starter-decks-seeded-v1"];
  const list = (s) => s.trim().split(/\s+/);
  const PACKS = [
    { id: "cynical", name: "Cynical Legends", count: 122, color: "#829cb5", cards: list(`aggro_student aggro_king single_cell adjective_student general_student yuta aggro_queen ae_student hurried_student lazy_student cancel_student back_question_student best_friend laughing_front_student eaten_student trpg_member ttb predator student_comedy acting_out_man seat_taking_group sniper cynical_student loud_student college_student_vibe enemy_student fridge_thief extra_people angry_maker elite_open_chatter word_increaser impossible_pink_fat loud_group ta_killer dark_yuta general_teacher fairy_t popular_c lightning_n kyushu_info_c pro_k signal_professor_m logic_hunter kyoto_sound_i kansai_voice_t bird_a thin_professor_h ninety_three_teacher president suzaku ai_chan oni_shima_ai france_asakura demon_a_plus cafeteria_lady curry_treater chen_san tissue_distributor impossible_high_note vampire zombie ruler bento yakiniku environment_setup fluid_pasta water_2l onigiri_draw hondara fire_touch thin_item handy_jet_engine dos_attack destroy_dos_attack i_got_it substitute_attendance iv_pack accelerate chameleon yuta_umbrella red_happi wet_meal_ticket circle_crab hair_crab homeless_crab quiet_please seriously_hit chigauyo favorite_number_s sexual_eye yoyu_announce vampirization green_curry panpan capture paired_existence peaceful_mind abyss dropped_cards reversal dont_worry namen_tenno yutakun_yutakun three_gestures music_detergent donguri thanks_all_students alpha classroom cafeteria night_pool gangi_fortress seat_rules student_council full_lock design_domain chaos_world no_late_time meguro_library dorm_council on_demand_business cote_dazur`), ur: list("general_student adjective_student ae_student elite_open_chatter trpg_member general_teacher chen_san onigiri_draw night_pool") },
    { id: "endless", name: "Endless Struggle", count: 45, color: "#af9790", cards: list(`super_ae_student enemy_boss live_person dobby pachin_uni protein_drinker failure_student success_student bounce_day yocchan trendy_student rebirth_student lone_wolf proliferating_enemy delayed_student infight_shogi aiben nyotei apprentice_vampire aggro_eater ux_design_textbook handmade_ctoc night_pool_water go_home smart_me sock_block deck_without yamanashi_minimum_wage baka_mac ikemasu set_log sage_legacy greeting_3000 full_throttle scared_me front_door door_front back_door furious_comeback stand_up building_12_classroom raptor_temple door_war shogi_duel_field aiben_vs_nyotei_title_match`), ur: list("nyotei aiben apprentice_vampire ikemasu raptor_temple") },
    { id: "awakening", name: "Ultimate Awakening", count: 38, color: "#b0a47c", cards: list(`scout_student ta_squad happy_blue_bird suit_student bust_suit intern tokyo_tech_bro absolute_woman loud_members small_omata wood_gitch gitch gigi_blood aggro_army king_ghidorah_bed diamond_dust happy_experience go_away course_registration_party lie_pekora big_wall think_so illegal_cafeteria earphones tsurai_nara company_one_day enough_to_fly ii_daro_tte quick_quiz_tournament summer_teacher brother_capital padlock crotch_febreze smoke_flare one_eyed_peek big_laughter forbidden_book philosophy_cheating`), ur: list("absolute_woman small_omata gigi_blood king_ghidorah_bed quick_quiz_tournament") },
    { id: "echoes", name: "Laboratory Echoes", count: 50, color: "#8eaba7", cards: list(`absent_student strong_student pad_present_creator cursed_students strict_lateness_teacher leaving_on_time_lecturer cornering_lecturer pure_destruction destructive_lie aggro_kingdom yabe classroom_change annoying_na childhood_memory_tutuapp efficient_experiment_method hat_man academic_move confucius_says gesture_student diligent_student plump_student aggro_princess aggro_walk red_ideology illness igidakatta contrarian_portal stress_hair laser_beam attitude folder_galaxy variable_student sweet_curry spoon_wizard adjective_vs_cynical suffix_sugi yakitori_harassment starbucks_student overfitting_student loud_typing_student tiny_rhythm_student apprentice_best_friend white_student true_enemy enemy_horde rear_queen enemy_enemy enemy_revive triple_enemy salt_to_enemy`), ur: list("overfitting_student triple_enemy cornering_lecturer efficient_experiment_method aggro_kingdom") }
  ];
  const MODES = ["normal", "rare", "superRare", "ultraRare"];
  const WEIGHTS = [[65000, 30000, 4935, 65], [30000, 50000, 19800, 200]];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const integer = (x, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= 0 && x <= max;
  const record = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const pack = (id) => { const p = PACKS.find((p) => p.id === id); if (!p) throw new Error("パックが見つかりません。"); return p; };
  function initial() {
    return { version: 1, revision: 0, cp: 0, packs: Object.fromEntries(PACKS.map((p) => [p.id, { total: 0, miss: 0, tickets: 0 }])), owned: {}, events: {}, gifts: {}, pending: null, recovery: null };
  }
  function validate(s) {
    if (!s || s.version !== 1 || !integer(s.cp) || !integer(s.revision)) throw new Error("ガチャデータが破損しています。上書きせず、バックアップから復元してください。");
    for (const p of PACKS) {
      const v = s.packs?.[p.id];
      if (!v || !integer(v.total) || !integer(v.miss, 9) || !integer(v.tickets) || v.tickets > Math.floor(v.total / 200)) throw new Error("パックの進捗が不正です。");
    }
    if (![s.packs, s.owned, s.events, s.gifts].every(record)) throw new Error("保存形式が不正です。");
    const ids = new Set(PACKS.flatMap((p) => p.cards));
    for (const [id, styles] of Object.entries(s.owned)) {
      if (!ids.has(id) || !record(styles) || Object.entries(styles).some(([m, v]) => !MODES.slice(1).includes(m) || v !== true)) throw new Error("解放データが不正です。");
      if (styles.ultraRare && !PACKS.some((p) => p.ur.includes(id))) throw new Error("URデータが不正です。");
    }
    for (const [id, value] of Object.entries(s.events)) if (!id || id.length > 200 || value !== true) throw new Error("報酬記録が不正です。");
    for (const [id, g] of Object.entries(s.gifts)) if (!(id === "initial-cp" || id === PERSONAL_GIFT_ID || /^dungeon:[a-z0-9_]+:(5|10)$/.test(id)) || !g || g.amount !== (id === PERSONAL_GIFT_ID ? 1000000 : id === "initial-cp" || id.endsWith(":5") ? 50 : 100) || typeof g.claimed !== "boolean" || typeof g.label !== "string") throw new Error("プレゼントが不正です。");
    if (s.pending !== null) {
      const q = s.pending, p = pack(q.packId);
      if (typeof q.id !== "string" || !Array.isArray(q.results) || ![1, 10].includes(q.results.length) || !integer(q.index, q.results.length - 1) || !["handoff", "tear", "cards", "summary"].includes(q.phase) || !integer(q.revealed, 5) || typeof q.urPause !== "boolean") throw new Error("開封記録が不正です。");
      for (const row of q.results) if (!Array.isArray(row) || row.length !== 5 || row.some((c) => !MODES.includes(c.mode) || !(c.mode === "ultraRare" ? p.ur : p.cards).includes(c.baseId))) throw new Error("抽選結果が不正です。");
    }
    if (s.recovery !== null) validateProjection(s.recovery);
    return clone(s);
  }
  function validateProjection(data) {
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((key) => !BACKUP_KEYS.includes(key))) throw new Error("バックアップ対象が不正です。");
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && (typeof value !== "string" || value.length > 2000000)) throw new Error("バックアップ形式が不正です。");
      if (value !== null && key !== "chibattle-starter-decks-seeded-v1") JSON.parse(value);
    }
    return data;
  }
  function sample(weights, rng) {
    const r = rng(); if (!(r >= 0 && r < 1)) throw new Error("乱数が不正です。");
    let n = Math.floor(r * weights.reduce((a, b) => a + b, 0));
    for (let i = 0; i < weights.length; i++) { if (n < weights[i]) return i; n -= weights[i]; }
    throw new Error("抽選できませんでした。");
  }
  function draw(p, mode, rng) {
    const pool = mode === "ultraRare" ? p.ur : p.cards;
    return { baseId: pool[sample(Array(pool.length).fill(1), rng)], mode };
  }
  function grant(s, c) { if (c.mode !== "normal") (s.owned[c.baseId] ||= {})[c.mode] = true; }
  function purchase(source, id, count, rng, purchaseId) {
    const s = validate(source), p = pack(id), progress = s.packs[id];
    if (![1, 10].includes(count)) throw new Error("購入数が不正です。");
    if (s.pending) throw new Error("購入済みのパックを先に確認してください。");
    if (PACKS.some((p) => s.packs[p.id].tickets > 0)) throw new Error("URを交換してから購入してください。");
    if (s.cp < count * 5) throw new Error("CPが不足しています。");
    const results = [];
    for (let i = 0; i < count; i++) {
      const cards = Array.from({ length: 5 }, (_, slot) => draw(p, MODES[sample(WEIGHTS[slot === 4 ? 1 : 0], rng)], rng));
      let high = cards.some((c) => ["superRare", "ultraRare"].includes(c.mode));
      if (!high && progress.miss === 9) {
        cards[4] = draw(p, sample([99, 1], rng) === 0 ? "superRare" : "ultraRare", rng); high = true;
      }
      progress.miss = high ? 0 : progress.miss + 1;
      progress.total++; if (progress.total % 200 === 0) progress.tickets++;
      cards.forEach((c) => grant(s, c)); results.push(cards);
    }
    s.cp -= count * 5;
    s.pending = { id: purchaseId, packId: id, results, index: 0, phase: "handoff", revealed: 0, urPause: false };
    return s;
  }
  function exchange(s, id, baseId) {
    const p = pack(id); if (!p.ur.includes(baseId) || s.packs[id].tickets < 1) throw new Error("このカードは交換できません。");
    s.packs[id].tickets--; grant(s, { baseId, mode: "ultraRare" });
  }
  function reward(s, { id, amount }) {
    if (!id || id.length > 200 || ![5, 50, 100].includes(amount)) throw new Error("報酬が不正です。");
    if (s.events[id]) return false;
    s.events[id] = true; s.cp += amount; return true;
  }
  function migrate(s, specialties) {
    // A stable gift ID keeps the initial grant one-time for new and existing saves.
    if (!s.gifts["initial-cp"]) s.gifts["initial-cp"] = { amount: 50, label: "初期CPプレゼント", claimed: false };
    for (const { id, name } of specialties) for (const [floor, amount] of [[5, 50], [10, 100]]) {
      const key = `dungeon:${id}:${floor}`;
      if (s.events[key] || s.gifts[key]) continue;
      s.events[key] = true; s.gifts[key] = { amount, label: `${name}・${floor}階 初回クリア`, claimed: false };
    }
  }
  function claim(s, id = null) {
    for (const [key, g] of Object.entries(s.gifts)) if ((!id || key === id) && !g.claimed) { s.cp += g.amount; g.claimed = true; }
  }
  function receivePersonalGift(s, data) {
    if (data?.format !== 'chibattle-personal-gift' || data.version !== 1 || data.id !== PERSONAL_GIFT_ID || data.amount !== 1000000) throw new Error('配布ファイルの形式が不正です。');
    if (s.gifts[PERSONAL_GIFT_ID]) return false;
    s.gifts[PERSONAL_GIFT_ID] = { amount: 1000000, label: '個人用CPプレゼント', claimed: false };
    return true;
  }
  class Store {
    constructor(storage, lock, rng = Math.random) { this.storage = storage; this.lock = lock; this.rng = rng; }
    read() { const raw = this.storage.getItem(KEY); return raw === null ? initial() : validate(JSON.parse(raw)); }
    async transact(fn) {
      if (!this.lock) throw new Error("このブラウザでは安全な保存ロックが利用できません。最新版のブラウザをご利用ください。");
      return this.lock(KEY, async () => {
        const before = this.read(); if (before.recovery) throw new Error("バックアップの復元を完了してください。");
        const next = clone(before); const result = await fn(next); next.revision++;
        const valid = validate(next); this.storage.setItem(KEY, JSON.stringify(valid)); return { state: valid, result };
      });
    }
    buy(id, count, purchaseId) { return this.transact((s) => Object.assign(s, purchase(s, id, count, this.rng, purchaseId))); }
    restore(economy, projection) {
      const next = validate(economy); next.recovery = validateProjection(projection);
      return this.transact((s) => Object.assign(s, next));
    }
  }
  // Called before the main game loads its existing saves. An interrupted import
  // resumes from the same record; it can never add CP or replay a purchase.
  function recover(storage) {
    const raw = storage.getItem(KEY); if (!raw) return false;
    const s = validate(JSON.parse(raw)); if (!s.recovery) return false;
    for (const [key, value] of Object.entries(s.recovery)) { if (value === null) storage.removeItem(key); else storage.setItem(key, value); }
    s.recovery = null; storage.setItem(KEY, JSON.stringify(s));
    return true;
  }
  return { KEY, BACKUP_KEYS, PACKS, MODES, WEIGHTS, initial, validate, validateProjection, sample, purchase, exchange, reward, migrate, claim, receivePersonalGift, Store, recover };
});
