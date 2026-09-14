(() => {
  const form = document.getElementById('authForm');
  if (!form) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (typeof window.login === 'function') window.login();
  }, true);
})();
