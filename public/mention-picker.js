(() => {
  const input = document.getElementById("msgInput");
  const form = document.querySelector(".input-container");
  if (!input || !form) return;

  const cache = new Map();
  const selected = new Map();
  let users = [];
  let visible = [];
  let activeIndex = 0;
  let requestId = 0;
  let hideTimer = null;

  const list = document.createElement("div");
  list.className = "mention-picker";
  list.hidden = true;
  list.setAttribute("role", "listbox");
  form.appendChild(list);

  function getState() {
    return window.convoGetState?.() || {};
  }

  function triggerInfo() {
    const caret = Number(input.selectionStart || 0);
    const before = input.value.slice(0, caret);
    const match = before.match(/(^|[\s\n])\.@([^\s\n@]*)$/);
    if (!match) return null;
    return {
      start: match.index + match[1].length,
      end: caret,
      query: match[2] || ""
    };
  }

  function hide() {
    clearTimeout(hideTimer);
    list.hidden = true;
    list.replaceChildren();
    visible = [];
    activeIndex = 0;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 140);
  }

  function show() {
    clearTimeout(hideTimer);
    list.hidden = false;
  }

  function render() {
    list.replaceChildren();
    if (!visible.length) {
      hide();
      return;
    }

    visible.forEach((user, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "mention-option" + (index === activeIndex ? " active" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
      item.dataset.userId = String(user.id);

      const name = document.createElement("strong");
      name.textContent = user.name || "Unnamed user";

      const role = document.createElement("small");
      role.textContent = user.role || "user";

      item.append(name, role);
      item.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        choose(index);
      });
      list.appendChild(item);
    });

    show();
  }

  async function loadUsers() {
    const { activeChannel } = getState();
    if (!activeChannel) return [];

    const key = String(activeChannel.id || activeChannel.name);
    if (cache.has(key)) return cache.get(key);

    const api = window.convoApi;
    if (!api) return [];

    const data = await api("/mentions/users?channel=" + encodeURIComponent(activeChannel.name));
    const result = (Array.isArray(data.users) ? data.users : [])
      .filter((user) => user && user.id != null && String(user.name || "").trim());

    cache.set(key, result);
    return result;
  }

  async function updatePicker() {
    const trigger = triggerInfo();
    if (!trigger) {
      hide();
      return;
    }

    const query = trigger.query.toLowerCase();
    const id = ++requestId;

    try {
      const candidates = await loadUsers();
      if (id !== requestId) return;

      visible = candidates.filter((user) =>
        String(user.name || "").toLowerCase().includes(query)
      ).slice(0, 12);

      activeIndex = Math.min(activeIndex, Math.max(0, visible.length - 1));
      render();
    } catch (error) {
      console.warn("Mention user lookup failed.", error);
      hide();
    }
  }

  function choose(index) {
    const user = visible[index];
    const trigger = triggerInfo();
    if (!user || !trigger) return;

    const mentionText = "@" + String(user.name || "").trim();
    const before = input.value.slice(0, trigger.start);
    const after = input.value.slice(trigger.end);
    input.value = before + mentionText + " " + after;
    input.selectionStart = input.selectionEnd = trigger.start + mentionText.length + 1;

    selected.set(String(user.id), String(user.name || "").trim());
    hide();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus({ preventScroll: true });
  }

  function pruneSelected() {
    const text = input.value.toLowerCase();
    for (const [id, name] of selected) {
      if (!text.includes("@" + name.toLowerCase())) selected.delete(id);
    }
  }

  input.addEventListener("input", () => {
    pruneSelected();
    activeIndex = 0;
    updatePicker();
  });

  input.addEventListener("keydown", (event) => {
    if (list.hidden || !visible.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      activeIndex = Math.min(activeIndex + 1, visible.length - 1);
      render();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      activeIndex = Math.max(activeIndex - 1, 0);
      render();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      choose(activeIndex);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  });

  input.addEventListener("blur", scheduleHide);

  input.addEventListener("click", () => {
    updatePicker();
  });

  document.addEventListener("click", (event) => {
    if (!form.contains(event.target)) hide();
  });

  window.convoGetMentionIds = (text) => {
    pruneSelected();
    const content = String(text || "").toLowerCase();
    return [...selected.entries()]
      .filter(([, name]) => content.includes("@" + String(name).toLowerCase()))
      .map(([id]) => Number(id))
      .filter(Number.isInteger);
  };

  window.convoClearMentionState = () => {
    selected.clear();
    hide();
  };

  window.convoInvalidateMentionUsers = () => cache.clear();
})();