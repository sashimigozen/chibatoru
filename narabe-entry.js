(() => {
  'use strict';
  document.getElementById('onlineFourMatchButton')?.addEventListener('click', () => {
    try { sessionStorage.setItem('chibatoru-narabe-name', window.__chibattle?.state?.profile?.username || 'チバトル学生'); } catch {}
    const destination=new URL('narabe/index.html',location.href);
    const customServer=new URLSearchParams(location.search).get('ws');
    if(customServer)destination.searchParams.set('ws',customServer);
    location.href = destination.href;
  });
})();
