(() => {
  const panel = document.getElementById('superAdminPanel');
  const rows = document.getElementById('superAdminChannelRows');
  const refresh = document.getElementById('superChannelRefresh');
  const backdrop = document.getElementById('superChannelSettingsBackdrop');
  const form = document.getElementById('superChannelSettingsForm');
  const close = document.getElementById('superChannelSettingsClose');
  const cancel = document.getElementById('superChannelSettingsCancel');
  const save = document.getElementById('superChannelSettingsSave');
  const nameInput = document.getElementById('superChannelName');
  const descriptionInput = document.getElementById('superChannelDescription');
  const publicButton = document.getElementById('superChannelPublic');
  const privateButton = document.getElementById('superChannelPrivate');
  const membersBlock = document.getElementById('superChannelMembersBlock');
  const membersBox = document.getElementById('superChannelMembers');
  const errorBox = document.getElementById('superChannelSettingsError');
  const title = document.getElementById('superChannelSettingsTitle');

  if (!panel || !rows || !backdrop || !form) return;

  let channels = [];
  let users = [];
  let editing = null;
  let privateMode = false;
  let loaded = false;
  let opening = false;

  const state = () => window.convoGetState?.() || {};
  const api = () => window.convoApi;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  function isSuperAdmin() {
    return state().currentUser?.role === 'superadmin';
  }

  function setError(message='') {
    errorBox.textContent = message;
  }

  function setVisibility(value) {
    privateMode = Boolean(value);
    publicButton.classList.toggle('active', !privateMode);
    privateButton.classList.toggle('active', privateMode);
    membersBlock.hidden = !privateMode;
  }

  function renderMembers(selectedIds=[]) {
    const selected = new Set(selectedIds.map(String));
    const candidates = users.filter(user => user?.role !== 'superadmin');

    if (!candidates.length) {
      membersBox.innerHTML = '<div class="state-message">No eligible users.</div>';
      return;
    }

    membersBox.innerHTML = candidates.map(user => {
      const id = String(user.id);
      return '<label class="super-channel-member-option">' +
        '<input type="checkbox" value="' + esc(id) + '"' + (selected.has(id) ? ' checked' : '') + '>' +
        '<span>' + esc(user.name || 'Unnamed') + '</span>' +
        '<small>' + esc(user.role || 'user') + '</small>' +
      '</label>';
    }).join('');
  }

  async function fetchData() {
    if (!isSuperAdmin() || !api()) return;

    try {
      const [channelData, userData] = await Promise.all([
        api()('/channels'),
        api()('/users')
      ]);
      channels = Array.isArray(channelData.channels) ? channelData.channels : [];
      users = Array.isArray(userData.users) ? userData.users : [];
      loaded = true;
      renderChannelRows();
    } catch (error) {
      rows.innerHTML = '<div class="state-message">Channel data unavailable.</div>';
      console.error('Super Admin channel management load failed.', error);
    }
  }

  function renderChannelRows() {
    if (!channels.length) {
      rows.innerHTML = '<div class="state-message">No channels.</div>';
      return;
    }

    rows.innerHTML = channels.map(channel => {
      const privacy = channel.isPrivate ? 'PRIVATE' : 'PUBLIC';
      return '<button type="button" class="super-admin-channel-row" data-channel-id="' +
        esc(channel.id) + '">' +
        '<span class="super-admin-channel-main">' +
          '<strong>' + (channel.isPrivate ? '🔒 ' : '# ') + esc(channel.name) + '</strong>' +
          '<small>' + esc(channel.description || 'No description') + '</small>' +
        '</span>' +
        '<span class="super-admin-channel-type">' + privacy + '</span>' +
      '</button>';
    }).join('');
  }

  async function openEditor(channel) {
    if (!isSuperAdmin() || opening) return;
    opening = true;
    editing = channel;
    setError('');

    title.textContent = 'CHANNEL SETTINGS / ' + (channel.isPrivate ? 'PRIVATE' : 'PUBLIC');
    nameInput.value = channel.name || '';
    descriptionInput.value = channel.description || '';
    nameInput.disabled = channel.name === 'general';

    if (channel.name === 'general') {
      publicButton.disabled = true;
      privateButton.disabled = true;
      setVisibility(false);
      membersBox.replaceChildren();
      membersBlock.hidden = true;
    } else {
      publicButton.disabled = false;
      privateButton.disabled = false;
      const memberData = channel.isPrivate
        ? await api()('/channels/members?channel=' + encodeURIComponent(channel.id))
        : { users: [] };
      users = users.length ? users : (await api()('/users')).users || [];
      const selected = (Array.isArray(memberData.users) ? memberData.users : [])
        .filter(user => user.selected)
        .map(user => String(user.id));
      renderMembers(selected);
      setVisibility(Boolean(channel.isPrivate));
    }

    backdrop.hidden = false;
    nameInput.focus();
    opening = false;
  }

  function closeEditor() {
    editing = null;
    setError('');
    backdrop.hidden = true;
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!isSuperAdmin() || !editing) return;

    const name = nameInput.value.trim();
    const description = descriptionInput.value.trim();
    const memberIds = [...membersBox.querySelectorAll('input[type="checkbox"]:checked')]
      .map(input => input.value);

    if (!name) {
      setError('Channel name is required.');
      return;
    }
    if (privateMode && !memberIds.length) {
      setError('Select at least one user for a private channel.');
      return;
    }

    save.disabled = true;
    save.textContent = 'Saving...';
    setError('');

    try {
      await api()('/channels?id=' + encodeURIComponent(editing.id), {
        method: 'PUT',
        body: JSON.stringify({
          name,
          description,
          isPrivate: privateMode,
          memberIds
        })
      });

      closeEditor();
      await fetchData();
      // Keep the regular Convo channel data in sync without changing the
      // current channel/page state.
      await window.convoLoadChannels?.(editing?.name || name, false);
    } catch (error) {
      setError(error.message || 'Unable to save channel settings.');
    } finally {
      save.disabled = false;
      save.textContent = 'Save Settings';
    }
  }

  refresh?.addEventListener('click', event => {
    event.preventDefault();
    fetchData();
  });

  rows.addEventListener('click', event => {
    const row = event.target.closest('.super-admin-channel-row');
    if (!row) return;
    // Normal left-click only selects the row visually; settings remain a
    // deliberate one-right-click action.
    rows.querySelectorAll('.super-admin-channel-row.active')
      .forEach(item => item.classList.remove('active'));
    row.classList.add('active');
  });

  // The actual requested interaction:
  // one right-click opens the channel settings popup.
  rows.addEventListener('pointerdown', event => {
    if (event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    const row = event.target.closest('.super-admin-channel-row');
    if (!row) return;
    const channel = channels.find(item => String(item.id) === String(row.dataset.channelId));
    if (channel) openEditor(channel);
  }, true);

  rows.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // Block the native browser context menu throughout the open J console.
  panel.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  close?.addEventListener('click', event => { event.preventDefault(); closeEditor(); });
  cancel?.addEventListener('click', event => { event.preventDefault(); closeEditor(); });
  publicButton?.addEventListener('click', () => setVisibility(false));
  privateButton?.addEventListener('click', () => setVisibility(true));
  form.addEventListener('submit', saveEditor);
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closeEditor();
  });

  window.convoLoadSuperAdminChannels = async () => {
    await fetchData();
    return loaded;
  };

  // When the J panel opens, load the channel management section.
  const originalOpen = window.openSuperAdminPanel;
  // The existing function is intentionally not replaced. Instead, observe
  // the launcher/panel state with a lightweight hook.
  const launcher = document.getElementById('superAdminLauncher');
  launcher?.addEventListener('click', () => {
    if (isSuperAdmin()) setTimeout(fetchData, 0);
  });

  // Protect keyboard-triggered context menu while the J console is open.
  document.addEventListener('keydown', event => {
    if (!isSuperAdmin() || !panel.classList.contains('open')) return;
    if (event.key === 'ContextMenu') {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
})();