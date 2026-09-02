const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const ALLOWED_ORIGIN = '*';
const REPO = 'jipsy-danger/convo';
const BRANCH = 'main';
const MAX_MESSAGE_LENGTH = 4000;
const MAX_NAME_LENGTH = 40;

function cors(extra = {}) {
  return {
    ...JSON_HEADERS,
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Convo-Pin',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}

function response(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: cors(extra) });
}

function error(message, status = 400) {
  return response({ ok: false, error: message }, status);
}

function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
}

function validPin(pin) {
  return /^\d{4}$/.test(String(pin ?? ''));
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'convo-api',
  };
}

async function githubGet(env, path) {
  const url = `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`;
  const res = await fetch(url, { headers: githubHeaders(env), cf: { cacheTtl: 0, cacheEverything: false } });
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`);
  const json = await res.json();
  const text = atob(json.content.replace(/\n/g, ''));
  return { value: JSON.parse(text), sha: json.sha };
}

async function githubPut(env, path, value, sha, message) {
  const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(value, null, 2) + '\n')));
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...githubHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content, branch: BRANCH, sha }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub PUT ${path}: ${res.status}`);
    err.status = res.status;
    err.detail = text;
    throw err;
  }
  return res.json();
}

async function readJson(env, path, fallback) {
  try { return await githubGet(env, path); }
  catch (e) {
    if (e.message.includes('GitHub GET') && e.message.endsWith(': 404')) return { value: fallback, sha: null };
    throw e;
  }
}

async function updateJson(env, path, mutate, commitMessage, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await readJson(env, path, []);
    const next = await mutate(structuredClone(current.value));
    try {
      if (!current.sha) {
        // The repository should contain the data files. Keeping creation here makes first deployment forgiving.
        const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(next, null, 2) + '\n')));
        const res = await fetch(url, { method: 'PUT', headers: { ...githubHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify({ message: commitMessage, content, branch: BRANCH }) });
        if (!res.ok) throw Object.assign(new Error(`GitHub create ${path}: ${res.status}`), { status: res.status });
      } else {
        await githubPut(env, path, next, current.sha, commitMessage);
      }
      return next;
    } catch (e) {
      lastError = e;
      if (e.status !== 409) throw e;
    }
  }
  throw lastError || new Error('Concurrent update failed');
}

async function authenticate(env, pin, name, requestedSuperAdmin) {
  if (!validPin(pin)) return error('PIN must be exactly 4 digits.', 401);
  const usersFile = await readJson(env, 'data/users.json', []);
  const users = Array.isArray(usersFile.value) ? usersFile.value : [];
  let user = users.find(u => u.pin === pin);

  if (!user) {
    if (requestedSuperAdmin && pin === '4999') {
      user = { pin, name: 'Atitya', role: 'superadmin', createdAt: new Date().toISOString() };
      await updateJson(env, 'data/users.json', list => [...list, user], 'chore: register super admin');
      return response({ ok: true, isNew: false, user });
    }
    if (!name) return response({ ok: true, isNew: true });
    const safeName = cleanName(name);
    if (!safeName) return error('Display name is required.');
    user = { pin, name: safeName, role: 'user', createdAt: new Date().toISOString() };
    await updateJson(env, 'data/users.json', list => [...list, user], `convo: register ${safeName}`);
    return response({ ok: true, isNew: false, user });
  }

  if (user.pin === '4999' && user.role !== 'superadmin') return error('Invalid super admin configuration.', 403);
  return response({ ok: true, isNew: false, user });
}

async function requireUser(env, request) {
  const pin = request.headers.get('X-Convo-Pin') || '';
  if (!validPin(pin)) throw new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: cors() });
  const { value } = await readJson(env, 'data/users.json', []);
  const user = (Array.isArray(value) ? value : []).find(u => u.pin === pin);
  if (!user) throw new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: cors() });
  return user;
}

