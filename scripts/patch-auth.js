const fs = require('fs');

const indexPath = 'src/pages/index.astro';
let index = fs.readFileSync(indexPath, 'utf8');

const cornerOld = `  document.querySelectorAll('[data-super-admin-corner]').forEach((corner) => {
    corner.addEventListener('click', () => {
      superAdminMode = true;
      authOverlay.classList.add('super-mode');
      hudStatus.textContent = 'ACCESS CORE ARMED';
      hudHint.textContent = 'ENTER SUPER ADMIN CODE';
      focusAccess();
    });
  });`;
const cornerNew = `  const superAdminCornerOrder = ['hud-corner-tl', 'hud-corner-tr', 'hud-corner-br', 'hud-corner-bl'];
  let superAdminCornerIndex = 0;

  document.querySelectorAll('[data-super-admin-corner]').forEach((corner) => {
    corner.addEventListener('click', () => {
      const cornerClass = superAdminCornerOrder.find((name) => corner.classList.contains(name));
      if (cornerClass !== superAdminCornerOrder[superAdminCornerIndex]) {
        superAdminCornerIndex = 0;
        superAdminMode = false;
        authOverlay.classList.remove('super-mode');
        return;
      }
      superAdminCornerIndex += 1;
      if (superAdminCornerIndex === superAdminCornerOrder.length) {
        superAdminMode = true;
        authOverlay.classList.add('super-mode');
        superAdminCornerIndex = 0;
      }
      focusAccess();
    });
  });`;
if (!index.includes(cornerOld)) throw new Error('corner handler not found');
index = index.replace(cornerOld, cornerNew);
index = index.replace(
  "      superAdminMode = false;\n      authOverlay.classList.remove('super-mode', 'denied');",
  "      superAdminMode = false;\n      superAdminCornerIndex = 0;\n      authOverlay.classList.remove('super-mode', 'denied');"
);
index = index.replace(
  "    superAdminMode = false;\n    autoSubmitting = false;\n    pinInput.value = '';",
  "    superAdminMode = false;\n    superAdminCornerIndex = 0;\n    autoSubmitting = false;\n    pinInput.value = '';"
);
const guard = `    if (hiddenPin === '4999' && !superAdminMode) {
      hudStatus.textContent = 'SUPER ADMIN CORE LOCKED';
      hudHint.textContent = 'ARM THE CORNER ACCESS FIRST';
      authOverlay.classList.add('denied');
      autoSubmitting = false;
      hiddenPin = '';
      pinInput.value = '';
      updateHud();
      focusAccess();
      return;
    }

`;
if (!index.includes(guard)) throw new Error('visible 4999 guard not found');
index = index.replace(guard, '');
fs.writeFileSync(indexPath, index);

const workerPath = 'worker/index.js';
let worker = fs.readFileSync(workerPath, 'utf8');
const authOld = `  if (user) {
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
`;
const authNew = `  if (user) {
    if (user.pin === "4999" && user.role === "superadmin" && !requestedSuperAdmin) {
      if (!name) return response({ ok: true, isNew: true, reservedPin: true });

      const users = await supabaseGetAll(env, "users", "pin");
      const usedPins = new Set(users.map((item) => String(item.pin)));
      let assignedPin = null;
      for (let value = 1000; value <= 9999; value += 1) {
        const candidate = String(value);
        if (candidate !== "4999" && !usedPins.has(candidate)) {
          assignedPin = candidate;
          break;
        }
      }
      if (!assignedPin) return error("No user PINs are available.", 409);

      const inserted = await supabaseFetch(env, "users", {
        method: "POST",
        query: "?select=id,pin,name,role,created_at,last_activity_at",
        body: { pin: assignedPin, name: cleanName(name), role: "user" },
        headers: { Prefer: "return=representation" },
      });

      user = Array.isArray(inserted) ? inserted[0] : inserted;
      return response({ ok: true, isNew: false, assignedPin, user: formatUser(user) });
    }

    await touchUserActivity(env, user.id);
    user = await getUserById(env, user.id);
    return response({ ok: true, isNew: false, user: formatUser(user) });
  }

  if (pin === "4999") {
    if (!requestedSuperAdmin) {
      if (!name) return response({ ok: true, isNew: true, reservedPin: true });
      return error("The super admin PIN is reserved. Choose another access code.", 409);
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
`;
if (!worker.includes(authOld)) throw new Error('worker auth block not found');
worker = worker.replace(authOld, authNew);
fs.writeFileSync(workerPath, worker);
