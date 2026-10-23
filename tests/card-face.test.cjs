'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {render}=require('../card-face.js');
test('並べのカード描画倍率は移動中の見かけの大きさではなくレイアウト寸法から計算する',async()=>{
  let Card,scale;const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const context={URL,document:{baseURI:'http://localhost/narabe-test/'},HTMLElement:class{},CSSStyleSheet:class{replaceSync(){}},customElements:{define(_name,Type){Card=Type;}},fetch:async()=>({ok:true,text:async()=>source}),ResizeObserver:class{observe(){}disconnect(){}},window:{Narabe:{cards:[{baseId:'general_student',name:'一般学生',type:'student',cost:2,attack:2,hp:2}],types:[{id:'student',label:'学生'}]},ChibattleCardFace:{render:()=>''}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../narabe-test/original-card.js'),'utf8'),context);
  await context.window.NarabeOriginalCard.ready;
  const host=new Card();host.dataset={baseId:'general_student'};host.clientWidth=105;host.clientHeight=160;
  host.getBoundingClientRect=()=>{throw Error('変形後の寸法を描画倍率へ使ってはいけない');};
  host.shadowRoot={querySelector:()=>({style:{setProperty(_key,value){scale=Number(value);}}})};
  host.connectedCallback();assert.equal(scale,.25);
});
test('並べの戦意は通常の手札の大きい円表示を直接使い、二重表示しない',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');let css='';
  const context={URL,document:{baseURI:'http://localhost/narabe-test/'},HTMLElement:class{},CSSStyleSheet:class{replaceSync(text){css=text;}},customElements:{define(){}},fetch:async()=>({ok:true,text:async()=>source}),window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../narabe-test/original-card.js'),'utf8'),context);
  await context.window.NarabeOriginalCard.ready;
  assert.match(css,/\.card\.deck-window-card \.hand-card-stats \.stat-cost\s*\{[^}]*width: 108px !important/);
  assert.match(css,/\.card\.deck-window-card \.hand-card-stats \.stat-cost\s*\{[^}]*font-size: 50px !important/);
  assert.ok(css.includes('.card.deck-window-card .card-header>.stat-cost{display:none!important}'));
  assert.ok(css.includes('.card.deck-window-card .hand-card-stats>.card-stat:not(.stat-cost){display:none!important}'));
});
test('共通化前と同一のカードHTMLを返す（装飾・状態・戦意・能力値を保持）',()=>{
  const original="      if (!boardCard) {\n        return `\n          <div class=\"card-scale-stage\">\n            ${rarityMirrorSurfaceHtml(card)}\n            <div class=\"card-face\">\n              ${rewardPrismSurfaceHtml(card)}\n              <div class=\"card-header\">\n                ${costBadge}\n                <div class=\"card-name\">${escapeHtml(card.name)}</div>\n                ${type}\n              </div>\n              <div class=\"card-art-panel\" aria-label=\"イラスト枠\">\n                <div class=\"card-art-name\">${escapeHtml(card.name)}</div>\n                ${privateCounter}\n                ${status}\n              </div>\n              <div class=\"card-effect-panel\" aria-hidden=\"true\">\n                ${attackBadge}\n                ${hpBadge}\n                ${defenseBadge}\n              </div>\n            </div>\n            <div class=\"hand-card-stats\" aria-hidden=\"true\">\n              ${costBadge}\n              ${attackBadge}\n              ${hpBadge}\n            </div>\n          </div>\n        `;\n      }\n";
  const legacy=vm.runInNewContext('(function(card,costBadge,type,attackBadge,hpBadge,defenseBadge,privateCounter,status){const boardCard=false;const escapeHtml=x=>x;const rarityMirrorSurfaceHtml=()=>"MIRROR";const rewardPrismSurfaceHtml=()=>"PRISM";'+original+'})');
  for(const name of ['一般学生','ロジックハンター','見習いヴァンパイア','ガチでしばくぞ','目黒区図書館']){
    const values={nameHtml:name,typeHtml:'TYPE',costBadge:'COST',attackBadge:'ATTACK',hpBadge:'HP',defenseBadge:'DEFENSE',privateCounter:'COUNTER',status:'STATUS',mirrorSurface:'MIRROR',prismSurface:'PRISM'};
    assert.equal(render(values),legacy({name},'COST','TYPE','ATTACK','HP','DEFENSE','COUNTER','STATUS'));
  }
});
test('通常版は同じ描画部品を読み込み、スクリプト構文も有効',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.ok(source.includes('<script src="card-face.js"></script>'));
  assert.ok(source.includes('return window.ChibattleCardFace.render('));
  for(const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1]);
});
