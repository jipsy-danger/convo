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
    "Access-Control-Allow-Headers":
      "Content-Type, X-Convo-Pin, Authorization",
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
  return response(
    {
      ok: false,
      error: message,
    },
    status
  );
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

async function supabaseFetch(
  env,
  table,
  options = {}
) {
  const {
    method = "GET",
    query = "",
    body = undefined,
    headers = {},
  } = options;

  const res = await fetch(
    supabaseUrl(env, table, query),
    {
      method,
      headers: supabaseHeaders(env, headers),
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body),
    }
  );

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

    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/*
 * Supabase REST can paginate responses.
 * This helper retrieves the complete table in batches.
 */
async function supabaseGetAll(env, table, select = "*") {
  const results = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const rows = await supabaseFetch(env, table, {
      query:
        `?select=${encodeURIComponent(select)}` +
        `&limit=${pageSize}` +
        `&offset=${offset}`,
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
      `&pin=eq.${encodeURIComponent(pin)}` +
      `&limit=1`,
  });

  return Array.isArray(users) && users.length
    ? users[0]
    : null;
}

async function getUserById(env, id) {
  const users = await supabaseFetch(env, "users", {
    query:
      `?select=id,pin,name,role,created_at,last_activity_at` +
      `&id=eq.${encodeURIComponent(id)}` +
      `&limit=1`,
  });

  return Array.isArray(users) && users.length
    ? users[0]
    : null;
}

