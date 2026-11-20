// Happi's short canned answers to voice mode commands (no AI). Spoken with the browser's voice and shown in her
// speech bubble. A line must NEVER contain a trigger word, or saying it would fire a moment again: every line is
// checked against the LIVE keyword config before use (an admin adding a keyword like "Look" just skips the lines that
// contain it), and the voice session also claims all keywords for her line's transcript.
import { extractKeywordMatches } from '../shared/classifier';
import type { VoiceCommand, ClassifierLike } from './commands';

export const REPLY_LINES: Record<string, readonly string[]> = {
  // trigger words (per moment, then a generic set)
  house: ['Come and see where I live!', 'Welcome to my place!', 'Come on in!'],
  rainbow: ['Ooh, look up!', 'So pretty up there!', 'Look up in the sky!'],
  dance: ['Watch my happy feet!', 'Here I go!', 'Wiggle with me!'],
  party: ['Woo hoo!', 'Yay, hooray!', 'This is so much fun!'],
  sparkle: ['Twinkle twinkle!', 'So shiny!', 'Ooh, pretty!'],
  magic: ['Abracadabra!', 'Ta-da!', 'Watch this!'],
  sleep: ['Yawn. Good night!', 'Nighty night!', 'Time for a little rest.'],
  wakeup: ['Good morning, friend!', 'I feel so fresh!', 'Hello, sunshine!'],
  wave: ['Hi there, friend!', 'Hello, hello!', 'Hi! I see you!'],
  running: ['Zoom zoom!', 'Catch me if you can!', 'Here I go, super fast!'],
  cold: ['Brrr!', 'Ooh, chilly!', 'Brrr, I need a scarf!'],
  stare: ['Here it comes!', 'Feel the love!', 'From my heart to yours!'],
  trigger: ['Watch this!', 'Here we go!', 'Ta-da!', 'Yay!'],
  // modes
  showcase: ['Back to my world!', 'Welcome back!', 'Here we are again!'],
  ar: ['Let me visit your room!', 'Find me a nice spot!', 'Ooh, your room!'],
  face: ['Let me see your smile!', 'Say hi to the camera!', 'Selfie time!'],
  photo: ['Let us make a photo!', 'Ooh, a 3D photo!', 'Strike a pose!'],
  // camera + games
  capture: ['Smile!', 'Say cheese!', 'Ooh, nice one!'],
  place: ['Here I am!', 'This spot is perfect!', 'I like it here!'],
  move: ['Where should I go?', 'Pick a new spot!', 'Okay, where to?'],
  play: ['Let us play!', 'Ready, set, go!', 'Game time!'],
  stopPlay: ['Good game!', 'That was fun!', 'Great playing!'],
  pause: ['Taking a little break.', 'Okay, we can wait.'],
  resume: ['Back to it!', 'Here we go again!'],
  again: ['One more time!', 'Again, again!', 'Let us go again!'],
  hug: ['I love you too!', 'Big squeeze!', 'Aww, you are the best!'],
};

const recent = new Map<string, string>();

function replyKey(c: VoiceCommand): string {
  switch (c.kind) {
    case 'trigger': {
      const k = c.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '');
      return REPLY_LINES[k] ? k : 'trigger';
    }
    case 'mode': return c.mode;
    case 'command': return c.name;
    case 'play': return 'play';
    case 'stopPlay': return 'stopPlay';
  }
}

/** A line for this command that contains none of the live trigger words, or null. No immediate repeats. */
export function pickReply(command: VoiceCommand, classifier: ClassifierLike): string | null {
  const key = replyKey(command);
  const safe = (lines: readonly string[]) =>
    lines.filter((l) => extractKeywordMatches(l, { ...classifier, morphologyEnabled: true }).length === 0
      && extractKeywordMatches(l, classifier).length === 0);
  let lines = safe(REPLY_LINES[key] ?? []);
  if (!lines.length && command.kind === 'trigger') lines = safe(REPLY_LINES.trigger);
  if (!lines.length) return null;
  const last = recent.get(key);
  const pool = lines.length > 1 ? lines.filter((l) => l !== last) : lines;
  const line = pool[Math.floor(Math.random() * pool.length)];
  recent.set(key, line);
  return line;
}
