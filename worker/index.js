const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const ALLOWED_ORIGIN = "*";
const MAX_MESSAGE_LENGTH = 15000;
const MAX_NAME_LENGTH = 40;
const MAX_CHANNEL_LENGTH = 40;
const ATTACHMENT_BUCKET = "convo-files";
const FILE_LIFETIME_MS = 5 * 60 * 60 * 1000;
const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
let lastAttachmentCleanupAt = 0;

function cors(extra = {}) {
  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Convo-Pin, X-Convo-SuperAdmin, Authorization",
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

function storageObjectUrl(env, bucket, objectPath) {
  const safePath = String(objectPath || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${env.SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${safePath}`;
}

async function storageObjectRequest(env, bucket, objectPath, options = {}) {
  const { headers = {}, ...rest } = options;
  return fetch(storageObjectUrl(env, bucket, objectPath), {
    ...rest,
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      ...headers,
    },
  });
}

async function deleteStorageObject(env, bucket, objectPath) {
  const res = await storageObjectRequest(env, bucket, objectPath, { method: "DELETE" });
  if (res.ok || res.status === 404) return;
  const text = await res.text();
  throw new Error(text || `Storage delete failed (${res.status})`);
}

function cleanFileName(value) {
  const cleaned = String(value || "file")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim()
    .slice(0, 160);
  return cleaned || "file";
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const raw = String(value || "");
  const normalized = raw
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(raw.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getDownloadTokenKey(env) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SUPABASE_SECRET_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createDownloadToken(env, attachmentId) {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        id: Number(attachmentId),
        exp: Date.now() + DOWNLOAD_TOKEN_TTL_MS,
      })
    )
  );
  const key = await getDownloadTokenKey(env);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifyDownloadToken(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
  } catch {
    return null;
  }

  if (!Number.isInteger(Number(payload?.id)) || Number(payload.id) < 1) return null;
  if (!Number.isFinite(Number(payload?.exp)) || Number(payload.exp) <= Date.now()) {
    return null;
  }

  const key = await getDownloadTokenKey(env);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(parts[1]),
    new TextEncoder().encode(parts[0])
  );
  return valid ? payload : null;
}

async function cleanupExpiredAttachments(env) {
  const now = new Date();
  const rows = await supabaseFetch(env, "message_attachments", {
    query:
      `?select=id,bucket,object_path&expires_at=lte.${encodeURIComponent(
        now.toISOString()
      )}&deleted_at=is.null&limit=100`,
  });

  for (const row of Array.isArray(rows) ? rows : []) {
    try {
      await deleteStorageObject(
        env,
        row.bucket || ATTACHMENT_BUCKET,
        row.object_path
      );
      await supabaseFetch(env, "message_attachments", {
        method: "PATCH",
        query: `?id=eq.${encodeURIComponent(row.id)}`,
        body: { deleted_at: now.toISOString() },
        headers: { Prefer: "return=minimal" },
      });
    } catch (err) {
      console.warn("Expired file cleanup failed.", err);
    }
  }
}

function scheduleExpiredAttachmentCleanup(env, ctx) {
  const now = Date.now();
  if (now - lastAttachmentCleanupAt < 60 * 1000) return;
  lastAttachmentCleanupAt = now;
  const cleanup = cleanupExpiredAttachments(env).catch((err) =>
    console.warn("Expired file cleanup sweep failed.", err)
  );
  if (ctx?.waitUntil) ctx.waitUntil(cleanup);
}

async function deleteAttachmentObjectsForMessages(env, messageIds) {
  if (!Array.isArray(messageIds) || !messageIds.length) return;
  const rows = await supabaseFetch(env, "message_attachments", {
    query:
      `?select=bucket,object_path&message_id=in.(${messageIds
        .map((id) => encodeURIComponent(id))
        .join(",")})&deleted_at=is.null`,
  });
  for (const row of Array.isArray(rows) ? rows : []) {
    try {
      await deleteStorageObject(env, row.bucket || ATTACHMENT_BUCKET, row.object_path);
    } catch (err) {
      console.warn("Message file deletion failed.", err);
    }
  }
}
/* PIN namespaces: normal users/admins and the Super Admin are separate. */
async function getUserByPin(env, pin, namespace = "normal") {
  const roleFilter = namespace === "superadmin"
    ? "&role=eq.superadmin"
    : "&role=neq.superadmin";
  const users = await supabaseFetch(env, "users", {
    query:
      `?select=id,pin,name,role,created_at,last_activity_at` +
      `&pin=eq.${encodeURIComponent(pin)}${roleFilter}&limit=1`,
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

  const namespace = requestedSuperAdmin ? "superadmin" : "normal";
  let user = await getUserByPin(env, pin, namespace);

  if (user) {
    await touchUserActivity(env, user.id);
    user = await getUserById(env, user.id);
    return response({ ok: true, isNew: false, user: formatUser(user) });
  }

  if (requestedSuperAdmin) {
    if (pin !== "4999") {
      return error("Invalid Super Admin access code.", 401);
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

  /* Normal mode: 4999 is an ordinary user PIN and may coexist with the
     Super Admin's 4999 because the database namespace is role-scoped. */
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

  const namespace = request.headers.get("X-Convo-SuperAdmin") === "true"
    ? "superadmin"
    : "normal";
  const user = await getUserByPin(env, pin, namespace);
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

async function getChannelPages(env, channelId) {
  return await supabaseFetch(env, "channel_pages", {
    query:
      `?select=id,channel_id,page_number,starts_at,created_at&channel_id=eq.${encodeURIComponent(channelId)}&order=page_number.asc`,
  });
}

async function getLastChannelPage(env, channelId) {
  const rows = await supabaseFetch(env, "channel_pages", {
    query:
      `?select=id,channel_id,page_number,starts_at,created_at&channel_id=eq.${encodeURIComponent(channelId)}&order=page_number.desc&limit=1`,
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function createNextChannelPage(env, channelId) {
  const last = await getLastChannelPage(env, channelId);
  if (last) {
    const existingMessages = await supabaseFetch(env, "messages", {
      query:
        `?select=id&channel_id=eq.${encodeURIComponent(channelId)}&page_id=eq.${encodeURIComponent(last.id)}&limit=1`,
    });
    if (!Array.isArray(existingMessages) || !existingMessages.length) {
      throw Object.assign(
        new Error("The current message page must contain at least one message before creating the next page."),
        { status: 400 }
      );
    }
  }
  const nextNumber = (last?.page_number || 0) + 1;
  const inserted = await supabaseFetch(env, "channel_pages", {
    method: "POST",
    query: "?select=id,channel_id,page_number,starts_at,created_at",
    body: {
      channel_id: channelId,
      page_number: nextNumber,
      starts_at: new Date().toISOString(),
    },
    headers: { Prefer: "return=representation" },
  });
  return Array.isArray(inserted) ? inserted[0] : inserted;
}

async function getMessagesForChannel(env, channelId, pageNumber = null) {
  let page = null;
  if (pageNumber !== null) {
    const pages = await supabaseFetch(env, "channel_pages", {
      query:
        `?select=id,channel_id,page_number,starts_at,created_at&channel_id=eq.${encodeURIComponent(channelId)}&page_number=eq.${encodeURIComponent(pageNumber)}&limit=1`,
    });
    page = Array.isArray(pages) && pages.length ? pages[0] : null;
  }
  if (!page) page = await getLastChannelPage(env, channelId);
  if (!page) return [];

  const rows = await supabaseFetch(env, "messages", {
    query:
      `?select=id,channel_id,user_id,text,created_at,quoted_message_id&channel_id=eq.${encodeURIComponent(channelId)}&page_id=eq.${encodeURIComponent(page.id)}&order=created_at.asc&limit=300`,
  });

  if (!Array.isArray(rows) || !rows.length) return [];

  const quoteIds = [...new Set(rows.map((message) => message.quoted_message_id).filter(Boolean))];
  const quoteRows = quoteIds.length
    ? await supabaseFetch(env, "messages", {
        query:
          `?select=id,channel_id,user_id,text,created_at&id=in.(${quoteIds
            .map((id) => encodeURIComponent(id))
            .join(",")})`,
      })
    : [];
  const quoteById = new Map(
    (Array.isArray(quoteRows) ? quoteRows : []).map((message) => [String(message.id), message])
  );

  const userIds = [
    ...new Set(
      rows
        .map((message) => message.user_id)
        .concat((Array.isArray(quoteRows) ? quoteRows : []).map((message) => message.user_id))
        .filter(Boolean)
    ),
  ];
  const authors = userIds.length
    ? await supabaseFetch(env, "users", {
        query:
          `?select=id,pin,name,role&id=in.(${userIds.map((id) => encodeURIComponent(id)).join(",")})`,
      })
    : [];

  const authorById = new Map(
    (Array.isArray(authors) ? authors : []).map((author) => [String(author.id), author])
  );

  const messageIds = rows.map((message) => message.id).filter(Boolean);
  const attachments = messageIds.length
    ? await supabaseFetch(env, "message_attachments", {
        query:
          `?select=id,message_id,file_name,mime_type,file_size,expires_at&message_id=in.(${messageIds
            .map((id) => encodeURIComponent(id))
            .join(",")})&expires_at=gt.${encodeURIComponent(
            new Date().toISOString()
          )}&deleted_at=is.null&order=id.asc`,
      })
    : [];

  const attachmentsByMessage = new Map();
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    const key = String(attachment.message_id);
    if (!attachmentsByMessage.has(key)) attachmentsByMessage.set(key, []);
    attachmentsByMessage.get(key).push({
      id: attachment.id,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
      fileSize: attachment.file_size,
      expiresAt: attachment.expires_at,
    });
  }

  const channelRows = await supabaseFetch(env, "channels", {
    query: `?select=name&id=eq.${encodeURIComponent(channelId)}&limit=1`,
  });
  const channelName = Array.isArray(channelRows) && channelRows[0]?.name
    ? channelRows[0].name
    : "general";

  return rows
    .map((message) => {
      const author = authorById.get(String(message.user_id));
      const files = attachmentsByMessage.get(String(message.id)) || [];
      const quoted = message.quoted_message_id
        ? quoteById.get(String(message.quoted_message_id))
        : null;
      const quotedAuthor = quoted ? authorById.get(String(quoted.user_id)) : null;
      return {
        id: message.id,
        channel: channelName,
        channelId: message.channel_id,
        pin: author?.pin,
        author: author?.name,
        role: author?.role,
        text: message.text,
        quotedMessage: quoted
          ? {
              id: quoted.id,
              author: quotedAuthor?.name || "Unknown",
              role: quotedAuthor?.role || "user",
              text: quoted.text || "",
            }
          : null,
        files,
        time: message.created_at,
        createdAt: message.created_at,
      };
    })
    .filter((message) => String(message.text || "") || message.files.length);
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
  async fetch(request, env, ctx) {
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

      const isMessageSync = path === "/messages" && request.method === "GET" && url.searchParams.get("sync") === "1";
      if (path === "/files/download" && request.method === "GET") {
        const token = url.searchParams.get("token") || "";
        const payload = await verifyDownloadToken(env, token);
        if (!payload) return error("Invalid or expired download link.", 401);

        const rows = await supabaseFetch(env, "message_attachments", {
          query:
            `?select=id,bucket,object_path,file_name,mime_type,file_size,expires_at,deleted_at&id=eq.${encodeURIComponent(
              payload.id
            )}&limit=1`,
        });
        const attachment = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!attachment) return error("File not found.", 404);
        if (
          attachment.deleted_at ||
          !attachment.expires_at ||
          new Date(attachment.expires_at).getTime() <= Date.now()
        ) {
          return error("This file share has expired.", 410);
        }

        const storageResponse = await storageObjectRequest(
          env,
          attachment.bucket || ATTACHMENT_BUCKET,
          attachment.object_path,
          { method: "GET" }
        );
        if (!storageResponse.ok) {
          if (storageResponse.status === 404) return error("File not found.", 404);
          const text = await storageResponse.text();
          return error(text || "Unable to retrieve file.", storageResponse.status);
        }

        const headers = new Headers();
        headers.set(
          "Content-Type",
          attachment.mime_type || "application/octet-stream"
        );
        headers.set(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`
        );
        headers.set("Cache-Control", "private, no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        if (attachment.file_size != null) {
          headers.set("Content-Length", String(attachment.file_size));
        }
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(storageResponse.body, {
          status: 200,
          headers,
        });
      }

      const user = await requireUser(env, request);
      if (!isMessageSync) await touchUserActivity(env, user.id);
      scheduleExpiredAttachmentCleanup(env, ctx);

      if (path === "/files/access" && request.method === "GET") {
        const attachmentId = Number(url.searchParams.get("id"));
        if (!Number.isInteger(attachmentId) || attachmentId < 1) {
          return error("Valid file id is required.");
        }

        const rows = await supabaseFetch(env, "message_attachments", {
          query:
            `?select=id,expires_at,deleted_at&id=eq.${encodeURIComponent(
              attachmentId
            )}&limit=1`,
        });
        const attachment = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!attachment) return error("File not found.", 404);
        if (
          attachment.deleted_at ||
          !attachment.expires_at ||
          new Date(attachment.expires_at).getTime() <= Date.now()
        ) {
          return error("This file share has expired.", 410);
        }

        const token = await createDownloadToken(env, attachment.id);
        return response({
          ok: true,
          url: new URL(
            `/files/download?token=${encodeURIComponent(token)}`,
            request.url
          ).toString(),
        });
      }

      if (path === "/files" && request.method === "POST") {
        const form = await request.formData();
        const channelName = String(form.get("channel") || "").trim().toLowerCase();
        const pageNumber = Number(form.get("page"));
        const file = form.get("file");

        if (!channelName) return error("Channel is required.");
        if (!Number.isInteger(pageNumber) || pageNumber < 1) {
          return error("Valid message page is required.");
        }
        if (!file || typeof file.name !== "string" || typeof file.size !== "number") {
          return error("A file is required.");
        }
        if (file.size > MAX_FILE_SIZE) {
          return error("Files must be 50 MB or smaller.");
        }

        const channel = await getChannelByName(env, channelName);
        if (!channel) return error("Channel not found.", 404);

        const joined = await ensureChannelMember(env, channel.id, user.id);
        if (joined) await recordActivity(env, user, channel.id, "JOINED");

        const pages = await supabaseFetch(env, "channel_pages", {
          query:
            `?select=id,channel_id,page_number&channel_id=eq.${encodeURIComponent(
              channel.id
            )}&page_number=eq.${encodeURIComponent(pageNumber)}&limit=1`,
        });
        const page = Array.isArray(pages) && pages.length ? pages[0] : null;
        if (!page) return error("Message page not found.", 404);

        const fileName = cleanFileName(file.name);
        const mimeType = file.type || "application/octet-stream";
        const objectPath =
          `channels/${channel.id}/pages/${page.id}/${crypto.randomUUID()}-${fileName}`;

        const storageResponse = await storageObjectRequest(
          env,
          ATTACHMENT_BUCKET,
          objectPath,
          {
            method: "POST",
            headers: {
              "Content-Type": mimeType,
              "Cache-Control": "private, max-age=0, no-store",
              "x-upsert": "false",
            },
            body: file,
          }
        );

        if (!storageResponse.ok) {
          const text = await storageResponse.text();
          return error(text || "Unable to upload file.", storageResponse.status);
        }

        const expiresAt = new Date(Date.now() + FILE_LIFETIME_MS).toISOString();
        let messageId = null;
        try {
          const insertedMessage = await supabaseFetch(env, "messages", {
            method: "POST",
            query: "?select=id,channel_id,user_id,page_id,text,created_at",
            body: {
              channel_id: channel.id,
              user_id: user.id,
              page_id: page.id,
              text: "",
            },
            headers: { Prefer: "return=representation" },
          });
          const message = Array.isArray(insertedMessage)
            ? insertedMessage[0]
            : insertedMessage;
          messageId = message?.id || null;
          if (!messageId) throw new Error("Unable to create file message.");

          await supabaseFetch(env, "message_attachments", {
            method: "POST",
            query:
              "?select=id,message_id,file_name,mime_type,file_size,expires_at",
            body: {
              message_id: messageId,
              user_id: user.id,
              bucket: ATTACHMENT_BUCKET,
              object_path: objectPath,
              file_name: fileName,
              mime_type: mimeType,
              file_size: file.size,
              expires_at: expiresAt,
            },
            headers: { Prefer: "return=representation" },
          });
        } catch (err) {
          if (messageId) {
            try {
              await supabaseFetch(env, "messages", {
                method: "DELETE",
                query: `?id=eq.${encodeURIComponent(messageId)}`,
                headers: { Prefer: "return=minimal" },
              });
            } catch (cleanupErr) {
              console.warn("File message rollback failed.", cleanupErr);
            }
          }
          try {
            await deleteStorageObject(env, ATTACHMENT_BUCKET, objectPath);
          } catch (cleanupErr) {
            console.warn("File storage rollback failed.", cleanupErr);
          }
          throw err;
        }

        await recordActivity(env, user, channel.id, "POSTED");

        return response({
          ok: true,
          file: {
            name: fileName,
            mimeType,
            size: file.size,
            expiresAt,
          },
          messageId,
        });
      }

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

      if (path === "/channels" && request.method === "PUT") {
        if (!["admin", "superadmin"].includes(user.role)) {
          return error("Forbidden.", 403);
        }

        const id = String(url.searchParams.get("id") || "").trim();
        if (!id) return error("Channel id is required.");

        const currentRows = await supabaseFetch(env, "channels", {
          query:
            `?select=id,name,description,created_by,created_at&id=eq.${encodeURIComponent(id)}&limit=1`,
        });
        const channel = Array.isArray(currentRows) ? currentRows[0] : null;
        if (!channel) return error("Channel not found.", 404);
        if (channel.name === "general") {
          return error("The general channel cannot be renamed.", 400);
        }

        const body = await request.json().catch(() => ({}));
        const name = String(body.name || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, MAX_CHANNEL_LENGTH);

        if (!name || name === "general") {
          return error("Choose a valid channel name.");
        }

        const duplicate = await supabaseFetch(env, "channels", {
          query:
            `?select=id&name=eq.${encodeURIComponent(name)}&id=neq.${encodeURIComponent(id)}&limit=1`,
        });
        if (Array.isArray(duplicate) && duplicate.length) {
          return error("Channel already exists.", 409);
        }

        const updated = await supabaseFetch(env, "channels", {
          method: "PATCH",
          query:
            `?id=eq.${encodeURIComponent(id)}&select=id,name,description,created_by,created_at`,
          body: { name },
          headers: { Prefer: "return=representation" },
        });
        const saved = Array.isArray(updated) ? updated[0] : updated;

        return response({
          ok: true,
          channel: {
            id: saved.id,
            name: saved.name,
            description: saved.description,
            createdBy: saved.created_by,
            createdAt: saved.created_at,
          },
        });
      }

      if (
        (path === "/channels" && request.method === "DELETE") ||
        (path === "/channels/delete" && request.method === "POST")
      ) {
        const body = request.method === "POST"
          ? await request.json().catch(() => ({}))
          : {};
        const id = request.method === "POST"
          ? String(body.id || "").trim()
          : url.searchParams.get("id");
        if (!id) return error("Channel id is required.");
        if (id === "general") return error("The general channel cannot be deleted.");
        if (!["admin", "superadmin"].includes(user.role)) {
          return error("Forbidden.", 403);
        }

        const channelMessages = await supabaseFetch(env, "messages", {
          query: `?select=id&channel_id=eq.${encodeURIComponent(id)}`,
        });
        await deleteAttachmentObjectsForMessages(
          env,
          (Array.isArray(channelMessages) ? channelMessages : []).map((item) => item.id)
        );
        await supabaseFetch(env, "channels", {
          method: "DELETE",
          query: `?id=eq.${encodeURIComponent(id)}`,
          headers: { Prefer: "return=minimal" },
        });

        return response({ ok: true });
      }

      if (path === "/pages" && request.method === "GET") {
        const channelName = url.searchParams.get("channel") || "general";
        const channel = await getChannelByName(env, channelName);
        if (!channel) return error("Channel not found.", 404);
        let pages = await getChannelPages(env, channel.id);
        if (!pages.length) {
          await supabaseFetch(env, "channel_pages", {
            method: "POST",
            query: "?select=id,channel_id,page_number,starts_at,created_at",
            body: { channel_id: channel.id, page_number: 1, starts_at: "1970-01-01T00:00:00Z" },
            headers: { Prefer: "return=minimal" },
          });
          pages = await getChannelPages(env, channel.id);
        }
        return response({
          ok: true,
          pages: pages.map((page) => ({
            page: page.page_number,
            startsAt: page.starts_at,
          })),
          lastPage: pages.length ? pages[pages.length - 1].page_number : 1,
        });
      }

      if (path === "/pages" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const channelName = String(body.channel || "").trim().toLowerCase();
        if (!channelName) return error("Channel is required.");
        const channel = await getChannelByName(env, channelName);
        if (!channel) return error("Channel not found.", 404);
        const page = await createNextChannelPage(env, channel.id);
        return response({
          ok: true,
          page: { page: page.page_number, startsAt: page.starts_at },
        });
      }

      if (
        (path === "/pages" && request.method === "DELETE") ||
        (path === "/pages/delete" && request.method === "POST")
      ) {
        if (!["admin", "superadmin"].includes(user.role)) {
          return error("Forbidden.", 403);
        }
        const deleteBody = request.method === "POST"
          ? await request.json().catch(() => ({}))
          : {};
        const channelName = String(
          request.method === "POST" ? deleteBody.channel : url.searchParams.get("channel") || ""
        ).trim().toLowerCase();
        const pageNumber = Number(
          request.method === "POST" ? deleteBody.page : url.searchParams.get("page")
        );
        if (!channelName) return error("Channel is required.");
        if (!Number.isInteger(pageNumber) || pageNumber < 1) {
          return error("Valid page number is required.");
        }
        const channel = await getChannelByName(env, channelName);
        if (!channel) return error("Channel not found.", 404);
        const pages = await supabaseFetch(env, "channel_pages", {
          query:
            `?select=id,channel_id,page_number&channel_id=eq.${encodeURIComponent(channel.id)}&order=page_number.asc`,
        });
        if (!Array.isArray(pages) || !pages.length) {
          return error("Message page not found.", 404);
        }
        if (pages.length <= 1) {
          return error("The last message page cannot be deleted.", 400);
        }
        const page = pages.find((item) => Number(item.page_number) === pageNumber);
        if (!page) return error("Message page not found.", 404);

        const pageMessages = await supabaseFetch(env, "messages", {
          query:
            `?select=id&channel_id=eq.${encodeURIComponent(channel.id)}&page_id=eq.${encodeURIComponent(page.id)}`,
        });
        await deleteAttachmentObjectsForMessages(
          env,
          (Array.isArray(pageMessages) ? pageMessages : []).map((item) => item.id)
        );
        await supabaseFetch(env, "messages", {
          method: "DELETE",
          query: `?channel_id=eq.${encodeURIComponent(channel.id)}&page_id=eq.${encodeURIComponent(page.id)}`,
          headers: { Prefer: "return=minimal" },
        });
        await supabaseFetch(env, "channel_pages", {
          method: "DELETE",
          query: `?id=eq.${encodeURIComponent(page.id)}&channel_id=eq.${encodeURIComponent(channel.id)}`,
          headers: { Prefer: "return=minimal" },
        });
        return response({ ok: true, deletedPage: pageNumber });
      }

      if (path === "/messages" && request.method === "GET") {
        const channelName = url.searchParams.get("channel") || "general";
        let channel = await getChannelByName(env, channelName);

        if (!channel && channelName === "general") {
          channel = await ensureGeneralChannel(env);
        }

        if (!channel) return response({ ok: true, messages: [] });

        /*
         * A sync read is intentionally read-only.
         * Do not create membership/activity rows on every poll.
         */
        if (!isMessageSync) {
          const joined = await ensureChannelMember(env, channel.id, user.id);
          if (joined) {
            try {
              await recordActivity(env, user, channel.id, "JOINED");
            } catch (err) {
              console.warn("Channel join activity failed; continuing message load.", err);
            }
          }
        }

        const requestedPage = Number(url.searchParams.get("page"));
        const pageNumber = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : null;
        const messages = await getMessagesForChannel(env, channel.id, pageNumber);

        if (!isMessageSync) {
          try {
            await updateChannelViewed(env, channel.id, user.id);
          } catch (err) {
            console.warn("Channel viewed timestamp update failed; continuing.", err);
          }
          try {
            await recordActivity(env, user, channel.id, "VIEWED");
          } catch (err) {
            console.warn("Channel viewed activity failed; continuing.", err);
          }
        }

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

        const requestedPage = Number(body.page);
        const pageNumber = Number.isInteger(requestedPage) && requestedPage > 0
          ? requestedPage
          : null;
        let page = pageNumber !== null
          ? (await supabaseFetch(env, "channel_pages", {
              query:
                `?select=id,channel_id,page_number&channel_id=eq.${encodeURIComponent(channel.id)}&page_number=eq.${encodeURIComponent(pageNumber)}&limit=1`,
            }))[0]
          : await getLastChannelPage(env, channel.id);
        if (!page) {
          page = await createNextChannelPage(env, channel.id);
        }

        let quotedMessageId = null;
        const requestedQuote = String(body.quotedMessageId || "").trim();
        if (requestedQuote) {
          const quotedRows = await supabaseFetch(env, "messages", {
            query:
              `?select=id,channel_id,user_id,text,created_at&id=eq.${encodeURIComponent(requestedQuote)}&limit=1`,
          });
          const quoted = Array.isArray(quotedRows) && quotedRows.length ? quotedRows[0] : null;
          if (!quoted) return error("Reply target not found.", 404);
          if (String(quoted.channel_id) !== String(channel.id)) {
            return error("Reply target must be in the same channel.", 400);
          }
          quotedMessageId = quoted.id;
        }

        const inserted = await supabaseFetch(env, "messages", {
          method: "POST",
          query: "?select=id,channel_id,user_id,page_id,text,quoted_message_id,created_at",
          body: {
            channel_id: channel.id,
            user_id: user.id,
            page_id: page.id,
            text,
            quoted_message_id: quotedMessageId,
          },
          headers: { Prefer: "return=representation" },
        });

        const message = Array.isArray(inserted) ? inserted[0] : inserted;
        await recordActivity(env, user, channel.id, "POSTED");

        let quotedMessage = null;
        if (quotedMessageId) {
          const quotedRows = await supabaseFetch(env, "messages", {
            query:
              `?select=id,user_id,text&id=eq.${encodeURIComponent(quotedMessageId)}&limit=1`,
          });
          const quoted = Array.isArray(quotedRows) && quotedRows.length ? quotedRows[0] : null;
          if (quoted) {
            const quotedUser = await getUserById(env, quoted.user_id);
            quotedMessage = {
              id: quoted.id,
              author: quotedUser?.name || "Unknown",
              role: quotedUser?.role || "user",
              text: quoted.text || "",
            };
          }
        }

        return response({
          ok: true,
          message: {
            id: message.id,
            channel: channel.name,
            channelId: message.channel_id,
            page: page.page_number,
            pin: user.pin,
            author: user.name,
            role: user.role,
            text: message.text,
            quotedMessage,
            time: message.created_at,
            createdAt: message.created_at,
          },
        });
      }
      if (
        (path.startsWith("/messages/") && request.method === "DELETE") ||
        (path === "/messages/delete" && request.method === "POST")
      ) {
        const deleteBody = request.method === "POST"
          ? await request.json().catch(() => ({}))
          : {};
        const id = request.method === "POST"
          ? String(deleteBody.id || "").trim()
          : path.split("/").pop();
        if (!id) return error("Message id is required.");

        // Keep the message lookup independent from the users relation.
        // PostgREST can reject the embedded users relation when more than one
        // relationship exists between these tables.
        const rows = await supabaseFetch(env, "messages", {
          query:
            `?select=id,channel_id,user_id,text,created_at` +
            `&id=eq.${encodeURIComponent(id)}&limit=1`,
        });

        const message = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!message) return error("Message not found.", 404);

        const messageUser = await getUserById(env, message.user_id);
        const permissionMessage = {
          ...message,
          user_role: messageUser?.role || "user",
        };

        if (!canDeleteMessage(user, permissionMessage)) {
          return error("Forbidden.", 403);
        }

        await deleteAttachmentObjectsForMessages(env, [message.id]);
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

      if (path === "/users/remove" && request.method === "POST") {
        if (user.role !== "superadmin") return error("Forbidden.", 403);

        const body = await request.json().catch(() => ({}));
        const pin = String(body.pin || "");
        if (!validPin(pin)) return error("Valid user PIN is required.");
        if (pin === "4999") return error("The super admin cannot be deleted.", 403);

        const target = await getUserByPin(env, pin, "normal");
        if (!target) return error("User not found.", 404);

        await supabaseFetch(env, "rpc/delete_user_account", {
          method: "POST",
          body: { p_target_id: target.id },
          headers: { Prefer: "return=minimal" },
        });

        return response({ ok: true });
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

        const target = await getUserByPin(env, pin, "normal");
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
