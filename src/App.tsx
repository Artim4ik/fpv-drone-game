import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DroneScene, { type HitEventKind, type Telemetry } from "./game/DroneScene";

type GameMode = "briefing" | "running" | "paused" | "ended";
type MissionResult = "success" | "failed" | null;
type FeedItem = { id: number; message: string; kind: HitEventKind };

const INITIAL_AMMO = 8;
const INITIAL_TARGETS = 7;
const MISSION_SECONDS = 180;

const initialTelemetry: Telemetry = {
  altitude: 18,
  speed: 0,
  heading: 0,
  signal: 100,
  battery: 100,
  range: null,
  locked: false,
  gamepad: false,
  flightMode: "ANGLE",
};

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function Crosshair({ locked }: { locked: boolean }) {
  return (
    <div className={`crosshair ${locked ? "crosshair--locked" : ""}`} aria-hidden="true">
      <span className="crosshair__corner crosshair__corner--tl" />
      <span className="crosshair__corner crosshair__corner--tr" />
      <span className="crosshair__corner crosshair__corner--bl" />
      <span className="crosshair__corner crosshair__corner--br" />
      <span className="crosshair__dot" />
    </div>
  );
}

function GamepadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.4 8.2h9.2c2 0 3.1 1.2 3.8 3.7l.8 3c.7 2.5-2 4-3.7 2.2l-1.9-2H8.4l-1.9 2c-1.7 1.8-4.4.3-3.7-2.2l.8-3c.7-2.5 1.8-3.7 3.8-3.7Z" />
      <path d="M8 10.4v3.3M6.35 12.05h3.3M15.9 11.2h.02M18 13.1h.02" />
    </svg>
  );
}

