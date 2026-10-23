/* Reuse the normal card markup AND its actual styles without booting the normal game. */
(() => {
  'use strict';
  const sheet = new CSSStyleSheet();
  const sourceURL = new URL('../index.html',document.baseURI);
  const bridge = `
    :host{display:block;width:100%;height:100%;pointer-events:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .card.deck-window-card{position:relative!important;display:block!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;transform:none!important;border:0!important;border-radius:0!important;background:none!important;box-shadow:none!important;animation:none!important;filter:none!important;overflow:visible!important}
    .card.deck-window-card>.card-scale-stage{top:0!important;left:0!important;overflow:visible!important}
    .card.deck-window-card .hand-card-stats>.stat-cost{position:absolute!important;margin:0!important}
    .card.deck-window-card .card-header>.stat-cost{display:none!important}
    .card.deck-window-card .hand-card-stats>.card-stat:not(.stat-cost){display:none!important}
  `;
  const ready = fetch(sourceURL).then(response=>{
    if(!response.ok)throw Error('通常カードのスタイルを読み込めませんでした。');return response.text();
  }).then(source=>{
    const styles=[...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]);
    if(!styles.length)throw Error('通常カードのスタイルが見つかりません。');
    const css=styles.join('\n').replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(full,quote,url)=>url.startsWith('data:')||url.startsWith('#')?full:`url("${new URL(url,sourceURL).href}")`);
    // Reuse the real desktop hand's large cost circle, not a second small header badge.
    // Only cost uses the hand rail here; attack / HP keep their existing card-face positions.
    const handPrefix='.battle-screen .player-hand .hand-card .hand-card-stats';
    const handStyles=css.slice(css.indexOf('/* Keep the three hand-card values legible'));
    const costRules=['','.card-stat','.stat-cost'].map(suffix=>{
      const selector=handPrefix+(suffix?' '+suffix:'');
      const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const rule=handStyles.match(new RegExp(escaped+'\\s*\\{([^}]+)\\}'));
      if(!rule)throw Error('通常手札の戦意表示を読み込めませんでした。');
      const target='.card.deck-window-card .hand-card-stats'+(suffix?' .stat-cost':'');
      return `${target}{${rule[1]}}`;
    }).join('\n');
    sheet.replaceSync(css+'\n'+costRules+'\n'+bridge);
    // The same entrance, hold and departure keyframes as normal item use.
    const reveal=css.match(/@keyframes revealToTrash\s*\{([\s\S]*?)\n    \}/)?.[1];
    if(!reveal)throw Error('通常版の使用演出を読み込めませんでした。');
    window.NarabeOriginalCard.playRevealFrames=[...reveal.matchAll(/([\d%,\s]+)\{([^}]+)\}/g)].flatMap(rule=>rule[1].trim().split(',').map(key=>({offset:parseFloat(key)/100,opacity:rule[2].match(/opacity:\s*([^;]+);/)[1],transform:rule[2].match(/transform:\s*([^;]+);/)[1]})));
  });
  const escape = value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  class OriginalCard extends HTMLElement {
    connectedCallback(){
      if(!this.shadowRoot)this.attachShadow({mode:'open'});
      const c=window.Narabe.cards.find(c=>c.baseId===this.dataset.baseId);if(!c)return;
      const label=window.Narabe.types.find(t=>t.id===c.type).label;
      const short={student:'学生',teacher:'教師',vampire:'吸血',item:'持物',environment:'環境'}[c.type];
      const costBadge=`<span class="card-stat stat-cost" aria-label="戦意${c.cost}">${c.cost}</span>`;
      const hasStats=!['item','environment'].includes(c.type);
      const attackBadge=hasStats?`<span class="card-stat stat-attack">${c.attack}</span>`:'';
      const hpBadge=hasStats?`<span class="card-stat stat-hp">${c.hp}</span>`:'';
      const markup=window.ChibattleCardFace.render({nameHtml:escape(c.name),typeHtml:`<div class="card-type" title="${escape(label)}">${short}</div>`,costBadge,attackBadge,hpBadge});
      this.shadowRoot.adoptedStyleSheets=[sheet];
      this.shadowRoot.innerHTML=`<div class="card deck-window-card ${c.type}" data-base-id="${c.baseId}">${markup}</div>`;
      this.resize?.disconnect();
      // Layout size must not include an ancestor's animated scale / 3D rotation.
      // Otherwise an already shrunken card face can be scaled a second time by its flight.
      const sync=()=>{const width=this.clientWidth,height=this.clientHeight,stage=this.shadowRoot.querySelector('.card-scale-stage');if(width&&height)stage.style.setProperty('--card-template-scale',String(Math.min(width/420,height/640)));};
      this.resize=new ResizeObserver(sync);this.resize.observe(this);sync();
    }
    disconnectedCallback(){this.resize?.disconnect();}
  }
  customElements.define('chibatoru-original-card',OriginalCard);
  window.NarabeOriginalCard={ready};
})();
