/* The normal game's unchanged front-face markup, shared with isolated previews. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ChibattleCardFace=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function render({nameHtml,typeHtml,costBadge='',attackBadge='',hpBadge='',defenseBadge='',mirrorSurface='',prismSurface='',privateCounter='',status=''}){
    return `
          <div class="card-scale-stage">
            ${mirrorSurface}
            <div class="card-face">
              ${prismSurface}
              <div class="card-header">
                ${costBadge}
                <div class="card-name">${nameHtml}</div>
                ${typeHtml}
              </div>
              <div class="card-art-panel" aria-label="イラスト枠">
                <div class="card-art-name">${nameHtml}</div>
                ${privateCounter}
                ${status}
              </div>
              <div class="card-effect-panel" aria-hidden="true">
                ${attackBadge}
                ${hpBadge}
                ${defenseBadge}
              </div>
            </div>
            <div class="hand-card-stats" aria-hidden="true">
              ${costBadge}
              ${attackBadge}
              ${hpBadge}
            </div>
          </div>
        `;
  }
  return {render};
});