function canDeleteMessage(user, message) {
  return user.role === 'superadmin' || message.pin === user.pin || (user.role === 'admin' && message.role === 'user');
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (path === '/auth' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return authenticate(env, String(body.pin || ''), body.name, Boolean(body.isSuperAdmin));
      }

      const user = await requireUser(env, request);

      if (path === '/channels' && request.method === 'GET') {
        const { value } = await readJson(env, 'data/channels.json', [{ id: 'general', name: 'general', description: 'Common community thread', createdBy: 'system' }]);
        return response({ ok: true, channels: value });
      }

      if (path === '/messages' && request.method === 'GET') {
        const channel = url.searchParams.get('channel') || 'general';
        const { value } = await readJson(env, 'data/messages.json', []);
        const messages = (Array.isArray(value) ? value : []).filter(m => (m.channel || 'general') === channel).slice(-300);
        return response({ ok: true, messages });
      }

      if (path === '/messages' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const channel = String(body.channel || 'general').trim().slice(0, 60);
        const text = String(body.text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
        if (!text) return error('Message cannot be empty.');
        if (!channel) return error('Channel is required.');
        const message = { id: Date.now(), channel, pin: user.pin, author: user.name, role: user.role, time: new Date().toISOString(), text };
        await updateJson(env, 'data/messages.json', list => [...(Array.isArray(list) ? list : []), message].slice(-5000), `convo: message by ${user.name}`);
        return response({ ok: true, message });
      }

      const messageMatch = path.match(/^\/messages\/(\d+)$/);
      if (messageMatch && request.method === 'DELETE') {
        const id = Number(messageMatch[1]);
        await updateJson(env, 'data/messages.json', list => {
          const message = list.find(m => Number(m.id) === id);
          if (!message) throw Object.assign(new Error('Message not found.'), { status: 404 });
          if (!canDeleteMessage(user, message)) throw Object.assign(new Error('Forbidden.'), { status: 403 });
          return list.filter(m => Number(m.id) !== id);
        }, `convo: delete message ${id}`);
        return response({ ok: true });
      }

      if (path === '/channels' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const name = String(body.name || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        const description = cleanName(body.description || 'Project discussion');
        if (!name || name === 'general') return error('Choose a valid channel name.');
        const channel = { id: name, name, description: description || 'Project discussion', createdBy: user.pin, createdAt: new Date().toISOString() };
        await updateJson(env, 'data/channels.json', list => {
          const channels = Array.isArray(list) ? list : [];
          if (channels.some(c => c.id === name)) throw Object.assign(new Error('Channel already exists.'), { status: 409 });
          return [...channels, channel];
        }, `convo: create channel #${name}`);
        return response({ ok: true, channel });
      }

      if (path === '/channels' && request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id || id === 'general') return error('The general channel cannot be deleted.');
        if (!['admin', 'superadmin'].includes(user.role)) return error('Forbidden.', 403);
        await updateJson(env, 'data/channels.json', list => (Array.isArray(list) ? list : []).filter(c => c.id !== id), `convo: delete channel #${id}`);
        return response({ ok: true });
      }

      if (path === '/users' && request.method === 'GET') {
        if (user.role !== 'superadmin') return error('Forbidden.', 403);
        const { value } = await readJson(env, 'data/users.json', []);
        return response({ ok: true, users: value });
      }

      if (path === '/users/role' && request.method === 'PUT') {
        if (user.role !== 'superadmin') return error('Forbidden.', 403);
        const body = await request.json().catch(() => ({}));
        const pin = String(body.pin || '');
        const role = String(body.role || 'user');
        if (!validPin(pin) || !['admin', 'user'].includes(role) || pin === user.pin) return error('Invalid role change.');
        await updateJson(env, 'data/users.json', list => (Array.isArray(list) ? list : []).map(u => u.pin === pin ? { ...u, role } : u), `convo: change role for ${pin}`);
        return response({ ok: true });
      }

      return error('Not found.', 404);
    } catch (e) {
      console.error(e);
      return error(e.message || 'Server error.', e.status || 500);
    }
  },
};