async function authenticate(
  env,
  pin,
  name,
  requestedSuperAdmin
) {
  if (!validPin(pin)) {
    return error("PIN must be exactly 4 digits.", 401);
  }

  let user = await getUserByPin(env, pin);

  /*
   * Existing account.
   */
  if (user) {
    if (
      user.pin === "4999" &&
      user.role !== "superadmin"
    ) {
      return error(
        "Invalid super admin configuration.",
        403
      );
    }

    await touchUserActivity(env, user.id);

    user = await getUserById(env, user.id);

    return response({
      ok: true,
      isNew: false,
      user: formatUser(user),
    });
  }

  /*
   * Super admin.
   *
   * The frontend Shift-key state is not trusted here.
   * PIN 4999 is the server-side superadmin credential.
   */
  if (pin === "4999") {
    if (!requestedSuperAdmin) {
      return error(
        "Super admin access requires the super admin login.",
        403
      );
    }

    const inserted = await supabaseFetch(env, "users", {
      method: "POST",
      query: "?select=id,pin,name,role,created_at,last_activity_at",
      body: {
        pin: "4999",
        name: "Atitya",
        role: "superadmin",
      },
      headers: {
        Prefer: "return=representation",
      },
    });

    user = Array.isArray(inserted)
      ? inserted[0]
      : inserted;

    await recordActivity(
      env,
      user.id,
      null,
      "VIEWED"
    );

    return response({
      ok: true,
      isNew: true,
      user: formatUser(user),
    });
  }

  /*
   * Normal user.
   */
  if (!name) {
    return response({
      ok: true,
      isNew: true,
    });
  }

  const safeName = cleanName(name);

  if (!safeName) {
    return error("Display name is required.");
  }

  const inserted = await supabaseFetch(env, "users", {
    method: "POST",
    query: "?select=id,pin,name,role,created_at,last_activity_at",
    body: {
      pin,
      name: safeName,
      role: "user",
    },
    headers: {
      Prefer: "return=representation",
    },
  });

  user = Array.isArray(inserted)
    ? inserted[0]
    : inserted;

  return response({
    ok: true,
    isNew: false,
    user: formatUser(user),
  });
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

async function requireUser(env, request) {
  const pin =
    request.headers.get("X-Convo-Pin") || "";

  if (!validPin(pin)) {
    throw Object.assign(
      new Error("Unauthorized"),
      { status: 401 }
    );
  }

  const user = await getUserByPin(env, pin);

  if (!user) {
    throw Object.assign(
      new Error("Unauthorized"),
      { status: 401 }
    );
  }

  return user;
}

async function touchUserActivity(env, userId) {
  await supabaseFetch(env, "users", {
    method: "PATCH",
    query: `?id=eq.${encodeURIComponent(userId)}`,
    body: {
      last_activity_at: new Date().toISOString(),
    },
    headers: {
      Prefer: "return=minimal",
    },
  });
}

async function getChannelByName(env, name) {
  const channels = await supabaseFetch(env, "channels", {
    query:
      `?select=id,name,description,created_by,created_at` +
      `&name=eq.${encodeURIComponent(name)}` +
      `&limit=1`,
  });

  return Array.isArray(channels) && channels.length
    ? channels[0]
    : null;
}

async function ensureGeneralChannel(env) {
  let channel = await getChannelByName(
    env,
    "general"
  );

  if (channel) return channel;

  const inserted = await supabaseFetch(
    env,
    "channels",
    {
      method: "POST",
      query:
        "?select=id,name,description,created_by,created_at",
      body: {
        name: "general",
        description: "Common community thread",
        created_by: null,
      },
      headers: {
        Prefer: "return=representation",
      },
    }
  );

  return Array.isArray(inserted)
    ? inserted[0]
    : inserted;
}

async function ensureChannelMember(
  env,
  channelId,
  userId
) {
  await supabaseFetch(
    env,
    "channel_members",
    {
      method: "POST",
      query: "",
      body: {
        channel_id: channelId,
        user_id: userId,
      },
      headers: {
        Prefer:
          "resolution=merge-duplicates,return=minimal",
      },
    }
  );
}

async function recordActivity(
  env,
  userId,
  channelId,
  action
) {
  if (!userId || !action) return;

  await supabaseFetch(
    env,
    "channel_activity",
    {
      method: "POST",
      body: {
        user_id: userId,
        channel_id: channelId,
        action,
      },
      headers: {
        Prefer: "return=minimal",
      },
    }
  );

  await touchUserActivity(env, userId);
}

async function formatMessage(message, user = null) {
  return {
    id: message.id,
    channel: message.channel_name,
    channelId: message.channel_id,
    pin: user?.pin ?? message.user_pin,
    author: user?.name ?? message.user_name,
    role: user?.role ?? message.user_role,
    text: message.text,
    time: message.created_at,
    createdAt: message.created_at,
  };
}

async function getMessagesForChannel(
  env,
  channelId
) {
  const rows = await supabaseFetch(
    env,
    "messages",
    {
      query:
        `?select=id,channel_id,user_id,text,created_at,` +
        `users(pin,name,role),` +
        `channels(name)` +
        `&channel_id=eq.${encodeURIComponent(
          channelId
        )}` +
        `&order=created_at.asc` +
        `&limit=300`,
    }
  );

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

async function createChannel(
  env,
  user,
  name,
  description
) {
  const safeName = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_CHANNEL_LENGTH);

  if (!safeName || safeName === "general") {
    throw Object.assign(
      new Error("Choose a valid channel name."),
      { status: 400 }
    );
  }

  const existing = await getChannelByName(
    env,
    safeName
  );

  if (existing) {
    throw Object.assign(
      new Error("Channel already exists."),
      { status: 409 }
    );
  }

  const inserted = await supabaseFetch(
    env,
    "channels",
    {
      method: "POST",
      query:
        "?select=id,name,description,created_by,created_at",
      body: {
        name: safeName,
        description:
          cleanName(description) ||
          "Project discussion",
        created_by: user.id,
      },
      headers: {
        Prefer: "return=representation",
      },
    }
  );

  const channel = Array.isArray(inserted)
    ? inserted[0]
    : inserted;

  await ensureChannelMember(
    env,
    channel.id,
    user.id
  );

  await recordActivity(
    env,
    user.id,
    channel.id,
    "JOINED"
  );

  return channel;
}

function canDeleteMessage(user, message) {
  return (
    user.role === "superadmin" ||
    message.user_id === user.id ||
    (user.role === "admin" &&
      message.user_role === "user")
  );
}

async function getAnalytics(env) {
  const [
    users,
    channels,
    messages,
    members,
    activities,
  ] = await Promise.all([
    supabaseGetAll(
      env,
      "users",
      "id,pin,name,role,created_at,last_activity_at"
    ),
    supabaseGetAll(
      env,
      "channels",
      "id,name,description,created_by,created_at"
    ),
    supabaseGetAll(
      env,
      "messages",
      "id,channel_id,user_id,text,created_at"
    ),
    supabaseGetAll(
      env,
      "channel_members",
      "channel_id,user_id,joined_at,last_viewed_at"
    ),
    supabaseGetAll(
      env,
      "channel_activity",
      "id,user_id,channel_id,action,created_at"
    ),
  ]);

  const now = Date.now();

  /*
   * Active = activity within the last 24 hours.
   */
  const ACTIVE_WINDOW = 24 * 60 * 60 * 1000;

  const activeUserIds = new Set();

  for (const activity of activities) {
    if (
      activity.created_at &&
      now -
        new Date(activity.created_at).getTime() <=
        ACTIVE_WINDOW
    ) {
      activeUserIds.add(activity.user_id);
    }
  }

  /*
   * Message counts.
   */
  const userMessageCount = new Map();
  const channelMessageCount = new Map();

  for (const message of messages) {
    userMessageCount.set(
      message.user_id,
      (userMessageCount.get(message.user_id) || 0) + 1
    );

    channelMessageCount.set(
      message.channel_id,
      (channelMessageCount.get(message.channel_id) || 0) +
        1
    );
  }

  /*
   * Channel users.
   */
  const channelUsers = new Map();

  for (const member of members) {
    if (!channelUsers.has(member.channel_id)) {
      channelUsers.set(
        member.channel_id,
        new Set()
      );
    }

    channelUsers
      .get(member.channel_id)
      .add(member.user_id);
  }

  /*
   * Last activity by user.
   */
  const lastUserActivity = new Map();

  for (const activity of activities) {
    const old = lastUserActivity.get(
      activity.user_id
    );

    if (
      !old ||
      new Date(activity.created_at) >
        new Date(old)
    ) {
      lastUserActivity.set(
        activity.user_id,
        activity.created_at
      );
    }
  }

  /*
   * Last activity by channel.
   */
  const lastChannelActivity = new Map();

  for (const activity of activities) {
    if (!activity.channel_id) continue;

    const old = lastChannelActivity.get(
      activity.channel_id
    );

    if (
      !old ||
      new Date(activity.created_at) >
        new Date(old)
    ) {
      lastChannelActivity.set(
        activity.channel_id,
        activity.created_at
      );
    }
  }

  /*
   * User analytics.
   */
  const userAnalytics = users.map((user) => {
    const usedChannels = new Set();

    for (const message of messages) {
      if (message.user_id === user.id) {
        usedChannels.add(message.channel_id);
      }
    }

    for (const member of members) {
      if (member.user_id === user.id) {
        usedChannels.add(member.channel_id);
      }
    }

    return {
      id: user.id,
      pin: user.pin,
      name: user.name,
      role: user.role,
      channelsUsed: usedChannels.size,
      messageCount:
        userMessageCount.get(user.id) || 0,
      lastActivity:
        lastUserActivity.get(user.id) ||
        user.last_activity_at ||
        user.created_at,
    };
  });

  /*
   * Channel analytics.
   */
  const channelAnalytics = channels.map(
    (channel) => ({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      uniqueUsers:
        channelUsers.get(channel.id)?.size || 0,
      messageCount:
        channelMessageCount.get(channel.id) || 0,
      lastActivity:
        lastChannelActivity.get(channel.id) ||
        channel.created_at,
    })
  );

  return {
    generatedAt: new Date().toISOString(),

    stats: {
      totalUsers: users.length,

      totalAdmins: users.filter(
        (u) => u.role === "admin"
      ).length,

      totalSuperAdmins: users.filter(
        (u) => u.role === "superadmin"
      ).length,

      totalChannels: channels.length,

      activeUsers: activeUserIds.size,

      activeChannels: new Set(
        activities
          .filter(
            (a) =>
              a.channel_id &&
              now -
                new Date(a.created_at).getTime() <=
                ACTIVE_WINDOW
          )
          .map((a) => a.channel_id)
      ).size,

      totalMessages: messages.length,

      totalViews: activities.filter(
        (a) => a.action === "VIEWED"
      ).length,
    },

    users: userAnalytics,

    channels: channelAnalytics,
  };
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: cors(),
        });
      }

      /*
       * Make sure the Supabase environment is configured.
       */
      if (
        !env.SUPABASE_URL ||
        !env.SUPABASE_SECRET_KEY
      ) {
        return error(
          "Supabase environment variables are not configured.",
          500
        );
      }

      const url = new URL(request.url);

      const path =
        url.pathname.replace(/\/+$/, "") || "/";

      /*
       * AUTH
       */
      if (
        path === "/auth" &&
        request.method === "POST"
      ) {
        const body = await request
          .json()
          .catch(() => ({}));

        return authenticate(
          env,
          String(body.pin || ""),
          body.name,
          Boolean(body.isSuperAdmin)
        );
      }

      /*
       * Everything below this point requires login.
       */
      const user = await requireUser(
        env,
        request
      );

      /*
       * Update user activity whenever they interact
       * with the API.
       */
      await touchUserActivity(
        env,
        user.id
      );

      /*
       * CHANNELS - GET
       */
      if (
        path === "/channels" &&
        request.method === "GET"
      ) {
        let channels =
          await supabaseGetAll(
            env,
            "channels",
            "id,name,description,created_by,created_at"
          );

        if (!channels.length) {
          const general =
            await ensureGeneralChannel(env);

          channels = [general];
        }

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

      /*
       * CHANNELS - CREATE
       */
      if (
        path === "/channels" &&
        request.method === "POST"
      ) {
        const body = await request
          .json()
          .catch(() => ({}));

        const channel =
          await createChannel(
            env,
            user,
            body.name,
            body.description
          );

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

      /*
       * CHANNELS - DELETE
       */
      if (
        path === "/channels" &&
        request.method === "DELETE"
      ) {
        const id =
          url.searchParams.get("id");

        if (!id) {
          return error(
            "Channel id is required."
          );
        }

        if (id === "general") {
          return error(
            "The general channel cannot be deleted."
          );
        }

        if (
          !["admin", "superadmin"].includes(
            user.role
          )
        ) {
          return error(
            "Forbidden.",
            403
          );
        }

        await supabaseFetch(
          env,
          "channels",
          {
            method: "DELETE",
            query:
              `?id=eq.${encodeURIComponent(id)}`,
            headers: {
              Prefer: "return=minimal",
            },
          }
        );

        return response({
          ok: true,
        });
      }

      /*
       * MESSAGES - GET
       */
      if (
        path === "/messages" &&
        request.method === "GET"
      ) {
        const channelName =
          url.searchParams.get(
            "channel"
          ) || "general";

        let channel =
          await getChannelByName(
            env,
            channelName
          );

        if (
          !channel &&
          channelName === "general"
        ) {
          channel =
            await ensureGeneralChannel(env);
        }

        if (!channel) {
          return response({
            ok: true,
            messages: [],
          });
        }

        await ensureChannelMember(
          env,
          channel.id,
          user.id
        );

        const messages =
          await getMessagesForChannel(
            env,
            channel.id
          );

        return response({
          ok: true,
          messages,
        });
      }

      /*
       * MESSAGES - POST
       */
      if (
        path === "/messages" &&
        request.method === "POST"
      ) {
        const body = await request
          .json()
          .catch(() => ({}));

        const channelName = String(
          body.channel || "general"
        )
          .trim()
          .slice(0, MAX_CHANNEL_LENGTH);

        const text = String(
          body.text || ""
        )
          .trim()
          .slice(0, MAX_MESSAGE_LENGTH);

        if (!text) {
          return error(
            "Message cannot be empty."
          );
        }

        if (!channelName) {
          return error(
            "Channel is required."
          );
        }

        let channel =
          await getChannelByName(
            env,
            channelName
          );

        if (
          !channel &&
          channelName === "general"
        ) {
          channel =
            await ensureGeneralChannel(env);
        }

        if (!channel) {
          return error(
            "Channel not found.",
            404
          );
        }

        await ensureChannelMember(
          env,
          channel.id,
          user.id
        );

        const inserted =
          await supabaseFetch(
            env,
            "messages",
            {
              method: "POST",
              query:
                "?select=id,channel_id,user_id,text,created_at",
              body: {
                channel_id: channel.id,
                user_id: user.id,
                text,
              },
              headers: {
                Prefer:
                  "return=representation",
              },
            }
          );

        const dbMessage =
          Array.isArray(inserted)
            ? inserted[0]
            : inserted;

        await recordActivity(
          env,
          user.id,
          channel.id,
          "POSTED"
        );

        await supabaseFetch(
          env,
          "channel_members",
          {
            method: "PATCH",
            query:
              `?channel_id=eq.${encodeURIComponent(
                channel.id
              )}` +
              `&user_id=eq.${encodeURIComponent(
                user.id
              )}`,
            body: {
              last_viewed_at:
                new Date().toISOString(),
            },
            headers: {
              Prefer: "return=minimal",
            },
          }
        );

        const message = {
          id: dbMessage.id,
          channel: channel.name,
          channelId: channel.id,
          pin: user.pin,
          author: user.name,
          role: user.role,
          text: dbMessage.text,
          time: dbMessage.created_at,
          createdAt: dbMessage.created_at,
        };

        return response({
          ok: true,
          success: true,
          message,
        });
      }

      /*
       * MESSAGE - DELETE
       */
      const messageMatch =
        path.match(
          /^\/messages\/(\d+)$/
        );

      if (
        messageMatch &&
        request.method === "DELETE"
      ) {
        const id = Number(
          messageMatch[1]
        );

        const messages =
          await supabaseFetch(
            env,
            "messages",
            {
              query:
                `?select=id,channel_id,user_id,text,created_at,` +
                `users(pin,name,role)` +
                `&id=eq.${id}` +
                `&limit=1`,
            }
          );

        if (
          !Array.isArray(messages) ||
          !messages.length
        ) {
          return error(
            "Message not found.",
            404
          );
        }

        const message = messages[0];

        const messageForPermission = {
          user_id: message.user_id,
          user_role:
            message.users?.role,
        };

        if (
          !canDeleteMessage(
            user,
            messageForPermission
          )
        ) {
          return error(
            "Forbidden.",
            403
          );
        }

        await supabaseFetch(
          env,
          "messages",
          {
            method: "DELETE",
            query:
              `?id=eq.${id}`,
            headers: {
              Prefer: "return=minimal",
            },
          }
        );

        return response({
          ok: true,
        });
      }

      /*
       * ACTIVITY
       *
       * Used by the frontend when a user actually
       * opens/views a channel.
       */
      if (
        path === "/activity" &&
        request.method === "POST"
      ) {
        const body = await request
          .json()
          .catch(() => ({}));

        const channelName =
          String(
            body.channel || ""
          ).trim();

        const action =
          String(
            body.action || "VIEWED"
          ).toUpperCase();

        const allowedActions = [
          "JOINED",
          "VIEWED",
          "POSTED",
          "LEFT",
        ];

        if (
          !allowedActions.includes(
            action
          )
        ) {
          return error(
            "Invalid activity action."
          );
        }

        let channel = null;

        if (channelName) {
          channel =
            await getChannelByName(
              env,
              channelName
            );
        }

        if (
          action !== "VIEWED" &&
          !channel
        ) {
          return error(
            "Channel not found.",
            404
          );
        }

        if (channel) {
          await ensureChannelMember(
            env,
            channel.id,
            user.id
          );

          await supabaseFetch(
            env,
            "channel_members",
            {
              method: "PATCH",
              query:
                `?channel_id=eq.${encodeURIComponent(
                  channel.id
                )}` +
                `&user_id=eq.${encodeURIComponent(
                  user.id
                )}`,
              body: {
                last_viewed_at:
                  action === "VIEWED"
                    ? new Date().toISOString()
                    : undefined,
              },
              headers: {
                Prefer:
                  "return=minimal",
              },
            }
          );
        }

        await recordActivity(
          env,
          user.id,
          channel?.id || null,
          action
        );

        return response({
          ok: true,
        });
      }

      /*
       * USERS
       *
       * Superadmin only.
       */
      if (
        path === "/users" &&
        request.method === "GET"
      ) {
        if (
          user.role !== "superadmin"
        ) {
          return error(
            "Forbidden.",
            403
          );
        }

        const users =
          await supabaseGetAll(
            env,
            "users",
            "id,pin,name,role,created_at,last_activity_at"
          );

        return response({
          ok: true,
          users: users.map(formatUser),
        });
      }

      /*
       * CHANGE USER ROLE
       */
      if (
        path === "/users/role" &&
        request.method === "PUT"
      ) {
        if (
          user.role !== "superadmin"
        ) {
          return error(
            "Forbidden.",
            403
          );
        }

        const body =
          await request
            .json()
            .catch(() => ({}));

        const pin = String(
          body.pin || ""
        );

        const role = String(
          body.role || "user"
        );

        if (
          !validPin(pin) ||
          !["admin", "user"].includes(
            role
          ) ||
          pin === user.pin
        ) {
          return error(
            "Invalid role change."
          );
        }

        const target =
          await getUserByPin(
            env,
            pin
          );

        if (!target) {
          return error(
            "User not found.",
            404
          );
        }

        await supabaseFetch(
          env,
          "users",
          {
            method: "PATCH",
            query:
              `?pin=eq.${encodeURIComponent(
                pin
              )}`,
            body: {
              role,
            },
            headers: {
              Prefer:
                "return=minimal",
            },
          }
        );

        return response({
          ok: true,
        });
      }

      /*
       * ADMIN ANALYTICS
       *
       * Superadmin only.
       */
      if (
        path === "/admin/analytics" &&
        request.method === "GET"
      ) {
        if (
          user.role !== "superadmin"
        ) {
          return error(
            "Forbidden.",
            403
          );
        }

        const analytics =
          await getAnalytics(env);

        return response({
          ok: true,
          ...analytics,
        });
      }

      return error(
        "Not found.",
        404
      );
    } catch (e) {
      console.error(e);

      return error(
        e.message || "Server error.",
        e.status || 500
      );
    }
  },
};
