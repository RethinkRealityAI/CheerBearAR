import { Check, Lightbulb, RotateCcw } from 'lucide-react';
import { useApp, useController } from '../context';
import { CHAT_TIME_ID, gameWords } from '../state/game';
import { actionLabel } from '../actions';

/** Game selector. Choosing a game (or Free play) starts it fresh. */
export function GamesPanel() {
  const c = useController();
  const modes = useApp((s) => s.ui.gameModes.filter((g) => g.enabled));
  const keywords = useApp((s) => s.ui.keywords);
  const game = useApp((s) => s.game);
  const current = modes.find((m) => m.id === game.modeId) ?? null;
  const words = gameWords(current, keywords);

  return (
    <div className="cb-games">
      <p className="cb-panel-lead">Get Cheer Bear to say the magic words. Ask her questions; you can’t just tell her the word!</p>
      <div className="cb-game-list" role="radiogroup" aria-label="Choose a game">
        {modes.map((m) => {
          const n = gameWords(m, keywords).length;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={game.modeId === m.id}
              className="cb-game"
              onClick={() => c.selectGame(m.id)}
            >
              <span className="cb-game-name">{m.name}</span>
              {m.description && <span className="cb-game-desc">{m.description}</span>}
              <span className="cb-game-meta">{m.id === CHAT_TIME_ID ? 'All the magic words' : `${n} word${n === 1 ? '' : 's'} to find`}</span>
            </button>
          );
        })}
        <button type="button" role="radio" aria-checked={game.modeId === null} className="cb-game" onClick={() => c.selectGame(null)}>
          <span className="cb-game-name">Free play</span>
          <span className="cb-game-desc">No game, just chat and have fun.</span>
        </button>
      </div>
      {current && (
        <div className="cb-game-progress">
          <h3>{current.name}: {game.found.length} of {words.length} found</h3>
          <ul className="cb-wordchips" aria-label="Words">
            {words.map((w) => {
              const found = game.found.includes(w);
              return (
                <li key={w} className={found ? 'is-found' : ''}>
                  {found && <Check aria-hidden="true" size={14} />}
                  {actionLabel(w)}
                  <span className="cb-sr-only">{found ? ' (found)' : ' (not found yet)'}</span>
                </li>
              );
            })}
          </ul>
          <div className="cb-row">
            <button type="button" className="cb-btn is-soft" onClick={() => c.openOverlay('hint')}>
              <Lightbulb aria-hidden="true" size={20} /> Hints
            </button>
            <button type="button" className="cb-btn is-ghost" onClick={() => c.resetGame()} disabled={game.found.length === 0}>
              <RotateCcw aria-hidden="true" size={20} /> Start over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
