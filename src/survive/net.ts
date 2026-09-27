// ============================================================
// GREY CORRIDOR — multiplayer client (native WebSocket, offline-safe)
// Connects to same-origin /mp (vite proxies to the game server).
// ============================================================
import {
  MAX_PLAYER_SPEED,
  clampNum,
  sanitizeChat,
  type AnimState,
  type C2SMessage,
  type ChapterId,
  type ModelKind,
  type PlayerSnapshot,
  type S2CMessage,
} from '../../shared/protocol';

export type NetStatus = 'connecting' | 'online' | 'offline';

export interface LocalState {
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: AnimState;
  speed: number;
  chapter: ChapterId;
  health: number;
}

export interface ChatMsg {
  from: string;
  text: string;
  mine: boolean;
  t: number;
}

interface NetEvents {
  onStatus: (s: NetStatus, ping: number) => void;
  onChat: (m: ChatMsg) => void;
  onRemoteEvent: (from: string, kind: string, data: unknown) => void;
}

function defaultUrl(): string {
  try {
    const override = localStorage.getItem('grey_mp_url');
    if (override && override.length > 4) return override;
  } catch {
    /* ignore */
  }
  const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_MP_URL;
  if (env) return env;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/mp`;
}

export class NetClient {
  id = '';
  isHost = false;
  status: NetStatus = 'offline';
  ping = 0;
  remotes = new Map<string, PlayerSnapshot>();

  private ws: WebSocket | null = null;
  private url = '';
  private name = 'Wanderer';
  private model: ModelKind = 'civilian';
  private local: LocalState = { x: 0, y: 0, z: 0, ry: 0, anim: 'idle', speed: 0, chapter: 'city', health: 100 };
  private sendTimer: number | null = null;
  private retryTimer: number | null = null;
  private lastSnap = 0;
  private pingSent = 0;
  private events: NetEvents = { onStatus: () => undefined, onChat: () => undefined, onRemoteEvent: () => undefined };
  private wanted = false;

  on(evt: Partial<NetEvents>): void {
    this.events = { ...this.events, ...evt };
  }

  connect(name: string, model: ModelKind): void {
    this.name = name;
    this.model = model;
    this.url = defaultUrl();
    this.wanted = true;
    this.open();
  }

  disconnect(): void {
    this.wanted = false;
    this.cleanup();
    this.setStatus('offline');
  }

  setLocal(s: LocalState): void {
    this.local = s;
  }

  sendChat(text: string): void {
    const clean = sanitizeChat(text);
    if (!clean) return;
    if (this.status === 'online') {
      this.send({ t: 'chat', text: clean });
    } else {
      this.events.onChat({ from: this.name, text: clean, mine: true, t: Date.now() });
    }
  }

  sendEvent(kind: string, data?: unknown): void {
    if (this.status === 'online') this.send({ t: 'event', kind, data });
  }

  remoteCount(): number {
    return this.remotes.size;
  }

  // ---------- internals ----------
  private setStatus(s: NetStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.events.onStatus(s, this.ping);
    }
  }

  private open(): void {
    this.cleanup();
    if (!this.wanted) return;
    this.setStatus('connecting');
    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.send({ t: 'hello', name: this.name, chapter: this.local.chapter, model: this.model });
        this.sendTimer = window.setInterval(() => this.pushInput(), 90);
        this.pingSent = performance.now();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as S2CMessage;
          this.handle(msg);
        } catch {
          /* malformed packet */
        }
      };
      ws.onclose = () => this.scheduleRetry();
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      this.scheduleRetry();
    }
  }

  private cleanup(): void {
    if (this.sendTimer !== null) {
      window.clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleRetry(): void {
    this.cleanup();
    this.remotes.clear();
    this.isHost = false;
    if (!this.wanted) {
      this.setStatus('offline');
      return;
    }
    this.setStatus('offline');
    this.retryTimer = window.setTimeout(() => this.open(), 5000);
  }

  private send(msg: C2SMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    }
  }

  private pushInput(): void {
    const l = this.local;
    this.send({
      t: 'input',
      x: clampNum(l.x, -600, 600),
      y: clampNum(l.y, -50, 200),
      z: clampNum(l.z, -600, 600),
      ry: clampNum(l.ry, -Math.PI * 2, Math.PI * 2),
      anim: l.anim,
      speed: clampNum(l.speed, 0, MAX_PLAYER_SPEED),
      chapter: l.chapter,
      health: clampNum(l.health, 0, 100),
    });
  }

  private handle(msg: S2CMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        this.setStatus('online');
        break;
      case 'snap': {
        this.lastSnap = performance.now();
        void this.lastSnap;
        const seen = new Set<string>();
        for (const p of msg.players) {
          if (p.id === this.id) continue;
          seen.add(p.id);
          this.remotes.set(p.id, p);
        }
        for (const id of [...this.remotes.keys()]) {
          if (!seen.has(id)) this.remotes.delete(id);
        }
        const wasHost = this.isHost;
        this.isHost = msg.hostId !== null && msg.hostId === this.id;
        if (wasHost !== this.isHost) this.events.onStatus(this.status, this.ping);
        break;
      }
      case 'chat':
        this.events.onChat({ from: msg.from, text: msg.text, mine: msg.fromId === this.id, t: Date.now() });
        break;
      case 'event':
        this.events.onRemoteEvent(msg.from, msg.kind, msg.data);
        break;
      case 'ping':
        this.ping = Math.max(1, Math.round(performance.now() - this.pingSent));
        this.pingSent = performance.now();
        this.events.onStatus(this.status, this.ping);
        break;
    }
  }
}
