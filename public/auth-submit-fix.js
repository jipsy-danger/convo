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

    const requestUrl = typeof input === 'string' ? input : input?.url || '';
    return nativeFetch(input, { ...init, headers }).then(response => {
      try {
        const path = new URL(requestUrl, window.location.href).pathname;
        if (path.endsWith('/activity') && !response.ok) {
          return new Response(JSON.stringify({ ok: true, nonFatal: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch {}
      return response;
    });
  };
})();
