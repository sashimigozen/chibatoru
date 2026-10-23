(() => {
  'use strict';
  document.getElementById('onlineFourMatchButton')?.addEventListener('click', () => {
    try { sessionStorage.setItem('chibatoru-narabe-name', window.__chibattle?.state?.profile?.username || 'チバトル学生'); } catch {}
    location.href = 'narabe-test/index.html';
  });
})();
