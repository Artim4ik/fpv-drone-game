// ============================================================
// GREY CORRIDOR — shared multiplayer protocol (client + server)
// Fictional game. All organizations, places and persons are fictional.
// ============================================================

export const TICK_RATE = 20;
export const MAX_PLAYERS = 16;
export const SNAPSHOT_INTERVAL_MS = 1000 / TICK_RATE;
/** Max plausible player speed (m/s) used by server-side sanity checks. */
export const MAX_PLAYER_SPEED = 14;

export type AnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'crouch'
  | 'aim'
  | 'sit'
  | 'struggle'
  | 'down';

export type ChapterId = 'city' | 'minibus' | 'training' | 'transport' | 'frontline';

export type ModelKind = 'civilian' | 'officer' | 'soldier' | 'instructor';

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: AnimState;
  speed: number;
  chapter: ChapterId;
  health: number;
  model: ModelKind;
}

// ---------- client -> server ----------
export interface C2SHello {
  t: 'hello';
  name: string;
  chapter: ChapterId;
  model: ModelKind;
}
export interface C2SInput {
  t: 'input';
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: AnimState;
  speed: number;
  chapter: ChapterId;
  health: number;
}
export interface C2SChat {
  t: 'chat';
  text: string;
}
export interface C2SEvent {
  t: 'event';
  kind: string;
  data?: unknown;
}
export type C2SMessage = C2SHello | C2SInput | C2SChat | C2SEvent;

// ---------- server -> client ----------
export interface S2CWelcome {
  t: 'welcome';
  id: string;
  serverTime: number;
  motd: string;
}
export interface S2CSnapshot {
  t: 'snap';
  players: PlayerSnapshot[];
  /** Designated host (first client) — relays minibus/mission state. */
  hostId: string | null;
  serverTime: number;
}
export interface S2CChat {
  t: 'chat';
  from: string;
  fromId: string;
  text: string;
  serverTime: number;
}
export interface S2CEvent {
  t: 'event';
  from: string;
  kind: string;
  data?: unknown;
}
export interface S2CPing {
  t: 'ping';
  serverTime: number;
}
export type S2CMessage = S2CWelcome | S2CSnapshot | S2CChat | S2CEvent | S2CPing;

// ---------- helpers ----------
export function sanitizeName(raw: string): string {
  const clean = raw.replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
  return clean.length >= 2 ? clean : 'Wanderer';
}

export function sanitizeChat(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 140);
}

export function clampNum(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
