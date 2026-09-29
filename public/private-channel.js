(() => {
  const $ = (id) => document.getElementById(id);
  const visibilityBlock = $("channelVisibilityBlock");
  const memberPicker = $("privateMemberPicker");
  const memberList = $("privateMemberList");
  const channelForm = $("channelForm");
  const channelModalError = $("channelModalError");
  const accessButton = $("btnManageChannelAccess");
  const accessModal = $("privateAccessModal");
  const accessForm = $("privateAccessForm");
  const accessList = $("privateAccessMemberList");
  const accessError = $("privateAccessError");
  const accessChannelName = $("privateAccessChannelName");
  const btnAccessCancel = $("btnCancelPrivateAccess");
  const btnAccessSubmit = $("btnSubmitPrivateAccess");
  const btnCreate = $("btnSubmitChannel");

  let cachedUsers = [];

  function state() {
    return window.convoGetState?.() || {};
  }

  function isSuperAdmin() {
    return state().currentUser?.role === "superadmin";
  }

  function selectedVisibility() {
    return document.querySelector('input[name="channelVisibility"]:checked')?.value === "private";
  }

  function selectedIds(container) {
    return [...container.querySelectorAll('input[type="checkbox"][data-user-id]:checked')]
      .map((input) => String(input.dataset.userId));
  }

  function renderUsers(container, users, selected = new Set()) {
    container.replaceChildren();

    if (!users.length) {
      const empty = document.createElement("div");
      empty.className = "state-message";
      empty.textContent = "No eligible users found.";
      container.appendChild(empty);
      return;
    }

    users.forEach((user) => {
      const label = document.createElement("label");
      label.className = "private-member-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.userId = String(user.id);
      checkbox.checked = selected.has(String(user.id));

      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = user.name || "Unnamed user";
      const role = document.createElement("small");
      role.textContent = user.role || "user";

      copy.append(name, role);
      label.append(checkbox, copy);
      container.appendChild(label);
    });
  }

  async function loadEligibleUsers() {
    if (!isSuperAdmin()) return [];
    if (cachedUsers.length) return cachedUsers;

    const api = window.convoApi;
    if (!api) return [];

    const data = await api("/users");
    cachedUsers = (Array.isArray(data.users) ? data.users : [])
      .filter((user) => user?.role !== "superadmin");
    return cachedUsers;
  }

  function setCreateMode(privateMode) {
    const enabled = isSuperAdmin() && privateMode;
    if (visibilityBlock) {
      visibilityBlock.hidden = !isSuperAdmin();
    }
    if (memberPicker) {
      memberPicker.hidden = !enabled;
    }
  }

  async function prepareCreate() {
    const publicRadio = document.querySelector('input[name="channelVisibility"][value="public"]');
    if (publicRadio) publicRadio.checked = true;
    setCreateMode(false);

    if (!isSuperAdmin()) return;

    try {
      const users = await loadEligibleUsers();
      renderUsers(memberList, users);
    } catch (err) {
      memberList.innerHTML = '<div class="state-message">Unable to load users.</div>';
    }
  }

  function resetCreate() {
    setCreateMode(false);
    const publicRadio = document.querySelector('input[name="channelVisibility"][value="public"]');
    if (publicRadio) publicRadio.checked = true;
    memberList?.replaceChildren();
    channelModalError.textContent = "";
  }

  async function refreshChannels(name) {
    if (window.convoLoadChannels) {
      await window.convoLoadChannels(name);
    }
  }

  async function createPrivate(event) {
    if (!selectedVisibility() || !isSuperAdmin()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const name = $("channelNameInput")?.value.trim() || "";
    const description = $("channelDescriptionInput")?.value.trim() || "Project discussion";
    const memberIds = selectedIds(memberList);

    if (!name) {
      channelModalError.textContent = "Channel name is required.";
      $("channelNameInput")?.focus();
      return;
    }

    if (!memberIds.length) {
      channelModalError.textContent = "Select at least one user.";
      return;
    }

    btnCreate.disabled = true;
    btnCreate.textContent = "Creating...";
    channelModalError.textContent = "";

    try {
      const data = await window.convoApi("/channels", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          isPrivate: true,
          memberIds
        })
      });

      window.convoCloseChannelModal?.();
      await refreshChannels(data.channel?.name || name.toLowerCase());
    } catch (err) {
      channelModalError.textContent = err.message || "Unable to create private channel.";
      btnCreate.disabled = false;
      btnCreate.textContent = "Create";
    }
  }

  function syncControls(channel) {
    const showAccess = Boolean(channel?.isPrivate && isSuperAdmin());
    if (accessButton) {
      accessButton.hidden = !showAccess;
    }
  }

  async function openAccess() {
    const channel = state().activeChannel;
    if (!channel?.isPrivate || !isSuperAdmin()) return;

    accessModal.hidden = false;
    accessModal.removeAttribute("hidden");
    accessError.textContent = "";
    accessChannelName.textContent = "Access for #" + channel.name;
    accessList.innerHTML = '<div class="state-message">Loading users...</div>';

    try {
      const data = await window.convoApi("/channels/members?channel=" + encodeURIComponent(channel.id));
      const users = (Array.isArray(data.users) ? data.users : []).filter((user) => user.role !== "superadmin");
      const selected = new Set(
        users.filter((user) => user.selected).map((user) => String(user.id))
      );
      renderUsers(accessList, users, selected);
    } catch (err) {
      accessError.textContent = err.message || "Unable to load channel access.";
      accessList.innerHTML = '<div class="state-message">Access list unavailable.</div>';
    }
  }

  function closeAccess() {
    accessModal.hidden = true;
    accessError.textContent = "";
    accessList.replaceChildren();
    btnAccessSubmit.disabled = false;
    btnAccessSubmit.textContent = "Save Access";
  }

  async function saveAccess(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const channel = state().activeChannel;
    if (!channel?.isPrivate || !isSuperAdmin()) return;

    const memberIds = selectedIds(accessList);
    if (!memberIds.length) {
      accessError.textContent = "Select at least one user.";
      return;
    }

    btnAccessSubmit.disabled = true;
    btnAccessSubmit.textContent = "Saving...";
    accessError.textContent = "";

    try {
      await window.convoApi("/channels/members", {
        method: "POST",
        body: JSON.stringify({ channelId: channel.id, memberIds })
      });
      closeAccess();
      await refreshChannels(channel.name);
    } catch (err) {
      accessError.textContent = err.message || "Unable to update channel access.";
      btnAccessSubmit.disabled = false;
      btnAccessSubmit.textContent = "Save Access";
    }
  }

  document.querySelectorAll('input[name="channelVisibility"]').forEach((input) => {
    input.addEventListener("change", async () => {
      setCreateMode(selectedVisibility());
      if (selectedVisibility()) {
        try {
          renderUsers(memberList, await loadEligibleUsers());
        } catch {
          memberList.innerHTML = '<div class="state-message">Unable to load users.</div>';
        }
      }
    });
  });

  channelForm?.addEventListener("submit", createPrivate, true);
  accessForm?.addEventListener("submit", saveAccess);
  accessButton?.addEventListener("click", openAccess);
  btnAccessCancel?.addEventListener("click", closeAccess);
  document.querySelector("[data-close-private-access]")?.addEventListener("click", closeAccess);

  window.privateChannelPrepareCreate = prepareCreate;
  window.privateChannelResetCreate = resetCreate;
  window.privateChannelSyncControls = syncControls;

  const current = state().activeChannel;
  if (current) syncControls(current);
})();