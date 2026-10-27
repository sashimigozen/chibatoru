const Replay = require('../../online-replay.js');
module.exports = function fixture(){
  const rec=Replay.createRecorder();
  const student={baseId:'general_student',name:'一般学生',instanceId:'student-1',attack:2,hp:2,currentHp:2};
  const ruler={baseId:'ruler',name:'定規',instanceId:'ruler-1'};
  const state={players:{player:{life:20,will:1,maxWill:1,hand:[student],deck:[ruler],board:{teacher:null,seats:Array(9).fill(null)}},opponent:{life:20,will:0,maxWill:0,hand:[ruler],deck:[student],board:{teacher:null,seats:Array(9).fill(null)}}}};
  const events=[];
  const add=e=>{e.eventSeq=events.length+1;events.push(e);rec.record('event',e);rec.checkpoint(state,e.eventType);};
  add({eventType:'game_start',game:{firstSide:'opponent',decks:{}}});
  add({eventType:'coin_toss',call:'heads',result:'heads',winner:'opponent'});
  add({eventType:'order_choice',side:'opponent',chose:'first',firstSide:'opponent'});
  add({eventType:'mulligan',side:'opponent',initialHand:[{cardId:'ruler'}],returnedCards:[],redrawnCards:[],returnedCount:0,redrawnCount:0});
  add({eventType:'turn_start',actionTurn:1,phase:'battle',side:'opponent',turn:'先攻1ターン目',handCount:1,life:20,will:1,maxWill:1});
  state.players.opponent.hand=[];
  add({eventType:'action',actionType:'use_item',actionTurn:1,side:'opponent',cardName:'定規',cost:1});
  state.players.player.hand.push(ruler);state.players.player.deck=[];
  // Opening draw happens before turn_start; actionTurn assigns it to the right turn.
  add({eventType:'action',actionType:'draw',actionTurn:2,phase:'battle',side:'player',cardName:'定規'});
  add({eventType:'turn_start',actionTurn:2,phase:'battle',side:'player',turn:'後攻1ターン目',handCount:2,life:20,will:1,maxWill:1});
  state.players.player.hand=[ruler];state.players.player.board.seats[0]=student;
  add({eventType:'action',actionType:'play_card',actionTurn:2,side:'player',cardName:'一般学生',cost:2,targetZone:'seat',targetSeat:{index:0,row:1,column:1}});
  state.lectureRoomCheck=true;
  state.players.opponent.life=18;
  add({eventType:'effect',effectType:'damage_life',actionTurn:2,side:'player',chosenTargets:[{side:'opponent'}],damageDistribution:{dealt:2}});
  add({eventType:'game_end',final:{winner:'player',reason:'テスト結果'}});
  return {gameId:'readable-match',summary:{playerNames:{player:'太郎',opponent:'花子'}},events,trace:{schemaVersion:1,entries:rec.entries}};
};
