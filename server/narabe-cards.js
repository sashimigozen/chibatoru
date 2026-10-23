/* Fixed selections for the isolated Narabe test. Abilities never execute here. */
(function(root,factory){const data=factory();if(typeof module==='object'&&module.exports)module.exports=data;else root.NarabeCards=data;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const types = [{id:'student',label:'学生'},{id:'teacher',label:'教師'},{id:'vampire',label:'ヴァンパイア'},{id:'item',label:'持ち物'},{id:'environment',label:'環境'}];
  const cards = [
  {
    "baseId": "aggro_student",
    "name": "アグロ大学生",
    "type": "student",
    "cost": 1,
    "attack": 1,
    "hp": 1
  },
  {
    "baseId": "general_student",
    "name": "一般学生",
    "type": "student",
    "cost": 2,
    "attack": 2,
    "hp": 2
  },
  {
    "baseId": "yuta",
    "name": "U太",
    "type": "student",
    "cost": 3,
    "attack": 3,
    "hp": 3
  },
  {
    "baseId": "elite_open_chatter",
    "name": "エリートオープンチャッター",
    "type": "student",
    "cost": 4,
    "attack": 3,
    "hp": 6
  },
  {
    "baseId": "lone_wolf",
    "name": "狼(いっぴきおおかみ)",
    "type": "student",
    "cost": 5,
    "attack": 2,
    "hp": 2
  },
  {
    "baseId": "seat_taking_group",
    "name": "席取り軍団",
    "type": "student",
    "cost": 6,
    "attack": 3,
    "hp": 3
  },
  {
    "baseId": "spoon_wizard",
    "name": "スプーンの魔術師",
    "type": "student",
    "cost": 7,
    "attack": 2,
    "hp": 3
  },
  {
    "baseId": "loud_student",
    "name": "バカでかい声の学生",
    "type": "student",
    "cost": 8,
    "attack": 7,
    "hp": 9
  },
  {
    "baseId": "extra_people",
    "name": "エキストラの皆さん",
    "type": "student",
    "cost": 9,
    "attack": 2,
    "hp": 2
  },
  {
    "baseId": "infight_shogi",
    "name": "インファイト将棋部",
    "type": "student",
    "cost": 10,
    "attack": 9,
    "hp": 5
  },
  {
    "baseId": "general_teacher",
    "name": "一般教師",
    "type": "teacher",
    "cost": 3,
    "attack": 1,
    "hp": 2
  },
  {
    "baseId": "lightning_n",
    "name": "デザインデーモンスレイヤー",
    "type": "teacher",
    "cost": 4,
    "attack": 2,
    "hp": 2
  },
  {
    "baseId": "logic_hunter",
    "name": "ロジックハンター",
    "type": "teacher",
    "cost": 5,
    "attack": 1,
    "hp": 3
  },
  {
    "baseId": "kyoto_sound_i",
    "name": "ネガティブトーカー",
    "type": "teacher",
    "cost": 7,
    "attack": 3,
    "hp": 3
  },
  {
    "baseId": "thin_professor_h",
    "name": "細い教授",
    "type": "teacher",
    "cost": 8,
    "attack": 3,
    "hp": 3
  },
  {
    "baseId": "ninety_three_teacher",
    "name": "驚異の93歳講師",
    "type": "teacher",
    "cost": 9,
    "attack": 3,
    "hp": 4
  },
  {
    "baseId": "president",
    "name": "学長",
    "type": "teacher",
    "cost": 10,
    "attack": 3,
    "hp": 3
  },
  {
    "baseId": "zombie",
    "name": "ゾンビ",
    "type": "vampire",
    "cost": 3,
    "attack": 2,
    "hp": 1
  },
  {
    "baseId": "cafeteria_lady",
    "name": "食堂のおばちゃん",
    "type": "vampire",
    "cost": 4,
    "attack": 1,
    "hp": 2
  },
  {
    "baseId": "apprentice_vampire",
    "name": "見習いヴァンパイア",
    "type": "vampire",
    "cost": 5,
    "attack": 2,
    "hp": 2
  },
  {
    "baseId": "chen_san",
    "name": "陳さん",
    "type": "vampire",
    "cost": 7,
    "attack": 3,
    "hp": 3
  },
  {
    "baseId": "gigi_blood",
    "name": "偽魏義ッ血",
    "type": "vampire",
    "cost": 8,
    "attack": 2,
    "hp": 4
  },
  {
    "baseId": "vampire",
    "name": "CITヴァンパイア",
    "type": "vampire",
    "cost": 10,
    "attack": 10,
    "hp": 10
  },
  {
    "baseId": "ruler",
    "name": "定規",
    "type": "item",
    "cost": 1,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "environment_setup",
    "name": "環境構築",
    "type": "item",
    "cost": 2,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "onigiri_draw",
    "name": "おにぎりドロー",
    "type": "item",
    "cost": 3,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "thin_item",
    "name": "細い",
    "type": "item",
    "cost": 4,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "seriously_hit",
    "name": "ガチでしばくぞ",
    "type": "item",
    "cost": 5,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "abyss",
    "name": "深淵",
    "type": "item",
    "cost": 6,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "greeting_3000",
    "name": "挨拶だけで3000字",
    "type": "item",
    "cost": 7,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "green_curry",
    "name": "グリーンカレー",
    "type": "item",
    "cost": 9,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "classroom",
    "name": "一般教室",
    "type": "environment",
    "cost": 1,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "cafeteria",
    "name": "食堂",
    "type": "environment",
    "cost": 2,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "gangi_fortress",
    "name": "雁木囲い",
    "type": "environment",
    "cost": 3,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "academic_move",
    "name": "アカデミックムーブ",
    "type": "environment",
    "cost": 4,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "meguro_library",
    "name": "目黒区図書館",
    "type": "environment",
    "cost": 5,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "student_council",
    "name": "学友会",
    "type": "environment",
    "cost": 6,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "full_lock",
    "name": "全ロック",
    "type": "environment",
    "cost": 7,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "cote_dazur",
    "name": "コートダジュール",
    "type": "environment",
    "cost": 8,
    "attack": 0,
    "hp": 0
  },
  {
    "baseId": "kakiage_teacher",
    "name": "かき揚げ教師",
    "type": "teacher",
    "cost": 6,
    "attack": 2,
    "hp": 4
  },
  {
    "baseId": "jobs_woody",
    "name": "ジョブズウッディ",
    "type": "vampire",
    "cost": 6,
    "attack": 3,
    "hp": 3
  },
  {
    "baseId": "window_eater",
    "name": "窓辺イーター",
    "type": "vampire",
    "cost": 9,
    "attack": 4,
    "hp": 5
  },
  {
    "baseId": "ittan",
    "name": "一旦",
    "type": "item",
    "cost": 8,
    "attack": 0,
    "hp": 0
  }
];
  cards.forEach(c=>{c.suit=types.findIndex(t=>t.id===c.type);c.rank=c.cost;c.id=c.suit*10+c.rank-1;Object.freeze(c);});
  return Object.freeze({types:Object.freeze(types.map(Object.freeze)),cards:Object.freeze(cards),start:5,ranks:10});
});

