(() => {
  'use strict';
  const opener = document.getElementById('onlineFourMatchButton');
  const mainApp = document.getElementById('appRoot');
  let screen = null, frame = null;
  let previousInert = false;
  function closeNarabe() {
    if (!screen) return;
    screen.remove(); screen = null; frame = null;
    document.documentElement.classList.remove('narabe-embedded-open');
    document.body.classList.remove('narabe-embedded-open');
    if (mainApp) mainApp.inert = previousInert;
    opener?.focus({ preventScroll: true });
  }
  opener?.addEventListener('click', () => {
    if (screen) return;
    try { sessionStorage.setItem('chibatoru-narabe-name', window.__chibattle?.state?.profile?.username || 'チバトル学生'); } catch {}
    const destination=new URL('narabe/index.html',location.href);
    destination.searchParams.set('embedded', '1');
    destination.searchParams.set('v', '0.32.0-room-3');
    const customServer=new URLSearchParams(location.search).get('ws');
    if(customServer)destination.searchParams.set('ws',customServer);
    screen = document.createElement('section');
    screen.id = 'narabeEmbeddedScreen'; screen.className = 'narabe-embedded-screen';
    screen.setAttribute('aria-label', 'チバトル並べ'); screen.setAttribute('aria-busy', 'true');
    const loading = document.createElement('div'); loading.className = 'narabe-mode-loading';
    const message = document.createElement('p'); message.textContent = 'チバトル並べを読み込んでいます…';
    message.setAttribute('role', 'status');
    const cancel = document.createElement('button'); cancel.type = 'button';
    cancel.className = 'button secondary'; cancel.textContent = '戻る'; cancel.addEventListener('click', closeNarabe);
    loading.append(message, cancel);
    frame = document.createElement('iframe'); frame.id = 'narabeEmbeddedFrame';
    frame.className = 'narabe-embedded-frame'; frame.title = 'チバトル並べ'; frame.hidden = true;
    const currentFrame = frame, currentScreen = screen;
    frame.addEventListener('load', () => {
      if (frame !== currentFrame) return;
      loading.hidden = true; currentFrame.hidden = false;
      currentScreen.setAttribute('aria-busy', 'false'); currentFrame.focus();
    });
    frame.addEventListener('error', () => {
      if (frame === currentFrame) message.textContent = '読み込めませんでした。戻ってからもう一度お試しください。';
    });
    frame.src = destination.href;
    screen.append(frame, loading); document.body.append(screen);
    if (mainApp) { previousInert = mainApp.inert; mainApp.inert = true; }
    document.documentElement.classList.add('narabe-embedded-open');
    document.body.classList.add('narabe-embedded-open');
    cancel.focus();
  });
  window.addEventListener('message', event => {
    if (frame && event.source === frame.contentWindow && event.origin === location.origin
      && event.data?.type === 'chibatoru-narabe-close') closeNarabe();
  });
})();
