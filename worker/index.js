const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const ALLOWED_ORIGIN = "*";
const MAX_MESSAGE_LENGTH = 4000;
const MAX_NAME_LENGTH = 40;
const MAX_CHANNEL_LENGTH = 40;

function cors(extra = {}) {
  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Convo-Pin, Authorization",
    "Access-Control-Max-Age": "86400",
    ...extra,
  };
}

function response(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: cors(extra),
  });
}

function error(message, status = 400) {
  return response({ ok: false, error: message }, status);
}

function cleanName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_NAME_LENGTH);
}

function validPin(pin) {
  return /^\d{4}$/.test(String(pin ?? ""));
}

function supabaseHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function supabaseUrl(env, table, query = "") {
  return `${env.SUPABASE_URL}/rest/v1/${table}${query}`;
}

async function supabaseFetch(env, table, options = {}) {
  const { method = "GET", query = "", body, headers = {} } = options;
  const res = await fetch(supabaseUrl(env, table, query), {
    method,
    headers: supabaseHeaders(env, headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      typeof data === "object" && data?.message
        ? data.message
        : typeof data === "object" && data?.error
          ? data.error
          : text || `Supabase error ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status, data });
  }

  return data;
}

async function supabaseGetAll(env, table, select = "*") {
  const results = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const rows = await supabaseFetch(env, table, {
      query:
        `?select=${encodeURIComponent(select)}` +
        `&limit=${pageSize}&offset=${offset}`,
      headers: {
        Range: `${offset}-${offset + pageSize - 1}`,
        Prefer: "count=exact",
      },
    });

    if (!Array.isArray(rows)) break;
    results.push(...rows);
    if (rows.length < pageSize) break;
  }

  return results;
}

async function getUserByPin(env, pin) {
  const users = await supabaseFetch(env, "users", {
    query:
      `?select=id,pin,name,role,created_at,last_activity_at` +
      `&pin=eq.${encodeURIComponent(pin)}&limit=1`,
  });
  return Array.isArray(users) && users.length ? users[0] : null;
}

async function getUserById(env, id) {
  const users = await supabaseFetch(env, "users", {
    query:
      `?select=id,pin,name,role,created_at,last_activity_at` +
      `&id=eq.${encodeURIComponent(id)}&limit=1`,
  });
  return Array.isArray(users) && users.length ? users[0] : null;
}

function formatUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    pin: user.pin,
    name: user.name,
    role: user.role,
    createdAt: user.created_at,
    lastActivityAt: user.last_activity_at,
  };
}

async function touchUserActivity(env, userId) {
  await supabaseFetch(env, "users", {
    method: "PATCH",
    query: `?id=eq.${encodeURIComponent(userId)}`,
    body: { last_activity_at: new Date().toISOString() },
    headers: { Prefer: "return=minimal" },
  });
}

async function authenticate(env, pin, name, requestedSuperAdmin) {
  if (!validPin(pin)) return error("PIN must be exactly 4 digits.", 401);

  let user = await getUserByPin(env, pin);

  if (user) {
    if (user.pin === "4999" && user.role !== "superadmin") {
      return error("Invalid super admin configuration.", 403);
    }
    await touchUserActivity(env, user.id);
    user = await getUserById(env, user.id);
    return response({ ok: true, isNew: false, user: formatUser(user) });
  }

  if (pin === "4999") {
    if (!requestedSuperAdmin) {
      return error("Super admin access requires the super admin login.", 403);
    }

    const inserted = await supabaseFetch(env, "users", {
      method: "POST",
      query: "?select=id,pin,name,role,created_at,last_activity_at",
      body: { pin: "4999", name: "Atitya", role: "superadmin" },
      headers: { Prefer: "return=representation" },
    });

    user = Array.isArray(inserted) ? inserted[0] : inserted;
    return response({ ok: true, isNew: true, user: formatUser(user) });
  }

  if (!name) return response({ ok: true, isNew: true });

  const safeName = cleanName(name);
  if (!safeName) return error("Display name is required.");

  const inserted = await supabaseFetch(env, "users", {
    method: "POST",
    query: "?select=id,pin,name,role,created_at,last_activity_at",
    body: { pin, name: safeName, role: "user" },
    headers: { Prefer: "return=representation" },
  });

  user = Array.isArray(inserted) ? inserted[0] : inserted;
  return response({ ok: true, isNew: false, user: formatUser(user) });
}

async function requireUser(env, request) {
  const pin = request.headers.get("X-Convo-Pin") || "";
  if (!validPin(pin)) throw Object.assign(new Error("Unauthorized"), { status: 401 });

  const user = await getUserByPin(env, pin);
  if (!user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return user;
}

async function getChannelByName(env, name) {
  const channels = await supabaseFetch(env, "channels", {
    query:
      `?select=id,name,description,created_by,created_at` +
      `&name=eq.${encodeURIComponent(name)}&limit=1`,
  });
  return Array.isArray(channels) && channels.length ? channels[0] : null;
}

async function ensureGeneralChannel(env) {
  const existing = await getChannelByName(env, "general");
  if (existing) return existing;

  const inserted = await supabaseFetch(env, "channels", {
    method: "POST",
    query: "?select=id,name,description,created_by,created_at",
    body: {
      name: "general",
      description: "Common community thread",
      created_by: null,
    },
    headers: { Prefer: "return=representation" },
  });

  return Array.isArray(inserted) ? inserted[0] : inserted;
}

/* Returns true only when this request creates the membership. */
async function ensureChannelMember(env, channelId, userId) {
  const existing = await supabaseFetch(env, "channel_members", {
    query:
      `?select=channel_id,user_id` +
      `&channel_id=eq.${encodeURIComponent(channelId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  });

  if (Array.isArray(existing) && existing.length) return false;

  await supabaseFetch(env, "channel_members", {
    method: "POST",
    body: { channel_id: channelId, user_id: userId },
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
  });

  return true;
}

async function updateChannelViewed(env, channelId, userId) {
  await supabaseFetch(env, "channel_members", {
    method: "PATCH",
    query:
      `?channel_id=eq.${encodeURIComponent(channelId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    body: { last_viewed_at: new Date().toISOString() },
    headers: { Prefer: "return=minimal" },
  });
}

/* Superadmin activity is intentionally excluded from channel_activity. */
async function recordActivity(env, user, channelId, action) {
  if (!user?.id || !action || user.role === "superadmin") return;

  await supabaseFetch(env, "channel_activity", {
    method: "POST",
    body: {
      user_id: user.id,
      channel_id: channelId,
      action,
    },
    headers: { Prefer: "return=minimal" },
  });

  await touchUserActivity(env, user.id);
}

async function getMessagesForChannel(env, channelId) {
  const rows = await supabaseFetch(env, "messages", {
    query:
      `?select=id,channel_id,user_id,text,created_at,users(pin,name,role),channels(name)` +
      `&channel_id=eq.${encodeURIComponent(channelId)}` +
      `&order=created_at.asc&limit=300`,
  });

  if (!Array.isArray(rows)) return [];

  return rows.map((m) => ({
    id: m.id,
    channel: m.channels?.name || "general",
    channelId: m.channel_id,
    pin: m.users?.pin,
    author: m.users?.name,
    role: m.users?.role,
    text: m.text,
    time: m.created_at,
    createdAt: m.created_at,
  }));
}

async function createChannel(env, user, name, description) {
  const safeName = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_CHANNEL_LENGTH);

  if (!safeName || safeName === "general") {
    throw Object.assign(new Error("Choose a valid channel name."), { status: 400 });
  }

  if (await getChannelByName(env, safeName)) {
    throw Object.assign(new Error("Channel already exists."), { status: 409 });
  }

  const inserted = await supabaseFetch(env, "channels", {
    method: "POST",
    query: "?select=id,name,description,created_by,created_at",
    body: {
      name: safeName,
      description: cleanName(description) || "Project discussion",
      created_by: user.id,
    },
    headers: { Prefer: "return=representation" },
  });

  const channel = Array.isArray(inserted) ? inserted[0] : inserted;
  const joined = await ensureChannelMember(env, channel.id, user.id);
  if (joined) await recordActivity(env, user, channel.id, "JOINED");

  return channel;
}

function canDeleteMessage(user, message) {
  return (
    user.role === "superadmin" ||
    message.user_id === user.id ||
    (user.role === "admin" && message.user_role === "user")
  );
}

async function getAnalytics(env) {
  const [users, channels, messages, members, activities] = await Promise.all([
    supabaseGetAll(env, "users", "id,pin,name,role,created_at,last_activity_at"),
    supabaseGetAll(env, "channels", "id,name,description,created_by,created_at"),
    supabaseGetAll(env, "messages", "id,channel_id,user_id,text,created_at"),
    supabaseGetAll(env, "channel_members", "channel_id,user_id,joined_at,last_viewed_at"),
    supabaseGetAll(env, "channel_activity", "id,user_id,channel_id,action,created_at"),
  ]);

  const now = Date.now();
  const ACTIVE_WINDOW = 24 * 60 * 60 * 1000;
  const activeUserIds = new Set();

  for (const activity of activities) {
    if (
      activity.created_at &&
      now - new Date(activity.created_at).getTime() <= ACTIVE_WINDOW
    ) {
      activeUserIds.add(activity.user_id);
    }
  }

  const userMessageCount = new Map();
  const channelMessageCount = new Map();

  for (const message of messages) {
    userMessageCount.set(
      message.user_id,
      (userMessageCount.get(message.user_id) || 0) + 1
    );
    channelMessageCount.set(
      message.channel_id,
      (channelMessageCount.get(message.channel_id) || 0) + 1
    );
  }

  const channelUsers = new Map();
  for (const member of members) {
    if (!channelUsers.has(member.channel_id)) {
      channelUsers.set(member.channel_id, new Set());
    }
    channelUsers.get(member.channel_id).add(member.user_id);
  }

  const lastUserActivity = new Map();
  for (const activity of activities) {
    const old = lastUserActivity.get(activity.user_id);
    if (!old || new Date(activity.created_at) > new Date(old)) {
      lastUserActivity.set(activity.user_id, activity.created_at);
    }
  }

  const lastChannelActivity = new Map();
  for (const activity of activities) {
    if (!activity.channel_id) continue;
    const old = lastChannelActivity.get(activity.channel_id);
    if (!old || new Date(activity.created_at) > new Date(old)) {
      lastChannelActivity.set(activity.channel_id, activity.created_at);
    }
  }

  const userAnalytics = users.map((user) => {
    const usedChannels = new Set();
    for (const message of messages) {
      if (message.user_id === user.id) usedChannels.add(message.channel_id);
    }
    for (const member of members) {
      if (member.user_id === user.id) usedChannels.add(member.channel_id);
    }

    return {
      id: user.id,
      pin: user.pin,
      name: user.name,
      role: user.role,
      channelsUsed: usedChannels.size,
      messageCount: userMessageCount.get(user.id) || 0,
      lastActivity:
        lastUserActivity.get(user.id) || user.last_activity_at || user.created_at,
    };
  });

  const channelAnalytics = channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    description: channel.description,
    uniqueUsers: channelUsers.get(channel.id)?.size || 0,
    messageCount: channelMessageCount.get(channel.id) || 0,
    lastActivity: lastChannelActivity.get(channel.id) || channel.created_at,
  }));

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      totalUsers: users.length,
      totalAdmins: users.filter((u) => u.role === "admin").length,
      totalSuperAdmins: users.filter((u) => u.role === "superadmin").length,
      totalChannels: channels.length,
      activeUsers: activeUserIds.size,
      activeChannels: new Set(
        activities
          .filter(
            (a) =>
              a.channel_id &&
              now - new Date(a.created_at).getTime() <= ACTIVE_WINDOW
          )
          .map((a) => a.channel_id)
      ).size,
      totalMessages: messages.length,
      totalViews: activities.filter((a) => a.action === "VIEWED").length,
    },
    users: userAnalytics,
    channels: channelAnalytics,
  };
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors() });
      }

      if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
        return error("Supabase environment variables are not configured.", 500);
      }

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/auth" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return authenticate(
          env,
          String(body.pin || ""),
          body.name,
          Boolean(body.isSuperAdmin)
        );
      }

      const user = await requireUser(env, request);
      await touchUserActivity(env, user.id);

      if (path === "/channels" && request.method === "GET") {
        let channels = await supabaseGetAll(
          env,
          "channels",
          "id,name,description,created_by,created_at"
        );

        if (!channels.length) channels = [await ensureGeneralChannel(env)];

        return response({
          ok: true,
          channels: channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            description: channel.description,
            createdBy: channel.created_by,
            createdAt: channel.created_at,
          })),
        });
      }

      if (path === "/channels" && request.method === "POST") {
        if (!["admin", "superadmin"].includes(user.role)) {
          return error("Forbidden.", 403);
        }

        const body = await request.json().catch(() => ({}));
        const channel = await createChannel(env, user, body.name, body.description);

        return response({
          ok: true,
          channel: {
            id: channel.id,
            name: channel.name,
            description: channel.description,
            createdBy: channel.created_by,
            createdAt: channel.created_at,
          },
        });
      }

      if (path === "/channels" && request.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (!id) return error("Channel id is required.");
        if (id === "general") return error("The general channel cannot be deleted.");
        if (!["admin", "superadmin"].includes(user.role)) {
          return error("Forbidden.", 403);
        }

        await supabaseFetch(env, "channels", {
          method: "DELETE",
          query: `?id=eq.${encodeURIComponent(id)}`,
          headers: { Prefer: "return=minimal" },
        });

        return response({ ok: true });
      }

      if (path === "/messages" && request.method === "GET") {
        const channelName = url.searchParams.get("channel") || "general";
        let channel = await getChannelByName(env, channelName);

        if (!channel && channelName === "general") {
          channel = await ensureGeneralChannel(env);
        }

        if (!channel) return response({ ok: true, messages: [] });

        const joined = await ensureChannelMember(env, channel.id, user.id);
        if (joined) await recordActivity(env, user, channel.id, "JOINED");

        const messages = await getMessagesForChannel(env, channel.id);

        /* Worker-enforced view tracking; browser does not need to send VIEWED. */
        await updateChannelViewed(env, channel.id, user.id);
        await recordActivity(env, user, channel.id, "VIEWED");

        return response({ ok: true, messages });
      }

      if (path === "/messages" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const channelName = String(body.channel || "").trim().toLowerCase();
        const text = String(body.text || "").trim();

        if (!channelName) return error("Channel is required.");
        if (!text) return error("Message cannot be empty.");
        if (text.length > MAX_MESSAGE_LENGTH) {
          return error(`Message exceeds ${MAX_MESSAGE_LENGTH} characters.`);
        }

        const channel = await getChannelByName(env, channelName);
        if (!channel) return error("Channel not found.", 404);

        const joined = await ensureChannelMember(env, channel.id, user.id);
        if (joined) await recordActivity(env, user, channel.id, "JOINED");

        const inserted = await supabaseFetch(env, "messages", {
          method: "POST",
          query: "?select=id,channel_id,user_id,text,created_at",
          body: { channel_id: channel.id, user_id: user.id, text },
          headers: { Prefer: "return=representation" },
        });

        const message = Array.isArray(inserted) ? inserted[0] : inserted;
        await recordActivity(env, user, channel.id, "POSTED");

        return response({
          ok: true,
          message: {
            id: message.id,
            channel: channel.name,
            channelId: message.channel_id,
            pin: user.pin,
            author: user.name,
            role: user.role,
            text: message.text,
            time: message.created_at,
            createdAt: message.created_at,
          },
        });
      }

      if (path.startsWith("/messages/") && request.method === "DELETE") {
        const id = path.split("/").pop();
        if (!id) return error("Message id is required.");

        const rows = await supabaseFetch(env, "messages", {
          query:
            `?select=id,channel_id,user_id,text,created_at,users(pin,name,role)` +
            `&id=eq.${encodeURIComponent(id)}&limit=1`,
        });

        const message = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!message) return error("Message not found.", 404);

        const permissionMessage = {
          ...message,
          user_role: message.users?.role || "user",
        };

        if (!canDeleteMessage(user, permissionMessage)) {
          return error("Forbidden.", 403);
        }

        await supabaseFetch(env, "messages", {
          method: "DELETE",
          query: `?id=eq.${encodeURIComponent(id)}`,
          headers: { Prefer: "return=minimal" },
        });

        await recordActivity(env, user, message.channel_id, "POSTED");
        return response({ ok: true });
      }

      if (path === "/activity" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const action = String(body.action || "VIEWED").toUpperCase();

        if (!["JOINED", "VIEWED", "POSTED", "LEFT"].includes(action)) {
          return error("Invalid activity action.");
        }

        let channelId = null;
        if (body.channel) {
          const channel = await getChannelByName(
            env,
            String(body.channel).trim().toLowerCase()
          );
          if (!channel) return error("Channel not found.", 404);
          channelId = channel.id;

          if (action === "VIEWED") {
            await ensureChannelMember(env, channelId, user.id);
            await updateChannelViewed(env, channelId, user.id);
          }
        }

        await recordActivity(env, user, channelId, action);
        return response({ ok: true });
      }

      if (path === "/users" && request.method === "GET") {
        if (user.role !== "superadmin") return error("Forbidden.", 403);

        const users = await supabaseGetAll(
          env,
          "users",
          "id,pin,name,role,created_at,last_activity_at"
        );
        return response({ ok: true, users: users.map(formatUser) });
      }

      if (path === "/users/role" && request.method === "PUT") {
        if (user.role !== "superadmin") return error("Forbidden.", 403);

        const body = await request.json().catch(() => ({}));
        const pin = String(body.pin || "");
        const role = String(body.role || "");

        if (!validPin(pin)) return error("Valid user PIN is required.");
        if (!["user", "admin"].includes(role)) {
          return error("Role must be user or admin.");
        }
        if (pin === "4999") {
          return error("The super admin cannot be changed.", 403);
        }

        const target = await getUserByPin(env, pin);
        if (!target) return error("User not found.", 404);

        await supabaseFetch(env, "users", {
          method: "PATCH",
          query: `?id=eq.${encodeURIComponent(target.id)}`,
          body: { role },
          headers: { Prefer: "return=minimal" },
        });

        return response({ ok: true });
      }

      if (path === "/analytics" && request.method === "GET") {
        if (user.role !== "superadmin") return error("Forbidden.", 403);
        return response(await getAnalytics(env));
      }

      return error("Not found.", 404);
    } catch (err) {
      console.error(err);
      return error(err?.message || "Internal server error.", err?.status || 500);
    }
  },
};
