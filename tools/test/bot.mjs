// Headless WebCraft player: logs in, answers teleports, records animations it sees.
const name = process.argv[2] || 'Lena';
const ws = new WebSocket(process.env.WC_URL || 'ws://127.0.0.1:25007', { headers: { origin: 'null' } });
ws.binaryType = 'arraybuffer';
const out = { anims: [], players: new Set(), myId: null };
// Test password (WC_PW): sets it on the first login (register), then logs in with it
ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, pw: process.env.WC_PW || 'bot-test', register: true }));
ws.onmessage = (ev) => {
  if (typeof ev.data !== 'string') return;
  const m = JSON.parse(ev.data);
  if (m.t === 'welcome') out.myId = m.entityId;
  if (m.t === 'tp') ws.send(JSON.stringify({ t: 'tp_ok', id: m.id, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch }));
  if (m.t === 'ents') for (const e of m.list) if (e.type === 'player') out.players.add(e.i + ':' + e.n);
  if (m.t === 'anim') out.anims.push(...m.l);
  if (m.t === 'stats' && m.dead) ws.send(JSON.stringify({ t: 'respawn' }));
  if (m.t === 'error') console.log('error', m.msg);
};
setTimeout(() => {
  console.log(JSON.stringify({ myId: out.myId, players: [...out.players], anims: out.anims }));
  ws.close(); process.exit(0);
}, +(process.argv[3] || 25000));
