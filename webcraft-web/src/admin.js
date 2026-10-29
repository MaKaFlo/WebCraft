// Admin page: the page opened with ?admin=<token> (link from /webcraft admin, server admins only).
// Makes WebCraft accounts with name and password, changes passwords, links accounts with Minecraft players.

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function startAdmin(url, token, onClose = null) {
  const box = document.createElement('div');
  box.id = 'admin';
  box.innerHTML = `
    <div class="admin-card">
      <button type="button" class="admin-close" title="Schließen">✕</button>
      <h1>WebCraft Admin</h1>
      <p class="admin-status">Verbinde ...</p>
      <form class="admin-new" autocomplete="off">
        <h2>Neuer Spieler</h2>
        <div class="admin-row">
          <span class="prefix"></span><input name="name" maxlength="13" placeholder="Name" spellcheck="false">
          <input name="pw" type="password" maxlength="64" placeholder="Passwort" autocomplete="new-password">
          <button type="submit">Anlegen</button>
        </div>
      </form>
      <p class="admin-self"></p>
      <h2>Konten</h2>
      <table class="admin-list"><thead><tr><th>Konto</th><th>Passwort</th><th>Minecraft-Account</th><th></th></tr></thead><tbody></tbody></table>
    </div>`;
  document.body.appendChild(box);
  const status = box.querySelector('.admin-status');
  const tbody = box.querySelector('tbody');
  const form = box.querySelector('.admin-new');
  let ws = null, prefix = 'wc_', players = [];

  const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const show = (text, bad) => { status.textContent = text; status.classList.toggle('bad', !!bad); };
  const strip = (account) => (account.toLowerCase().startsWith(prefix.toLowerCase()) ? account.slice(prefix.length) : account);

  function render(accounts) {
    tbody.innerHTML = '';
    if (!accounts.length) tbody.innerHTML = '<tr><td colspan="4">Noch keine Konten.</td></tr>';
    for (const a of accounts) {
      const name = strip(a.n);
      const tr = document.createElement('tr');
      const options = players.map((p) => `<option>${esc(p)}</option>`).join('');
      tr.innerHTML = `
        <td><b>${esc(a.n)}</b>${a.online ? ' <span class="admin-on">online</span>' : ''}</td>
        <td>${a.pw ? '✅' : '–'}</td>
        <td>${a.linked ? esc(a.linked) + ' <button data-a="unlink">lösen</button>'
          : players.length ? `<select>${options}</select> <button data-a="link">verknüpfen</button>` : '–'}</td>
        <td class="admin-actions">
          <button data-a="pw">Passwort ändern</button>
          ${a.pw ? '<button data-a="reset">Passwort löschen</button>' : ''}
          ${a.online ? '<button data-a="kick">rauswerfen</button>' : ''}
        </td>`;
      tr.addEventListener('click', (e) => {
        const act = e.target.dataset?.a;
        if (!act) return;
        if (act === 'pw') {
          const pw = prompt(`Neues Passwort für ${a.n} (mindestens 4 Zeichen):`);
          if (pw) send({ t: 'admin_pw', name, pw });
        } else if (act === 'reset') {
          if (confirm(`Passwort von ${a.n} löschen? Beim nächsten Anmelden legt der Spieler ein neues fest.`)) send({ t: 'admin_reset', name });
        } else if (act === 'link') {
          const mc = tr.querySelector('select').value;
          if (confirm(`${a.n} mit dem Minecraft-Account ${mc} verknüpfen? Dann spielt ${a.n} als ${mc} (gleiche Items, gleicher Ort).`)) {
            send({ t: 'admin_link', name, mc });
          }
        } else if (act === 'unlink') {
          send({ t: 'admin_unlink', name });
        } else if (act === 'kick') {
          send({ t: 'admin_kick', name });
        }
      });
      tbody.appendChild(tr);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameEl = form.querySelector('[name=name]'), pwEl = form.querySelector('[name=pw]');
    const name = nameEl.value.trim(), pw = pwEl.value;
    if (!/^[A-Za-z0-9_]{3,13}$/.test(name)) { show('Name: 3 bis 13 Zeichen, nur Buchstaben, Zahlen und _', true); return; }
    if (pw.length < 4) { show('Das Passwort braucht mindestens 4 Zeichen.', true); return; }
    send({ t: 'admin_create', name, pw });
    pwEl.value = '';
  });

  let closed = false;
  box.querySelector('.admin-close').addEventListener('click', () => {
    closed = true;
    ws?.close();
    box.remove();
    onClose?.();
  });

  try {
    ws = new WebSocket(url);
  } catch (e) {
    show('Server-Adresse ungültig: ' + url, true);
    return;
  }
  ws.onopen = () => send({ t: 'admin', token });
  ws.onclose = () => { if (!closed && !status.classList.contains('bad')) show('Verbindung getrennt. Seite neu laden.', true); };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return;
    const msg = JSON.parse(ev.data);
    if (msg.t !== 'admin') return;
    if (!msg.ok) { show(msg.err || 'Abgelehnt', true); return; }
    prefix = msg.prefix || prefix;
    players = msg.players || [];
    box.querySelector('.prefix').textContent = prefix;
    box.querySelector('.admin-self').textContent = msg.selfRegister
      ? 'Neue Spieler können sich auch selbst ein Konto anlegen (self-register: true in der Config).'
      : 'Nur hier angelegte Konten können sich anmelden (self-register: false in der Config).';
    if (msg.err) show(msg.err, true);
    else show(msg.msg || 'Verbunden.');
    render(msg.accounts || []);
  };
}
