// ============================================================
// GREY CORRIDOR — React mount: creates Game on user gesture.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import './grey.css';
import { Game } from './Game';
import type { ChatMsg } from './net';
import HudView from './hud';
import type { GameDoc, HudSnapshot, Quality } from './types';

export default function SurviveScene({ onExit }: { onExit: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [docs, setDocs] = useState<GameDoc[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [walletOpen, setWalletOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const walletRef = useRef(false);
  const pausedRef = useRef(false);
  walletRef.current = walletOpen;
  pausedRef.current = paused;

  const toggleWallet = useCallback(() => {
    setWalletOpen((v) => !v);
  }, []);

  const handleStart = useCallback((name: string, quality: Quality, brainrot: boolean) => {
    if (!mountRef.current || gameRef.current) return;
    const game = new Game(mountRef.current, {
      name,
      quality,
      brainrot,
      onHud: (h) => setHud(h),
      onDocs: (d) => setDocs(d),
      onChat: (c) => setChat(c),
      onEvent: (kind, data) => {
        if (kind === 'pause') {
          // Escape closes wallet first
          if (walletRef.current && data === true) {
            setWalletOpen(false);
            game.setPaused(false);
            setPaused(false);
            return;
          }
          setPaused(data === true);
        }
      },
    });
    gameRef.current = game;
    setStarted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!gameRef.current) return;
      if (e.code === 'Tab' || e.code === 'KeyF') {
        e.preventDefault();
        setWalletOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (gameRef.current) {
        gameRef.current.dispose();
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div className="gc-shell">
      <div ref={mountRef} className="gc-mount" />
      <HudView
        hud={hud}
        docs={docs}
        chat={chat}
        walletOpen={walletOpen}
        paused={paused}
        started={started}
        playerName=""
        onStart={handleStart}
        onResume={() => {
          gameRef.current?.setPaused(false);
          setPaused(false);
        }}
        onExit={onExit}
        onToggleWallet={toggleWallet}
        onDialogChoice={(i) => gameRef.current?.chooseDialog(i)}
        onSendChat={(t) => gameRef.current?.sendChat(t)}
        onQuality={(q) => gameRef.current?.applyQuality(q)}
        onMute={() => {
          const m = !(hud?.muted ?? false);
          gameRef.current?.setMuted(m);
        }}
      />
    </div>
  );
}
