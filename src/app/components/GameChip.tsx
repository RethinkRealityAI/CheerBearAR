// Game progress chip, centred under the experience's top bar while a game is on. Tap opens the game details
// (words, hints). Chat Time hides the total, as in the old app.
import { useEffect } from 'react';
import { Gamepad2 } from 'lucide-react';
import { useApp, useController } from '../context';
import { CHAT_TIME_ID, gameWords } from '../state/game';

export function GameChip() {
  const c = useController();
  const game = useApp((s) => s.game);
  const modes = useApp((s) => s.ui.gameModes);
  const keywords = useApp((s) => s.ui.keywords);
  const mode = modes.find((m) => m.id === game.modeId && m.enabled);
  const shown = !!mode;
  // The experience's hint pill sits under the top bar too: tell it to move down while the chip is there.
  useEffect(() => {
    const root = document.documentElement;
    if (shown) root.style.setProperty('--cb-top-reserve', '50px');
    else root.style.removeProperty('--cb-top-reserve');
    return () => { root.style.removeProperty('--cb-top-reserve'); };
  }, [shown]);
  if (!mode) return null;
  const words = gameWords(mode, keywords);
  const found = game.found.length;
  const showTotal = mode.id !== CHAT_TIME_ID;
  const count = showTotal ? `${found} of ${words.length} words` : `${found} word${found === 1 ? '' : 's'} found`;
  return (
    <button
      type="button"
      className={`cb-chip${game.completedAt ? ' is-done' : ''}`}
      onClick={() => c.openOverlay('hint')}
      aria-label={`${mode.name}: ${count}. Open game details and hints`}
      data-testid="game-chip"
    >
      <Gamepad2 aria-hidden="true" size={18} />
      <span className="cb-chip-name">{mode.name}</span>
      <span className="cb-chip-count">{count}</span>
      {showTotal && words.length <= 12 && (
        <span className="cb-chip-dots" aria-hidden="true">
          {words.map((w) => <i key={w} className={game.found.includes(w) ? 'on' : ''} />)}
        </span>
      )}
    </button>
  );
}
