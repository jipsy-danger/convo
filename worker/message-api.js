import core from "./index.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Convo-Pin, X-Convo-SuperAdmin, Authorization",
    },
  });
}

async function supabaseFetch(env, table, query = "") {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
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
    throw new Error(message);
  }

  return data;
}

async function fallbackMessages(request, env) {
  const pin = request.headers.get("X-Convo-Pin") || "";
  if (!/^\d{4}$/.test(pin)) return response({ ok: false, error: "Unauthorized" }, 401);

  const superAdmin = request.headers.get("X-Convo-SuperAdmin") === "true";
  const roleFilter = superAdmin ? "&role=eq.superadmin" : "&role=neq.superadmin";
  const users = await supabaseFetch(
    env,
    "users",
    `?select=id,pin,name,role&pin=eq.${encodeURIComponent(pin)}${roleFilter}&limit=1`
  );
  const user = Array.isArray(users) ? users[0] : null;
  if (!user) return response({ ok: false, error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const channelName = (url.searchParams.get("channel") || "general").trim().toLowerCase();
  const channels = await supabaseFetch(
    env,
    "channels",
    `?select=id,name&name=eq.${encodeURIComponent(channelName)}&limit=1`
  );
  const channel = Array.isArray(channels) ? channels[0] : null;
  if (!channel) return response({ ok: true, messages: [] });

  const requestedPage = Number(url.searchParams.get("page"));
  let page = null;
  if (Number.isInteger(requestedPage) && requestedPage > 0) {
    const pages = await supabaseFetch(
      env,
      "channel_pages",
      `?select=id,page_number&channel_id=eq.${encodeURIComponent(channel.id)}&page_number=eq.${encodeURIComponent(requestedPage)}&limit=1`
    );
    page = Array.isArray(pages) ? pages[0] : null;
  }
  if (!page) {
    const pages = await supabaseFetch(
      env,
      "channel_pages",
      `?select=id,page_number&channel_id=eq.${encodeURIComponent(channel.id)}&order=page_number.desc&limit=1`
    );
    page = Array.isArray(pages) ? pages[0] : null;
  }
  if (!page) return response({ ok: true, messages: [] });

  const rows = await supabaseFetch(
    env,
    "messages",
    `?select=id,channel_id,user_id,text,created_at&channel_id=eq.${encodeURIComponent(channel.id)}&page_id=eq.${encodeURIComponent(page.id)}&order=created_at.asc&limit=300`
  );
  const messages = Array.isArray(rows) ? rows : [];
  const userIds = [...new Set(messages.map((message) => message.user_id).filter(Boolean))];

  let authors = [];
  if (userIds.length) {
    authors = await supabaseFetch(
      env,
      "users",
      `?select=id,pin,name,role&id=in.(${userIds.map((id) => encodeURIComponent(id)).join(",")})`
    );
  }

  const attachmentRows = messages.length
    ? await supabaseFetch(
        env,
        "message_attachments",
        `?select=id,message_id,file_name,mime_type,file_size,expires_at&message_id=in.(${messages
          .map((message) => encodeURIComponent(message.id))
          .join(",")})&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&deleted_at=is.null&order=id.asc`
      )
    : [];
  const attachmentByMessage = new Map();
  for (const attachment of Array.isArray(attachmentRows) ? attachmentRows : []) {
    const key = String(attachment.message_id);
    if (!attachmentByMessage.has(key)) attachmentByMessage.set(key, []);
    attachmentByMessage.get(key).push({
      id: attachment.id,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
      fileSize: attachment.file_size,
      expiresAt: attachment.expires_at,
    });
  }

  const authorById = new Map(
    (Array.isArray(authors) ? authors : []).map((author) => [String(author.id), author])
  );

  return response({
    ok: true,
    messages: messages
      .map((message) => {
        const author = authorById.get(String(message.user_id));
        const files = attachmentByMessage.get(String(message.id)) || [];
        return {
          id: message.id,
          channel: channel.name,
          channelId: message.channel_id,
          pin: author?.pin,
          author: author?.name,
          role: author?.role,
          text: message.text,
          files,
          time: message.created_at,
          createdAt: message.created_at,
        };
      })
      .filter((message) => String(message.text || "") || message.files.length),
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/messages" && request.method === "GET") {
      const coreResponse = await core.fetch(request, env, ctx);
      if (coreResponse.ok) return coreResponse;

      try {
        return await fallbackMessages(request, env);
      } catch (err) {
        console.error("Message fallback failed", err);
        return response({ ok: false, error: err?.message || "Unable to load messages." }, 500);
      }
    }

    return core.fetch(request, env, ctx);
  },
};
