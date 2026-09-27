// ============================================================
// GREY CORRIDOR — core game types, fictional data, quality presets
// Everything here is FICTIONAL: city, authorities, names, documents.
// ============================================================

import type { AnimState, ChapterId, ModelKind } from '../../shared/protocol';

export type { AnimState, ChapterId, ModelKind };
export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowMap: number;
  fogDensity: number;
  viewDistance: number;
  particles: number; // 0..1 particle budget multiplier
  lamps: number; // max dynamic lamp lights
  rain: boolean;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 0.7, shadows: false, shadowMap: 512, fogDensity: 1.25, viewDistance: 220, particles: 0.35, lamps: 2, rain: false },
  medium: { pixelRatio: 1.0, shadows: true, shadowMap: 1024, fogDensity: 1.0, viewDistance: 320, particles: 0.65, lamps: 4, rain: false },
  high: { pixelRatio: 1.35, shadows: true, shadowMap: 2048, fogDensity: 0.85, viewDistance: 420, particles: 1.0, lamps: 6, rain: true },
  ultra: { pixelRatio: 1.7, shadows: true, shadowMap: 2048, fogDensity: 0.7, viewDistance: 520, particles: 1.4, lamps: 8, rain: true },
};

// ---------------- documents (all fictional) ----------------
export type DocKind =
  | 'civil_id'
  | 'exemption'
  | 'temp_pass'
  | 'medical'
  | 'registration'
  | 'forged'
  | 'incomplete';

export type DocStatus = 'valid' | 'expired' | 'suspect' | 'incomplete';

export interface GameDoc {
  uid: string;
  kind: DocKind;
  title: string;
  holder: string;
  idNumber: string;
  issuedBy: string;
  issueDate: string;
  expiry: string;
  status: DocStatus;
  /** Whether patrol officers accept it. */
  valid: boolean;
  photoSeed: number;
  note: string;
}

export const DOC_META: Record<DocKind, { title: string; issuedBy: string }> = {
  civil_id: { title: 'Удостоверение личности', issuedBy: 'Бюро гражданского реестра Вельгорода' },
  exemption: { title: 'Освобождение от призыва', issuedBy: 'Окружная комиссия Крежны' },
  temp_pass: { title: 'Временный пропуск', issuedBy: 'Муниципальный пропускной пункт №3' },
  medical: { title: 'Медицинская справка', issuedBy: 'Городская поликлиника №2' },
  registration: { title: 'Регистрационный лист', issuedBy: 'Жилищное управление, участок 7' },
  forged: { title: '«Освобождение» (подделка)', issuedBy: '???' },
  incomplete: { title: 'Незаполненный бланк', issuedBy: '???' },
};

const FIRST = ['Милан', 'Стефан', 'Павел', 'Данило', 'Йован', 'Марко', 'Лука', 'Томаш', 'Вит', 'Адам', 'Филип', 'Олег'];
const LAST = ['Ковач', 'Новак', 'Хорват', 'Пешич', 'Маркович', 'Степанов', 'Гаврич', 'Леснич', 'Вукович', 'Драганов', 'Зорич', 'Краль'];

export function fictionalName(seed: number): string {
  const f = FIRST[Math.abs(seed) % FIRST.length];
  const l = LAST[Math.abs(seed >> 3) % LAST.length];
  return `${f} ${l}`;
}

export function fictionalId(seed: number): string {
  const a = 100000 + (Math.abs(seed * 7919) % 900000);
  return `ВГ-${a}`;
}

let docCounter = 0;
export function makeDoc(kind: DocKind, seed: number, overrides: Partial<GameDoc> = {}): GameDoc {
  docCounter += 1;
  const meta = DOC_META[kind];
  const status: DocStatus =
    kind === 'forged' ? 'suspect' : kind === 'incomplete' ? 'incomplete' : kind === 'registration' ? 'expired' : 'valid';
  return {
    uid: `doc-${Date.now().toString(36)}-${docCounter}`,
    kind,
    title: meta.title,
    holder: fictionalName(seed),
    idNumber: fictionalId(seed),
    issuedBy: meta.issuedBy,
    issueDate: `1${(seed % 9) + 1}.0${(seed % 8) + 1}.2025`,
    expiry: kind === 'temp_pass' ? '30.09.2026' : '31.12.2027',
    status,
    valid: status === 'valid' && kind !== 'forged',
    photoSeed: seed * 31 + 7,
    note: '',
    ...overrides,
  };
}

// ---------------- HUD snapshot (game -> React) ----------------
export type EncounterStage =
  | 'none'
  | 'suspicion'
  | 'approach'
  | 'dialog'
  | 'struggle'
  | 'released'
  | 'detained';

export interface Objective {
  title: string;
  detail: string;
  progress?: string;
}

export interface MiniDot {
  x: number;
  z: number;
  kind: 'player' | 'ally' | 'enemy' | 'van' | 'pickup' | 'target' | 'checkpoint';
}

export interface HudSnapshot {
  chapter: ChapterId;
  chapterLabel: string;
  health: number;
  stamina: number;
  suspicion: number; // 0..1
  encounter: EncounterStage;
  dialogLines: string[];
  docCount: number;
  validCount: number;
  objective: Objective;
  ammo: number;
  reserve: number;
  armed: boolean;
  fps: number;
  ping: number;
  players: number;
  online: boolean;
  isHost: boolean;
  muted: boolean;
  quality: Quality;
  dots: MiniDot[];
  compass: number; // camera yaw deg
  message: string | null;
  messageT: number;
  struggle: number; // 0..1 escape meter
  detained: boolean;
  dead: boolean;
  victory: boolean;
  stats: PlayerStats;
  prompt: string | null;
  dialogOptions: string[];
  hurtT: number;
  fade: 'none' | 'out' | 'in';
}

export interface PlayerStats {
  endurance: number;
  accuracy: number;
  movement: number;
  reaction: number;
  stamina: number;
  handling: number;
}

export const DEFAULT_STATS: PlayerStats = {
  endurance: 20,
  accuracy: 15,
  movement: 20,
  reaction: 15,
  stamina: 20,
  handling: 10,
};

export interface ChatLine {
  from: string;
  text: string;
  mine: boolean;
  t: number;
}

export const CHAPTER_LABELS: Record<ChapterId, string> = {
  city: 'ГЛАВА 1 — ВЕЛЬГОРОД',
  minibus: 'ПЕРЕХОД — МИКРОАВТОБУС',
  training: 'ГЛАВА 2 — УЧЕБНЫЙ ЦЕНТР «СЕВЕРНЫЙ»',
  transport: 'ПЕРЕХОД — КОЛОННА',
  frontline: 'ГЛАВА 3 — ДОЛИНА КРЕЖНЫ',
};

const SAVE_KEY = 'grey-corridor-save-v1';

export interface SaveData {
  stats: PlayerStats;
  chapter: ChapterId;
  docsFound: number;
  bestEval: number;
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SaveData;
  } catch {
    return null;
  }
}

export function storeSave(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable */
  }
}
