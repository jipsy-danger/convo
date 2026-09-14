(() => {
  const core = document.getElementById('accessCore');
  const input = document.getElementById('pinInput');
  const overlay = document.getElementById('authOverlay');
  const form = document.getElementById('authForm');
  const status = document.getElementById('hudStatus');
  const hint = document.getElementById('hudHint');
  if (!core || !input || !overlay || !form) return;

  let holdTimer = null;
  let holding = false;
  let armed = false;
  let confirmed = false;
  let bumpTimer = null;

  const focusPin = () => {
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
  };

  const bump = (name) => {
    clearTimeout(bumpTimer);
    core.classList.remove('hold-bump', 'admin-bump');
    void core.offsetWidth;
    core.classList.add(name);
    bumpTimer = setTimeout(() => core.classList.remove(name), 520);
  };

  const reset = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
    holding = false;
    armed = false;
    confirmed = false;
    if (typeof resetSuperAdminArming === 'function') resetSuperAdminArming();
    overlay.classList.remove('super-mode');
    input.type = 'password';
    input.inputMode = 'numeric';
    input.value = '';
    hiddenPin = '';
    autoSubmitting = false;
    if (typeof updateHud === 'function') updateHud();
  };

  const arm = () => {
    if (!holding || armed) return;
    armed = true;
    holding = false;
    superAdminHoldActive = true;
    superAdminJArmed = true;
    overlay.classList.add('super-mode');
    input.type = 'text';
    input.inputMode = 'text';
    input.value = '';
    hiddenPin = '';
    status.textContent = 'ACCESS CORE ARMED';
    hint.textContent = '';
    if (typeof updateHud === 'function') updateHud();
    bump('hold-bump');
    focusPin();
  };

  const startHold = (event) => {
    if (confirmed || superAdminMode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearTimeout(holdTimer);
    holding = true;
    armed = false;
    holdTimer = setTimeout(arm, 3000);
    focusPin();
  };

  const endHold = (event) => {
    event?.stopImmediatePropagation?.();
    if (!armed) {
      clearTimeout(holdTimer);
      holdTimer = null;
      holding = false;
    }
  };

  const confirmJ = () => {
    if (!armed || confirmed || superAdminMode) return;
    confirmed = true;
    armed = false;
    superAdminJArmed = false;
    superAdminMode = true;
    overlay.classList.add('super-mode');
    input.type = 'password';
    input.inputMode = 'numeric';
    input.value = '';
    hiddenPin = '';
    status.textContent = 'ACCESS CORE READY';
    hint.textContent = 'ENTER ACCESS CODE';
    if (typeof updateHud === 'function') updateHud();
    bump('admin-bump');
    focusPin();
  };

  const handleDigits = (raw) => {
    if (superAdminJArmed && !superAdminMode) {
      if (String(raw).toLowerCase().includes('j')) {
        input.value = '';
        confirmJ();
      } else input.value = '';
      return;
    }
    const digits = String(raw).replace(/\D/g, '').slice(0, 4);
    input.value = digits;
    if (digits === hiddenPin) return;
    hiddenPin = digits;
    autoSubmitting = false;
    overlay.classList.remove('denied');
    if (typeof updateHud === 'function') updateHud();
    if (digits.length === 4 && !autoSubmitting) {
      autoSubmitting = true;
      requestAnimationFrame(() => form.requestSubmit());
    }
  };

  core.addEventListener('pointerdown', startHold, { capture: true, passive: false });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => core.addEventListener(type, endHold, { capture: true, passive: true }));
  core.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!superAdminMode && !armed && hiddenPin.length !== 4) focusPin();
  }, { capture: true });
  core.addEventListener('contextmenu', event => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true });

  overlay.addEventListener('pointerdown', event => {
    if (event.target !== core && !event.target.closest('#pinInput') && !event.target.closest('#nameInput')) focusPin();
  }, { capture: true, passive: true });

  input.addEventListener('input', event => {
    event.stopImmediatePropagation();
    handleDigits(event.target.value);
  }, { capture: true });

  window.addEventListener('keydown', event => {
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      reset();
      status.textContent = 'ACCESS SYSTEM READY';
      hint.textContent = 'ENTER ACCESS CODE';
      focusPin();
      return;
    }
    if (superAdminJArmed && !superAdminMode && (event.key === 'j' || event.key === 'J')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      confirmJ();
      return;
    }
    if (superAdminJArmed && !superAdminMode) {
      if (event.key.length === 1) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    if (!overlay || overlay.style.display === 'none') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Tab' || event.key === 'Enter') return;
    if (event.key === 'Backspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      hiddenPin = hiddenPin.slice(0, -1);
      input.value = '';
      autoSubmitting = false;
      overlay.classList.remove('denied');
      if (typeof updateHud === 'function') updateHud();
      focusPin();
      return;
    }
    const match = event.code.match(/^(?:Digit|Numpad)(\d)$/);
    if (match && hiddenPin.length < 4) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hiddenPin += match[1];
      input.value = hiddenPin;
      if (typeof updateHud === 'function') updateHud();
      if (hiddenPin.length === 4 && !autoSubmitting) {
        autoSubmitting = true;
        requestAnimationFrame(() => form.requestSubmit());
      }
    }
  }, { capture: true });

  requestAnimationFrame(() => focusPin());
})();
