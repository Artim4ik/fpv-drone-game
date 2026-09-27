// ============================================================
// GREY CORRIDOR — authoritative session server (WebSocket)
// Relays validated player states at 20 Hz, chat and shared events.
// ============================================================
import { WebSocket, WebSocketServer } from 'ws';
import {
  MAX_PLAYERS,
  MAX_PLAYER_SPEED,
  SNAPSHOT_INTERVAL_MS,
  clampNum,
  sanitizeChat,
  sanitizeName,
  type C2SMessage,
  type ChapterId,
  type ModelKind,
  type PlayerSnapshot,
  type S2CMessage,
} from '../../shared/protocol.js';

const PORT = Number(process.env.GREY_PORT ?? 8787);

interface Client {
  id: string;
  ws: WebSocket;
  name: string;
  model: ModelKind;
  snap: PlayerSnapshot;
  lastT: number;
  alive: boolean;
}

const clients = new Map<string, Client>();
let nextId = 1;

function send(ws: WebSocket, msg: S2CMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

function broadcast(msg: S2CMessage, except?: string): void {
  const raw = JSON.stringify(msg);
  for (const [id, c] of clients) {
    if (id === except) continue;
    if (c.ws.readyState === WebSocket.OPEN) {
      try {
        c.ws.send(raw);
      } catch {
        /* ignore */
      }
    }
  }
}

function validChapter(c: unknown): ChapterId {
  return c === 'city' || c === 'minibus' || c === 'training' || c === 'transport' || c === 'frontline' ? c : 'city';
}

const wss = new WebSocketServer({ port: PORT, path: '/mp' });
console.log(`[grey] multiplayer server on ws://0.0.0.0:${PORT}/mp (max ${MAX_PLAYERS})`);

wss.on('connection', (ws: WebSocket) => {
  if (clients.size >= MAX_PLAYERS) {
    try {
      ws.close(1013, 'server full');
    } catch {
      /* ignore */
    }
    return;
  }
  const id = `p${nextId++}`;
  const now = Date.now();
  const client: Client = {
    id,
    ws,
    name: 'Wanderer',
    model: 'civilian',
    snap: { id, name: 'Wanderer', x: 0, y: 0, z: 0, ry: 0, anim: 'idle', speed: 0, chapter: 'city', health: 100, model: 'civilian' },
    lastT: now,
    alive: true,
  };
  clients.set(id, client);
  console.log(`[grey] + ${id} (${clients.size} online)`);

  send(ws, { t: 'welcome', id, serverTime: now, motd: 'Velgorod session' });

  ws.on('message', (raw: Buffer) => {
    let msg: C2SMessage;
    try {
      msg = JSON.parse(raw.toString()) as C2SMessage;
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      client.name = sanitizeName(msg.name ?? '');
      client.model = msg.model === 'officer' || msg.model === 'soldier' || msg.model === 'instructor' ? msg.model : 'civilian';
      client.snap.name = client.name;
      client.snap.model = client.model;
      client.snap.chapter = validChapter(msg.chapter);
      broadcast({ t: 'chat', from: 'СЕРВЕР', fromId: '', text: `${client.name} подключился`, serverTime: Date.now() });
    } else if (msg.t === 'input') {
      // server-side sanity: finite numbers, world bounds, speed limit
      const nx = clampNum(msg.x, -600, 600);
      const ny = clampNum(msg.y, -50, 200);
      const nz = clampNum(msg.z, -600, 600);
      const t = Date.now();
      const dt = Math.max(0.05, (t - client.lastT) / 1000);
      const dx = nx - client.snap.x;
      const dz = nz - client.snap.z;
      const dist = Math.hypot(dx, dz);
      const maxDist = MAX_PLAYER_SPEED * 1.6 * dt;
      let fx = nx;
      let fz = nz;
      if (dist > maxDist && dist > 0.001) {
        const k = maxDist / dist;
        fx = client.snap.x + dx * k;
        fz = client.snap.z + dz * k;
      }
      client.lastT = t;
      client.snap.x = fx;
      client.snap.y = ny;
      client.snap.z = fz;
      client.snap.ry = clampNum(msg.ry, -Math.PI * 2, Math.PI * 2);
      client.snap.anim = msg.anim;
      client.snap.speed = clampNum(msg.speed, 0, MAX_PLAYER_SPEED);
      client.snap.chapter = validChapter(msg.chapter);
      client.snap.health = clampNum(msg.health, 0, 100);
    } else if (msg.t === 'chat') {
      const text = sanitizeChat(msg.text ?? '');
      if (!text) return;
      broadcast({ t: 'chat', from: client.name, fromId: id, text, serverTime: Date.now() });
    } else if (msg.t === 'event') {
      const kind = String(msg.kind ?? '').slice(0, 32);
      if (!kind) return;
      broadcast({ t: 'event', from: client.name, kind, data: msg.data }, id);
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    console.log(`[grey] - ${id} (${clients.size} online)`);
    broadcast({ t: 'chat', from: 'СЕРВЕР', fromId: '', text: `${client.name} отключился`, serverTime: Date.now() });
  });
  ws.on('error', () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
});

// authoritative snapshot tick
setInterval(() => {
  if (clients.size === 0) return;
  const players: PlayerSnapshot[] = [];
  for (const c of clients.values()) players.push({ ...c.snap });
  const hostId = players.length > 0 ? players[0].id : null;
  broadcast({ t: 'snap', players, hostId, serverTime: Date.now() });
}, SNAPSHOT_INTERVAL_MS);

// ping tick
setInterval(() => {
  for (const c of clients.values()) send(c.ws, { t: 'ping', serverTime: Date.now() });
}, 5000);
