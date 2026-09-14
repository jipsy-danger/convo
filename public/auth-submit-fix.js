(() => {
  const form = document.getElementById('authForm');
  if (form) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof window.login === 'function') window.login();
    }, true);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    try {
      const user = JSON.parse(localStorage.getItem('convo_user') || 'null');
      if (user?.role === 'superadmin') headers.set('X-Convo-SuperAdmin', 'true');
    } catch {}
    return nativeFetch(input, { ...init, headers });
  };
})();
