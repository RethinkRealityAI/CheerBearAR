// A small in-memory log of everything the microphone and speech recognition do (voice-4), for the "Mic check" view
// (`?voicediag`, or Settings > Mic check). Every hold of the talk button writes here too, so after a failed hold the
// view shows exactly which events the phone gave us (start, audiostart, soundstart, speechstart, results, error code,
// end) and when. Nothing leaves the page: "Copy log" puts it on the clipboard for the person to paste to us.
//
// Pure and tiny: a ring buffer + subscribers. Safe in Node (tests) and in every browser.

export interface VoiceLogEntry {
  /** ms since the page loaded (performance.now()), rounded. */
  t: number;
  /** Which hold (listening session) it belongs to; 0 for page-level facts. */
  hold: number;
  /** Event name: 'press', 'start()', 'start', 'audiostart', 'soundstart', 'speechstart', 'result', 'error', 'end', ... */
  ev: string;
  detail?: string;
}

const MAX = 400;
const entries: VoiceLogEntry[] = [];
const subs = new Set<() => void>();
let version = 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function voiceLog(hold: number, ev: string, detail?: string): void {
  entries.push({ t: Math.round(now()), hold, ev, detail });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  version += 1;
  for (const cb of subs) {
    try { cb(); } catch { /* a view's problem, not ours */ }
  }
}

export function voiceLogEntries(): readonly VoiceLogEntry[] {
  return entries;
}

/** Changes on every write (for React's useSyncExternalStore). */
export function voiceLogVersion(): number {
  return version;
}

export function onVoiceLog(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function clearVoiceLog(): void {
  entries.length = 0;
  version += 1;
  for (const cb of subs) cb();
}

/** One line per entry, times relative to each hold's first entry ("+0.412s"). */
export function formatVoiceLog(list: readonly VoiceLogEntry[] = entries): string {
  const first = new Map<number, number>();
  return list.map((e) => {
    if (!first.has(e.hold)) first.set(e.hold, e.t);
    const rel = ((e.t - (first.get(e.hold) ?? e.t)) / 1000).toFixed(3);
    const head = e.hold ? `#${e.hold} +${rel}s` : `page ${(e.t / 1000).toFixed(1)}s`;
    return `${head.padEnd(14)} ${e.ev}${e.detail ? `  ${e.detail}` : ''}`;
  }).join('\n');
}
