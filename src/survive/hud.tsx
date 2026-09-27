// ============================================================
// GREY CORRIDOR — HUD, dialogs, wallet, briefing, minimap (React)
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMsg } from './net';
import { docPhotoUrl } from './textures';
import type { GameDoc, HudSnapshot, Quality } from './types';
import { ASSET_URLS } from './assets';

export interface HudViewProps {
  hud: HudSnapshot | null;
  docs: GameDoc[];
  chat: ChatMsg[];
  walletOpen: boolean;
  paused: boolean;
  started: boolean;
  playerName: string;
  onStart: (name: string, quality: Quality) => void;
  onResume: () => void;
  onExit: () => void;
  onToggleWallet: () => void;
  onDialogChoice: (i: number) => void;
  onSendChat: (text: string) => void;
  onQuality: (q: Quality) => void;
  onMute: () => void;
}

const QUALITY_LABEL: Record<Quality, string> = {
  low: 'НИЗЬК.',
  medium: 'СЕРЕДН.',
  high: 'ВИСОК.',
  ultra: 'УЛЬТРА',
};

function Bar({ value, max = 100, className = '' }: { value: number; max?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`gc-bar ${className}`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

function Minimap({ hud }: { hud: HudSnapshot }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const S = 148;
    const bounds = hud.chapter === 'frontline' ? 200 : hud.chapter === 'training' ? 120 : hud.chapter === 'transport' ? 40 : 100;
    const scale = (S / 2 - 8) / bounds;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(8,12,10,0.72)';
    g.beginPath();
    g.roundRect(0, 0, S, S, 10);
    g.fill();
    g.strokeStyle = 'rgba(150,180,150,0.15)';
    for (let i = 1; i < 6; i++) {
      g.beginPath();
      g.moveTo((S / 6) * i, 0);
      g.lineTo((S / 6) * i, S);
      g.stroke();
      g.beginPath();
      g.moveTo(0, (S / 6) * i);
      g.lineTo(S, (S / 6) * i);
      g.stroke();
    }
    const dot = (x: number, z: number, color: string, r: number): void => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(S / 2 + x * scale, S / 2 + z * scale, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const d of hud.dots) {
      if (d.kind === 'pickup') dot(d.x, d.z, '#9fe07a', 2.5);
      else if (d.kind === 'checkpoint') dot(d.x, d.z, '#ff9a4a', 4);
      else if (d.kind === 'enemy') dot(d.x, d.z, '#ff5a4a', 3);
      else if (d.kind === 'ally') dot(d.x, d.z, '#7ad2ff', 3);
      else if (d.kind === 'van') dot(d.x, d.z, '#ffd27a', 4);
    }
    const me = hud.dots.find((d) => d.kind === 'player');
    if (me) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(S / 2 + me.x * scale, S / 2 + me.z * scale, 5, 0, Math.PI * 2);
      g.stroke();
      dot(me.x, me.z, '#ffffff', 2.5);
    }
    g.fillStyle = 'rgba(220,230,220,0.6)';
    g.font = 'bold 10px Arial';
    g.fillText('П', S / 2 - 3, 12);
  }, [hud]);
  return <canvas ref={ref} width={148} height={148} className="gc-minimap" />;
}

function DocCard({ doc }: { doc: GameDoc }) {
  const photo = useMemo(() => docPhotoUrl(doc.photoSeed), [doc.photoSeed]);
  const statusColor = doc.kind === 'summons' ? '#ff9a4a' : doc.status === 'valid' ? '#9fe07a' : doc.status === 'expired' ? '#ffd27a' : doc.status === 'suspect' ? '#ff5a4a' : '#8a8a8a';
  return (
    <div className="gc-doc">
      <div className="gc-doc__head">
        <strong>{doc.title}</strong>
        <span style={{ color: statusColor }}>
          {doc.kind === 'summons' ? 'ПОТРЕБУЄ ЯВКИ' : doc.status === 'valid' ? 'ДІЙСНИЙ' : doc.status === 'expired' ? 'ПРОСТРОЧЕНИЙ' : doc.status === 'suspect' ? 'ПІДОЗРІЛИЙ' : 'НЕ ЗАПОВНЕНИЙ'}
        </span>
      </div>
      <div className="gc-doc__body">
        <img src={photo} alt="Фото" />
        <div>
          <p><b>Власник:</b> {doc.holder}</p>
          <p><b>№:</b> {doc.idNumber}</p>
          <p><b>Видано:</b> {doc.issuedBy}</p>
          <p><b>Дата:</b> {doc.issueDate} — {doc.expiry}</p>
        </div>
      </div>
      <p className="gc-doc__note">Вигаданий документ. Усі дані згенеровано.</p>
    </div>
  );
}