function App() {
  const [mode, setMode] = useState<GameMode>("briefing");
  const [result, setResult] = useState<MissionResult>(null);
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [ammo, setAmmo] = useState(INITIAL_AMMO);
  const [targets, setTargets] = useState(INITIAL_TARGETS);
  const [timeLeft, setTimeLeft] = useState(MISSION_SECONDS);
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry);
  const [muted, setMuted] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const modeRef = useRef<GameMode>(mode);
  const menuButtonPressedRef = useRef(false);
  const feedIdRef = useRef(0);

  const isActive = mode === "running";
  modeRef.current = mode;

  const launchMission = useCallback(() => {
    setRound((value) => value + 1);
    setScore(0);
    setAmmo(INITIAL_AMMO);
    setTargets(INITIAL_TARGETS);
    setTimeLeft(MISSION_SECONDS);
    setTelemetry(initialTelemetry);
    setFeed([]);
    setResult(null);
    setMode("running");
  }, []);

  const endMission = useCallback((missionResult: Exclude<MissionResult, null>) => {
    setResult(missionResult);
    setMode("ended");
  }, []);

  const handleTargetDestroyed = useCallback(
    (points: number) => {
      setScore((value) => value + points);
      setTargets((value) => {
        const next = Math.max(0, value - 1);
        if (next === 0) endMission("success");
        return next;
      });
    },
    [endMission],
  );

  const handleBombReleased = useCallback(() => {
    setAmmo((value) => Math.max(0, value - 1));
  }, []);

  const handleEvent = useCallback((message: string, kind: HitEventKind, points?: number) => {
    if (points) setScore((value) => value + points);
    feedIdRef.current += 1;
    const id = feedIdRef.current;
    setFeed((items) => [...items.slice(-4), { id, message, kind }]);
    window.setTimeout(() => {
      setFeed((items) => items.filter((item) => item.id !== id));
    }, 5200);
  }, []);

  useEffect(() => {
    if (mode !== "running") return;
    const timer = window.setInterval(() => {
      setTimeLeft((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          endMission("failed");
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [endMission, mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Escape") return;
      setMode((value) => {
        if (value === "running") return "paused";
        if (value === "paused") return "running";
        return value;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    const pollMenuControls = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((item) => item?.connected) ?? null;
      const currentMode = modeRef.current;
      const confirmPressed = currentMode === "briefing" || currentMode === "ended"
        ? Boolean(pad?.buttons[0]?.pressed || pad?.buttons[9]?.pressed)
        : Boolean(pad?.buttons[9]?.pressed);

      if (confirmPressed && !menuButtonPressedRef.current) {
        if (currentMode === "briefing" || currentMode === "ended") launchMission();
        else setMode(currentMode === "running" ? "paused" : "running");
      }
      menuButtonPressedRef.current = confirmPressed;
      animationFrame = window.requestAnimationFrame(pollMenuControls);
    };
    animationFrame = window.requestAnimationFrame(pollMenuControls);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [launchMission]);

  const headingLabel = useMemo(
    () => `${Math.round(telemetry.heading).toString().padStart(3, "0")}°`,
    [telemetry.heading],
  );

  const requestFullscreen = () => {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen();
    else void document.exitFullscreen();
  };

  return (
    <main className="game-shell">
      <DroneScene
        key={round}
        active={isActive}
        muted={muted}
        initialAmmo={INITIAL_AMMO}
        onTargetDestroyed={handleTargetDestroyed}
        onBombReleased={handleBombReleased}
        onTelemetry={setTelemetry}
        onOutOfAmmo={() => endMission("failed")}
        onEvent={handleEvent}
      />

      <div className="screen-fx" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      {mode !== "briefing" && (
        <div className="hud" aria-live="polite">
          <header className="hud__top">
            <div className="hud__brand">
              <span className="hud__brand-mark" />
              <div>
                <strong>BLACK KITE</strong>
                <span>FPV / LIVE FEED</span>
              </div>
            </div>

            <div className="hud__mission">
              <span>ОПЕРАЦИЯ «ТИХИЙ КОРИДОР»</span>
              <strong>{formatTime(timeLeft)}</strong>
            </div>

            <div className="hud__actions">
              <button type="button" onClick={() => setMuted((value) => !value)} aria-label="Звук">
                {muted ? "SND OFF" : "SND ON"}
              </button>
              <button type="button" onClick={requestFullscreen} aria-label="Полный экран">
                FULL
              </button>
              <button
                type="button"
                onClick={() => setMode((value) => (value === "running" ? "paused" : "running"))}
                aria-label="Пауза"
              >
                {mode === "paused" ? "RESUME" : "PAUSE"}
              </button>
            </div>
          </header>

          <div className="hud__left">
            <span>ALT</span>
            <strong>{Math.round(telemetry.altitude).toString().padStart(2, "0")}<small> M</small></strong>
            <i />
            <span>SPD</span>
            <strong>{Math.round(telemetry.speed).toString().padStart(2, "0")}<small> KM/H</small></strong>
            <i />
            <span>MODE</span>
            <strong className="hud__mode">{telemetry.flightMode}</strong>
          </div>

          <div className="hud__right">
            <span>LINK</span>
            <strong>{Math.round(telemetry.signal)}%</strong>
            <i className="signal-bars"><b /><b /><b /><b /></i>
            <span>BAT</span>
            <strong>{Math.round(telemetry.battery)}%</strong>
          </div>

          <Crosshair locked={telemetry.locked} />
          <div className={`lock-readout ${telemetry.locked ? "lock-readout--active" : ""}`}>
            {telemetry.locked ? "ЦЕЛЬ В СЕКТОРЕ" : "ПОИСК ЦЕЛИ"}
            {telemetry.range !== null && <strong>{Math.round(telemetry.range)} M</strong>}
          </div>

          <footer className="hud__bottom">
            <div className={`controller-state ${telemetry.gamepad ? "is-online" : ""}`}>
              <GamepadIcon />
              <span>{telemetry.gamepad ? "XBOX / USB ПОДКЛЮЧЕН" : "КЛАВИАТУРА / ОЖИДАНИЕ GAMEPAD"}</span>
            </div>
            <div className="heading">
              <span>W</span><span>NW</span><strong>{headingLabel}</strong><span>NE</span><span>E</span>
            </div>
            <div className="payload">
              <span>ЦЕЛИ <strong>{targets}</strong></span>
              <span>ПГ-7В <strong>{ammo}</strong></span>
              <span>СЧЕТ <strong>{score.toString().padStart(4, "0")}</strong></span>
            </div>
          </footer>

          {feed.length > 0 && (
            <div className="hit-feed" aria-live="polite">
              {feed.map((item) => (
                <div key={item.id} className={`hit-feed__item hit-feed__item--${item.kind}`}>
                  {item.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "briefing" && (
        <section className="briefing">
          <div className="briefing__eyebrow"><span /> БРАУЗЕРНАЯ FPV-СИСТЕМА</div>
          <h1>BLACK<br /><em>KITE</em></h1>
          <p className="briefing__lead">
            Колонна: Т-72Б и Т-90А с динамической защитой. На борту — кумулятивные
            боеголовки ПГ-7В: лоб Т-90 держит, бей в борт, моторный отсек или сверху.<br />
            USB-контроллер Xbox определяется автоматически.
          </p>
          <button className="launch-button" type="button" onClick={launchMission}>
            <span>ЗАПУСТИТЬ МИССИЮ</span>
            <b>A</b>
          </button>
          <div className="briefing__controls">
            <div><strong>ЛЕВЫЙ СТИК</strong><span>Тяга / поворот</span></div>
            <div><strong>ПРАВЫЙ СТИК</strong><span>Тангаж / крен</span></div>
            <div><strong>RT</strong><span>ПГ-7В: сброс</span></div>
            <div><strong>A</strong><span>Перегрузка моторов</span></div>
            <div><strong>C</strong><span>ANGLE / ACRO</span></div>
          </div>
          <p className="briefing__fallback">
            Клавиатура: W/S — тангаж, A/D — рыскание, стрелки — крен, Shift/Ctrl — газ,
            пробел — пуск, C — режим полёта
          </p>
        </section>
      )}

      {mode === "paused" && (
        <section className="modal-layer">
          <div className="modal-layer__line" />
          <span>СИГНАЛ ПРИОСТАНОВЛЕН</span>
          <h2>ПАУЗА</h2>
          <button type="button" onClick={() => setMode("running")}>ПРОДОЛЖИТЬ</button>
          <small>ESC</small>
        </section>
      )}

      {mode === "ended" && (
        <section className={`modal-layer result result--${result}`}>
          <div className="modal-layer__line" />
          <span>{result === "success" ? "ЗАДАЧА ВЫПОЛНЕНА" : "КАНАЛ ЗАКРЫТ"}</span>
          <h2>{result === "success" ? "КОРИДОР ЧИСТ" : "МИССИЯ СОРВАНА"}</h2>
          <p>Счет {score.toString().padStart(4, "0")} / поражено {INITIAL_TARGETS - targets} из {INITIAL_TARGETS}</p>
          <button type="button" onClick={launchMission}>ПОВТОРИТЬ ВЫЛЕТ</button>
        </section>
      )}
    </main>
  );
}

export default App;
