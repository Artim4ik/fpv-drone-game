import { useCallback, useEffect, useRef, useState } from "react";
import DroneScene, {
  type ControlScheme,
  type HitEventKind,
  type Telemetry,
} from "./game/DroneScene";

type GameMode = "briefing" | "running" | "paused" | "ended";
type MissionResult = "success" | "failed" | null;
type FeedItem = { id: number; message: string; kind: HitEventKind };

const SCHEME_STORAGE_KEY = "blackkite-scheme";

function loadScheme(): ControlScheme {
  try {
    return window.localStorage.getItem(SCHEME_STORAGE_KEY) === "rollAD" ? "rollAD" : "yawAD";
  } catch {
    return "yawAD";
  }
}

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
  flightMode: "ACRO",
  respawning: false,
  throttle: 0,
  roll: 0,
  pitch: 0,
  voltage: 16.8,
  current: 0,
  consumedMah: 0,
};

const COMPASS_PPD = 2.4;
const CARDINALS: Array<{ deg: number; label: string; major?: boolean }> = [
  { deg: 0, label: "N", major: true },
  { deg: 45, label: "NE" },
  { deg: 90, label: "E", major: true },
  { deg: 135, label: "SE" },
  { deg: 180, label: "S", major: true },
  { deg: 225, label: "SW" },
  { deg: 270, label: "W", major: true },
  { deg: 315, label: "NW" },
];

function CompassTape({ heading }: { heading: number }) {
  return (
    <div className="compass" aria-hidden="true">
      <div
        className="compass__strip"
        style={{ transform: `translateX(${-heading * COMPASS_PPD}px)` }}
      >
        {[-1, 0, 1].flatMap((cycle) =>
          CARDINALS.map((mark) => (
            <span
              key={`${cycle}-${mark.deg}`}
              className={`compass__mark ${mark.major ? "compass__mark--major" : ""}`}
              style={{ left: `${(cycle * 360 + mark.deg) * COMPASS_PPD}px` }}
            >
              {mark.label}
            </span>
          )),
        )}
      </div>
      <span className="compass__pointer" />
    </div>
  );
}

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
  const [targets, setTargets] = useState(INITIAL_TARGETS);
  const [timeLeft, setTimeLeft] = useState(MISSION_SECONDS);
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry);
  const [muted, setMuted] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [controlScheme, setControlScheme] = useState<ControlScheme>(loadScheme);
  const modeRef = useRef<GameMode>(mode);
  const menuButtonPressedRef = useRef(false);
  const feedIdRef = useRef(0);

  const isActive = mode === "running";
  modeRef.current = mode;

  const toggleScheme = () => {
    setControlScheme((previous) => {
      const next: ControlScheme = previous === "yawAD" ? "rollAD" : "yawAD";
      try {
        window.localStorage.setItem(SCHEME_STORAGE_KEY, next);
      } catch {
        // Storage is optional.
      }
      return next;
    });
  };

  const launchMission = useCallback(() => {
    setRound((value) => value + 1);
    setScore(0);
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
        controlScheme={controlScheme}
        onTargetDestroyed={handleTargetDestroyed}
        onTelemetry={setTelemetry}
        onEvent={handleEvent}
      />

      <div className={`screen-fx ${telemetry.respawning ? "screen-fx--lost" : ""}`} aria-hidden="true" />
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
              <button type="button" onClick={toggleScheme} aria-label="Схема управления">
                {controlScheme === "yawAD" ? "A/D: РЫСК" : "A/D: КРЕН"}
              </button>
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
            <small className="osd-rssi">
              RSSI {Math.round(-30 - (100 - telemetry.signal) * 1.1)} dBm
            </small>
            <i className="signal-bars"><b /><b /><b /><b /></i>
            <span>BAT</span>
            <strong>{Math.round(telemetry.battery)}%</strong>
          </div>

          <div className="osd-power" aria-hidden="true">
            <strong>{telemetry.voltage.toFixed(1)}V</strong>
            <span>{Math.round(telemetry.current)}A</span>
            <span>{telemetry.consumedMah} mAh</span>
          </div>

          <div className="throttle-gauge" aria-label={`Тяга ${Math.round(telemetry.throttle * 100)} процентов`}>
            <div className="throttle-gauge__track">
              <div
                className="throttle-gauge__fill"
                style={{ height: `${Math.round(telemetry.throttle * 100)}%` }}
              />
            </div>
            <strong>{Math.round(telemetry.throttle * 100)}</strong>
            <span>THR</span>
          </div>

          {!telemetry.respawning && (
            <div className="ah" aria-hidden="true">
              <div
                className="ah__horizon"
                style={{
                  transform: `translate(-50%, -50%) rotate(${
                    (telemetry.roll * 180) / Math.PI
                  }deg) translateY(${(telemetry.pitch * 180) / Math.PI * 2.6}px)`,
                }}
              >
                <i className="ah__tick ah__tick--l" />
                <i className="ah__tick ah__tick--r" />
              </div>
            </div>
          )}

          <Crosshair locked={telemetry.locked && !telemetry.respawning} />
          <div
            className={`lock-readout ${
              telemetry.respawning
                ? "lock-readout--respawn"
                : telemetry.locked
                  ? "lock-readout--active"
                  : ""
            }`}
          >
            {telemetry.respawning
              ? "СИГНАЛ ПОТЕРЯН — ПЕРЕЗАПУСК БОРТА"
              : telemetry.locked
                ? "ЦЕЛЬ В СЕКТОРЕ"
                : "ПОИСК ЦЕЛИ"}
            {!telemetry.respawning && telemetry.range !== null && (
              <strong>{Math.round(telemetry.range)} M</strong>
            )}
          </div>

          <footer className="hud__bottom">
            <div className={`controller-state ${telemetry.gamepad ? "is-online" : ""}`}>
              <GamepadIcon />
              <span>{telemetry.gamepad ? "XBOX / USB ПОДКЛЮЧЕН" : "КЛАВИАТУРА / ОЖИДАНИЕ GAMEPAD"}</span>
            </div>
            <CompassTape heading={telemetry.heading} />
            <div className="payload">
              <span>ЦЕЛИ <strong>{targets}</strong></span>
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
            Ты — FPV-камикадзе «BLACK KITE» в режиме ACRO. Колонна: Т-72Б и Т-90А
            с динамической защитой — лоб Т-90 держит удар, бей в борт, корму или
            сверху. После удара борт пересоздаётся в воздухе.<br />
            USB-контроллер Xbox определяется автоматически.
          </p>
          <button className="launch-button" type="button" onClick={launchMission}>
            <span>ЗАПУСТИТЬ МИССИЮ</span>
            <b>A</b>
          </button>
          <div className="briefing__controls">
            <div><strong>ЛЕВЫЙ СТИК / SHIFT</strong><span>Тяга: только вверх, отпустил — 0</span></div>
            <div><strong>ПРАВЫЙ СТИК</strong><span>Крен / тангаж</span></div>
            <div><strong>SPACE / A</strong><span>Форсаж</span></div>
            <div><strong>X</strong><span>Стабилизация (удерживать)</span></div>
          </div>
          <p className="briefing__fallback">
            Клавиатура: Shift — тяга вверх (отпустил — дрон падает), Ctrl — сброс тяги,
            W/S — тангаж,{" "}
            {controlScheme === "yawAD"
              ? "A/D (или Q/E) — рыскание, ←/→ — крен"
              : "A/D (или ←/→) — крен, Q/E — рыскание"}
            , Space — форсаж, X — стабилизация, ESC — пауза. Схема A/D — в HUD.
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
