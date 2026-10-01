(() => {
  const stack = document.createElement("div");
  stack.id = "mentionToastStack";
  stack.setAttribute("aria-live", "polite");
  document.body.appendChild(stack);

  let running = false;
  let inFlight = false;

  function getState() {
    return window.convoGetState?.() || {};
  }

  function showToast(notification) {
    const toast = document.createElement("div");
    toast.className = "mention-toast";

    const title = document.createElement("strong");
    title.textContent = "You were mentioned";

    const body = document.createElement("span");
    body.textContent = notification?.body || "Someone mentioned you";

    toast.append(title, body);
    stack.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 240);
    }, 7000);
  }

  async function poll() {
    if (inFlight) return;

    const state = getState();
    if (!state.currentUser || !window.convoApi) return;

    inFlight = true;
    try {
      const data = await window.convoApi("/notifications?type=mention&unread=1");
      const notifications = Array.isArray(data.notifications) ? data.notifications : [];
      if (!notifications.length) return;

      notifications.reverse().forEach(showToast);

      await window.convoApi("/notifications/read", {
        method: "POST",
        body: JSON.stringify({
          ids: notifications.map((item) => item.id).filter(Boolean)
        })
      });
    } catch (error) {
      console.warn("Mention notification poll failed.", error);
    } finally {
      inFlight = false;
    }
  }

  setInterval(poll, 2500);
  setTimeout(poll, 400);
  running = true;
})();