function ChatBox({ chat, onSend }: { chat: ChatMsg[]; onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);
  return (
    <div className="gc-chat">
      <div className="gc-chat__lines" ref={boxRef}>
        {chat.slice(-5).map((m, i) => (
          <p key={`${m.t}-${i}`} className={m.mine ? 'mine' : ''}>
            <b>{m.from}:</b> {m.text}
          </p>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSend(text.trim());
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Повідомлення команді…" maxLength={140} />
      </form>
    </div>
  );
}

function Briefing({ onStart }: { onStart: (name: string, q: Quality) => void }) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('grey_name') ?? '';
    } catch {
      return '';
    }
  });
  const [q, setQ] = useState<Quality>('medium');
  return (
    <section className="gc-briefing">
      <div className="gc-briefing__panel">
        <div className="gc-eyebrow"><span /> ВИГАДАНА ІСТОРІЯ • МУЛЬТИПЛЕЄР 1–16</div>
        <h1>СІРИЙ<br /><em>КОРИДОР</em></h1>
        <p className="gc-lead">Київ. Східний напрямок. Звичайний городянин — і система, від якої не сховатись.</p>
        <p className="gc-story">
          Знайди документи. Переживи облаву. Пройди навчальний центр. Виживи на сході.
          Грайте разом: позиції, завдання та чат синхронізуються між гравцями.
        </p>
        <div className="gc-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Позивний…"
            maxLength={16}
            className="gc-name"
          />
          <div className="gc-quality">
            {(Object.keys(QUALITY_LABEL) as Quality[]).map((k) => (
              <button key={k} type="button" className={q === k ? 'active' : ''} onClick={() => setQ(k)}>
                {QUALITY_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <button
          className="gc-launch"
          type="button"
          onClick={() => {
            try {
              localStorage.setItem('grey_name', name || 'Мандрівник');
            } catch {
              /* ignore */
            }
            onStart(name || 'Мандрівник', q);
          }}
        >
          ПОЧАТИ ГРУ
        </button>
        <div className="gc-controls">
          <div><b>WASD</b><span>рух</span></div>
          <div><b>Миша</b><span>камера (клік — захоплення)</span></div>
          <div><b>Shift</b><span>біг</span></div>
          <div><b>E</b><span>дія</span></div>
          <div><b>C</b><span>присісти</span></div>
          <div><b>Tab</b><span>документи</span></div>
          <div><b>ЛКМ/ПКМ</b><span>вогонь / приціл</span></div>
          <div><b>R</b><span>перезаряджання</span></div>
        </div>
        <p className="gc-fiction">Вигадка: місто, організації, персонажі та документи вигадані. Збіги випадкові.</p>
      </div>
    </section>
  );
}

export default function HudView(props: HudViewProps) {
  const { hud, docs, chat, walletOpen, paused, started } = props;
  if (!started || !hud) {
    return <Briefing onStart={props.onStart} />;
  }
  const cinematic = hud.chapter === 'minibus' || hud.chapter === 'transport';
  return (
    <div className="gc-hud">
      <img className="gc-lensdirt" src={ASSET_URLS.lensdirt} alt="" draggable={false} />
      {hud.fade === 'out' && <div key="fout" className="gc-fade" />}
      {hud.fade === 'in' && <div key="fin" className="gc-fade gc-fade--in" />}
      {hud.hurtT > 0 && <div key={hud.hurtT} className="gc-hurt" />}
      {hud.health < 32 && !hud.dead && <div className="gc-lowhp" />}
      {cinematic && (
        <>
          <div className="gc-cine gc-cine--top" />
          <div className="gc-cine gc-cine--bottom" />
        </>
      )}

      <header className="gc-top">
        <div className="gc-brand">
          <span className="gc-brand__mark" />
          <div>
            <strong>СІРИЙ КОРИДОР</strong>
            <span>{hud.chapterLabel}</span>
          </div>
        </div>
        <div className="gc-compass">
          <span style={{ transform: `translateX(${-((hud.compass % 90) / 90) * 40}px)` }}>П&nbsp;&nbsp;С&nbsp;&nbsp;Пд&nbsp;&nbsp;З&nbsp;&nbsp;П&nbsp;&nbsp;С&nbsp;&nbsp;Пд&nbsp;&nbsp;З</span>
          <b>{Math.round(hud.compass)}°</b>
        </div>
        <div className="gc-net">
          <span className={hud.online ? 'on' : 'off'}>{hud.online ? `ОНЛАЙН • ${hud.players} • ${hud.ping}ms` : 'ОФЛАЙН'} {hud.isHost && '• ХОСТ'}</span>
          <span>{hud.fps} FPS</span>
          <button type="button" onClick={props.onMute}>{hud.muted ? 'SND OFF' : 'SND ON'}</button>
          <button type="button" onClick={props.onExit}>МЕНЮ</button>
        </div>
      </header>

      <div className="gc-objective">
        <strong>{hud.objective.title}</strong>
        <span>{hud.objective.detail}</span>
        {hud.objective.progress && <b>{hud.objective.progress}</b>}
      </div>

      <div className="gc-right">
        <Minimap hud={hud} />
        {hud.suspicion > 0.02 && hud.chapter === 'city' && (
          <div className="gc-susp">
            <span>ПАТРУЛЬ {hud.suspicion > 0.85 ? '!' : '?'}</span>
            <Bar value={hud.suspicion * 100} className="susp" />
          </div>
        )}
      </div>

      <div className="gc-left">
        <div className="gc-vital"><span>ЗДОРОВ’Я</span><Bar value={hud.health} className="hp" /></div>
        <div className="gc-vital"><span>ВИТРИВАЛІСТЬ</span><Bar value={hud.stamina} className="st" /></div>
        {hud.chapter === 'city' && (
          <div className="gc-docsline">ДОКУМЕНТИ <b>{hud.docCount}</b> • ДІЙСН. <b>{hud.validCount}</b> <i>[Tab]</i></div>
        )}
        {hud.armed && (
          <div className="gc-ammo">БК <b>{hud.ammo}</b> / {hud.reserve}</div>
        )}
      </div>

      {hud.armed && !walletOpen && !paused && !hud.dead && (
        <div className="gc-cross"><i /><i /><i /><i /><b /></div>
      )}
      {hud.prompt && !walletOpen && <div className="gc-prompt">{hud.prompt}</div>}
      {hud.message && <div className="gc-toast">{hud.message}</div>}

      {/* encounter dialog */}
      {hud.encounter === 'dialog' && (
        <section className="gc-dialog">
          <div className="gc-dialog__who">ТЦК • ПАТРУЛЬ 0417</div>
          <div className="gc-dialog__lines">
            {hud.dialogLines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
          <div className="gc-dialog__opts">
            {hud.dialogOptions.map((o, i) => (
              <button key={i} type="button" onClick={() => props.onDialogChoice(i)}>
                <b>{i + 1}</b> {o}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* suspicion whisper */}
      {hud.encounter === 'suspicion' && hud.dialogLines.length > 0 && (
        <div className="gc-whisper">{hud.dialogLines[0]}</div>
      )}

      {/* struggle QTE */}
      {hud.encounter === 'struggle' && (
        <section className="gc-struggle">
          <h2>ВИРИВАЙСЯ! ТИСНИ E!</h2>
          <Bar value={hud.struggle * 100} className="st" />
        </section>
      )}

      {/* cinematic subtitles */}
      {cinematic && hud.dialogLines.length > 0 && (
        <div className="gc-subs">{hud.dialogLines[0]}</div>
      )}

      {hud.dead && <div className="gc-dead">ВИ ПОРАНЕНІ…</div>}

      {/* wallet */}
      {walletOpen && (
        <section className="gc-wallet">
          <div className="gc-wallet__panel">
            <header>
              <strong>ДОКУМЕНТИ</strong>
              <button type="button" onClick={props.onToggleWallet}>ЗАКРИТИ [Tab]</button>
            </header>
            {docs.length === 0 && <p className="gc-empty">Поки порожньо. Шукайте документи у місті.</p>}
            <div className="gc-wallet__grid">
              {docs.map((d) => (
                <DocCard key={d.uid} doc={d} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* pause */}
      {paused && !hud.victory && (
        <section className="gc-modal">
          <h2>ПАУЗА</h2>
          <div className="gc-quality">
            {(Object.keys(QUALITY_LABEL) as Quality[]).map((k) => (
              <button key={k} type="button" className={hud.quality === k ? 'active' : ''} onClick={() => props.onQuality(k)}>
                {QUALITY_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="gc-stats">
            <div>Витривалість <b>{hud.stats.endurance}</b></div>
            <div>Влучність <b>{hud.stats.accuracy}</b></div>
            <div>Рух <b>{hud.stats.movement}</b></div>
            <div>Реакція <b>{hud.stats.reaction}</b></div>
          </div>
          <div className="gc-row">
            <button type="button" onClick={props.onResume}>ПРОДОВЖИТИ</button>
            <button type="button" onClick={() => window.location.reload()}>ЗАНОВО</button>
            <button type="button" onClick={props.onExit}>В МЕНЮ</button>
          </div>
        </section>
      )}

      {/* victory */}
      {hud.victory && (
        <section className="gc-modal gc-victory">
          <div className="gc-eyebrow"><span /> ЕВАКУАЦІЯ ВДАЛАСЯ</div>
          <h2>КОРИДОР ПРОЙДЕНО</h2>
          <p>Ви пережили облаву, навчальний центр і східний напрямок.</p>
          <div className="gc-stats">
            <div>Витривалість <b>{hud.stats.endurance}</b></div>
            <div>Влучність <b>{hud.stats.accuracy}</b></div>
            <div>Рух <b>{hud.stats.movement}</b></div>
            <div>Реакція <b>{hud.stats.reaction}</b></div>
            <div>Документів <b>{hud.docCount}</b></div>
          </div>
          <div className="gc-row">
            <button type="button" onClick={() => window.location.reload()}>ГРАТИ ЗНОВУ</button>
            <button type="button" onClick={props.onExit}>В МЕНЮ</button>
          </div>
        </section>
      )}

      {!paused && !hud.victory && <ChatBox chat={chat} onSend={props.onSendChat} />}
      <div className="gc-hint">WASD — рух • E — дія • C — присісти • Tab — документи • клік — захоплення миші</div>
    </div>
  );
}
