// Game launcher: GREY CORRIDOR (new) + BLACK KITE FPV (original).
import { useState } from 'react';
import FpvApp from './fpv/FpvApp';
import SurviveScene from './survive/SurviveScene';

type Screen = 'menu' | 'grey' | 'fpv';

function Launcher({ go }: { go: (s: Screen) => void }) {
  return (
    <main className="gc-launcher">
      <div className="gc-launcher__bg" />
      <div className="gc-launcher__panel">
        <div className="gc-eyebrow"><span /> БРАУЗЕРНЫЕ 3D-ИГРЫ • THREE.JS</div>
        <h1>ARENA<br /><em>ARCADE</em></h1>
        <div className="gc-launcher__cards">
          <button type="button" className="gc-card gc-card--grey" onClick={() => go('grey')}>
            <span className="gc-card__tag">МУЛЬТИПЛЕЕР 1–16 • СЮЖЕТ</span>
            <strong>GREY CORRIDOR</strong>
            <span className="gc-card__sub">Вельгород — учебка — долина Крежны</span>
            <p>Выживание гражданского, проверки документов, белый микроавтобус патруля, военный учебный центр и кооперативные миссии. Вымышленная история.</p>
            <b className="gc-card__go">ИГРАТЬ →</b>
          </button>
          <button type="button" className="gc-card gc-card--fpv" onClick={() => go('fpv')}>
            <span className="gc-card__tag">ОДИНОЧНАЯ • FPV</span>
            <strong>BLACK KITE</strong>
            <span className="gc-card__sub">Оригинальная игра репозитория</span>
            <p>Полёт на FPV-дроне, поиск и поражение колонны техники. Поддержка Xbox-контроллера.</p>
            <b className="gc-card__go">ИГРАТЬ →</b>
          </button>
        </div>
        <p className="gc-fiction">Grey Corridor — вымысел: город, организации, персонажи и документы придуманы.</p>
      </div>
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  if (screen === 'grey') return <SurviveScene onExit={() => setScreen('menu')} />;
  if (screen === 'fpv') return <FpvApp />;
  return <Launcher go={setScreen} />;
}
