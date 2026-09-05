const GATEWAY_URL = 'https://jarvis-api.juanjojimenez89.workers.dev';

const el = (id) => document.getElementById(id);
const loginCard = el('loginCard');
const panel = el('panel');
const list = el('list');

// El token vive solo en esta pestaña: se pierde al cerrarla
const store = {
  get: () => { try { return sessionStorage.getItem('jarvis_admin_token'); } catch { return null; } },
  set: (t) => { try { sessionStorage.setItem('jarvis_admin_token', t); } catch { /* modo privado */ } },
  clear: () => { try { sessionStorage.removeItem('jarvis_admin_token'); } catch { /* nada */ } },
};

function message(node, text, kind) {
  node.textContent = text;
  node.className = 'msg show ' + kind;
}

async function api(path, options = {}) {
  const response = await fetch(GATEWAY_URL + path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'Authorization': 'Bearer ' + store.get(),
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
  return data;
}

function renderKeys(keys) {
  if (!keys.length) {
    list.innerHTML = '<div class="empty">Todavía no hay ninguna clave guardada.</div>';
    return;
  }

  list.textContent = '';
  for (const key of keys) {
    const row = document.createElement('div');
    row.className = 'key';

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'key-name';
    name.textContent = key.name;
    const meta = document.createElement('div');
    meta.className = 'key-meta';
    const fecha = key.updated ? new Date(key.updated).toLocaleString('es-ES') : 'sin fecha';
    meta.textContent = `${key.preview} · guardada el ${fecha}`;
    info.append(name, meta);

    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = 'Borrar';
    remove.addEventListener('click', () => deleteKey(key.name));

    row.append(info, remove);
    list.append(row);
  }
}

async function refresh() {
  const { keys } = await api('/api/settings');
  renderKeys(keys);
}

async function deleteKey(name) {
  if (!confirm(`¿Borrar ${name}?`)) return;
  try {
    await api('/api/settings/' + encodeURIComponent(name), { method: 'DELETE' });
    await refresh();
  } catch (err) {
    message(el('saveMsg'), err.message, 'err');
  }
}

async function login() {
  const token = el('token').value.trim();
  if (!token) return;

  store.set(token);
  try {
    await refresh();
    loginCard.classList.add('hidden');
    panel.classList.remove('hidden');
  } catch (err) {
    store.clear();
    message(el('loginMsg'), err.status === 401 ? 'Contraseña incorrecta.' : err.message, 'err');
  }
}

async function save() {
  const name = el('name').value.trim().toUpperCase();
  const value = el('value').value.trim();
  const msg = el('saveMsg');

  if (!name || !value) {
    message(msg, 'Hacen falta el nombre y el valor.', 'err');
    return;
  }

  try {
    await api('/api/settings/' + encodeURIComponent(name), {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
    message(msg, `${name} guardada.`, 'ok');
    el('name').value = '';
    el('value').value = '';
    await refresh();
  } catch (err) {
    message(msg, err.message, 'err');
  }
}

el('loginBtn').addEventListener('click', login);
el('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
el('saveBtn').addEventListener('click', save);
el('value').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

// Si ya había token en esta pestaña, entrar directamente
if (store.get()) login();
