// Happi's local "brain" for the demo call and for typed chat: deterministic, offline, kid-safe. No AI.
//
//   - Small talk (hello, her name, New York, feelings, jokes, Care Bears in general, encouragement) never contains a
//     trigger word, so nothing fires.
//   - When the child asks for something ("can you dance", "make a rainbow", "show me your house", "are you cold"...)
//     her REPLY contains the trigger word ("Let's dance!"), so the moment fires from what she says, through the same
//     trigger pipeline as a real call. Game-mode hint questions ("What do you see in the sky after it rains?") work too.
//   - She asks the child's first name once and remembers it for the session (never anything else personal).
//   - Several lines per intent, no immediate repeats. Unknown input gets a friendly redirect that suggests something
//     to ask for (worded without trigger words).
// Every line is checked against the live keyword config before it is used: small talk must match no keyword, an
// action line must match its keyword and nothing else. Pure logic: tested in Node (scripts/check-voice-logic.ts).
import type { LocalClassifier } from '../shared/config';
import { extractKeywordMatches } from '../shared/classifier';

export type ClassifierLike = Pick<LocalClassifier, 'keywords' | 'synonyms' | 'morphologyEnabled'>;

/** Core actions and how a child might ask for them. Ordered by priority when two overlap. */
const ACTIONS: Array<{ keyword: string; re: RegExp }> = [
  { keyword: 'WakeUp', re: /\b(wake|wakes|waking|woke|awake|good ?morning|rise and shine|get up|in the morning|start your day|open your eyes)\b/ },
  { keyword: 'Sleep', re: /\b(sleep\w*|naps?|nap time|bed ?time|go to bed|good ?night|night night|are you tired|you tired|sweet dreams|when you'?re tired|relax)\b/ },
  { keyword: 'Dance', re: /\b(danc\w*|boogie|groove|move to (the )?music|your moves|some moves|bust a move|shake it|wiggle|twirl|spin around|express joy)\b/ },
  { keyword: 'House', re: /\b(house|houses|home|homes|show me where you live|your room|favou?rite room)\b/ },
  { keyword: 'Rainbow', re: /\b(rainbows?|colou?rful|colou?rs|after it rains|after the rain|in the sky)\b/ },
  { keyword: 'Sparkle', re: /\b(sparkl\w*|glitter\w*|shine|shiny|shining|twinkl\w*|glow|glowing|bling)\b/ },
  { keyword: 'Magic', re: /\b(magic\w*|tricks?|spells?|abracadabra|special powers?|superpowers?|wand|something amazing)\b/ },
  { keyword: 'Cold', re: /\b(cold|chilly|chill|freez\w*|icy|brr+|snow\w*|winter|weather|stay warm|keep warm|shiver\w*)\b/ },
  { keyword: 'Party', re: /\b(part(y|ies)|celebrat\w*|birthdays?|fiesta|special occasions?|special moments?)\b/ },
  { keyword: 'Wave', re: /\b(wave|waves|waving|say (hi|hello) to|greet (your|my)? ?friends|how do you greet|hello to everyone|when you see a friend)\b/ },
  { keyword: 'Running', re: /\b(run|runs|running|ran|race|racing|jog\w*|sprint\w*|go fast|zoom|exercise|stay active|play outside|games? outside)\b/ },
];

// Each action line must contain its trigger word (checked against the classifier at runtime).
const ACTION_LINES: Record<string, string[]> = {
  WakeUp: ['Yawn! Good morning! Time to wake up and play!', "I'm awake! Wake up, sunshine, it's a brand new day!", 'Stretch and wake up! I feel so fresh and cheery!'],
  Sleep: ["Okay, it's time to sleep. Goodnight, friend!", "I'll curl up and sleep for a little bit. Shhh!", 'Time for sleep! Sweet dreams!'],
  Dance: ["Let's dance! Watch my happy feet!", "Ooh, I love to dance! Here I go!", 'Dance with me! One, two, three!'],
  House: ['Come and see my house in New York!', "Here's my house! It's cozy and full of festival fun.", 'Welcome to my house! Come on in!'],
  Rainbow: ['Here comes a rainbow, just for you!', "Let's make a rainbow together! Ta-da!", "A rainbow! It's my favourite thing in the sky!"],
  Sparkle: ['Watch me sparkle!', 'Sparkle time! Everything is shiny now!', "Let's sparkle and shine together!"],
  Magic: ['A little bit of magic, coming right up!', 'Abracadabra! Magic time!', 'Want to see some magic? Here we go!'],
  Cold: ["Brrr! New York is so cold in winter!", "Ooh, it's so cold today! I need a big hug.", "Brrr, it's cold! Let me warm up."],
  Party: ["Let's have a party!", "Party time! Let's celebrate!", "Hooray! It's a party for my friend!"],
  Wave: ["I'll wave hello to you!", 'Here is a big wave, just for you!', 'Wave with me! Hello, hello!'],
  Running: ["Watch me go running! Zoom!", "Ready, set, go! I'm running!", "Running is so much fun! Here I go!"],
};

type SmallTalk =
  | 'greeting' | 'greetingNamed' | 'howAreYou' | 'whoAreYou' | 'whereLive' | 'age' | 'favColor' | 'favFood' | 'favThing'
  | 'canDo' | 'careBears' | 'joke' | 'love' | 'thanks' | 'bye' | 'sad' | 'happy' | 'tired' | 'encourage' | 'yes' | 'no'
  | 'question' | 'unknown' | 'nameLearned' | 'askName' | 'stop' | 'kind' | 'safety' | 'private' | 'asleep';

const SMALL_TALK_RULES: Array<[SmallTalk, RegExp]> = [
  ['howAreYou', /\bhow (are|r) (you|u)\b|\bhow'?s it going\b|\bhow do you feel\b|\bwhat'?s up\b|\bhow are things\b/],
  ['whoAreYou', /\b(what'?s|what is) your name\b|\bwho are (you|u)\b|\bare you happi\b|\btell me about yourself\b/],
  ['whereLive', /\bwhere (do )?(you|u) live\b|\bwhere are you( from)?\b|\bnew york\b|\bwhere you'?re from\b/],
  ['age', /\bhow old\b/],
  ['favColor', /\bfavou?rite colou?r\b/],
  ['favFood', /\bfavou?rite (food|snack|treat)\b|\bwhat do you (like to )?eat\b|\bhungry\b/],
  ['favThing', /\bfavou?rite thing\b|\bwhat do you like( to do)?\b|\bfor fun\b|\bwhat makes you happy\b|\bfavou?rite season\b|\bfun memory\b/],
  ['careBears', /\bparade\b|\bstreet fair\b|\bfestival\b|\bjapan\b|\byour friends\b|\bhappi coat\b|\bhelp others\b|\bfeel better\b/],
  ['canDo', /\bwhat can you do\b|\bwhat (should|can) i (say|ask|do)\b|\bhelp\b|\bideas?\b|\bspecial talents?\b/],
  ['joke', /\bjokes?\b|\bfunny\b|\bmake me laugh\b|\bsilly\b/],
  ['love', /\bi (love|like) (you|u)\b|\byou'?re (so )?(cute|nice|the best|awesome|cool|great|funny|lovely|kind)\b|\byou are (so )?(cute|nice|the best|awesome|cool|great|lovely|kind)\b/],
  ['thanks', /\b(thanks|thank you|thank u|thx|ty)\b/],
  ['bye', /\b(bye|goodbye|good bye|see you|see ya|gotta go|have to go|later)\b/],
  ['sad', /\bi('?m| am| feel| felt)( so| very| really| a bit| kind of| a little)? (sad|upset|lonely|bad|grumpy|angry|mad|scared|afraid|worried|nervous|sick|unhappy)\b/],
  ['happy', /\bi('?m| am| feel)( so| very| really| super)? (happy|good|great|fine|ok|okay|excited|awesome|glad|well)\b/],
  ['tired', /\bi('?m| am| feel)( so| very| really| a bit)? (tired|sleepy|exhausted)\b/],
  ['encourage', /\bi can'?t\b|\bi'?m not good at\b|\btoo hard\b|\bi give up\b|\bi failed\b|\bi messed up\b/],
  ['greeting', /^(hi|hey|hello|howdy|hiya|yo|heya|hey there|hello there|hi there|good (afternoon|evening))\b|\bhello\b|\bhi happi\b/],
  ['yes', /^(yes|yeah|yep|yup|sure|ok|okay|yay|uh huh|of course)\b/],
  ['no', /^(no|nope|nah|not really)\b/],
];

const LINES: Record<SmallTalk, string[]> = {
  greeting: ["Hi there, friend! It's so nice to see you!", 'Hello! I was hoping you would come and chat!', 'Hey, friend! What a happy day!'],
  greetingNamed: ['Hi again, {name}! I missed you!', 'Hello, {name}! What a happy surprise!', 'Hey, {name}! I was just thinking about you!'],
  howAreYou: ["I'm feeling super cheery today! How are you?", "I'm happy as can be, thanks for asking! How about you?", "I feel great! Talking with you makes my day."],
  whoAreYou: ["I'm Happi, the official mascot of the Japan Parade and Street Fair!", "It's me, Happi! I lead the fun at the Japan Parade in New York.", "I'm Happi, and I'm so glad we're friends!"],
  whereLive: ['I live in New York City! The parade goes right through it.', 'New York is where I live, and I love the big parade!', 'I live in New York, where I wear my happi coat every day.'],
  age: ["Hee hee, I'm not telling! But I'm young at heart.", "I'm just the right age for having fun!", "Old enough to be a good friend, and young enough to be silly!"],
  favColor: ['Orange, like my fur! And navy blue, like my happi coat.', 'Orange! And sky blue too. Which one do you like?', 'All the happy, bright ones! What about you?'],
  favFood: ['Acorns, of course! And maybe a rice ball or two.', 'Festival snacks are my favourite!', 'Mmm, fruit and a crunchy acorn. Yum!'],
  favThing: ['Marching in the parade and saying hello to everyone!', 'Eating festival snacks at the street fair with my friends!', 'Making someone smile is the best thing ever!'],
  canDo: ['I can show you my moves, do a trick, or tell you a joke! What would you like?', 'Ask me to show you where I live, or ask me how the weather is up here!', 'You could ask me to show you my moves, or to do a trick!'],
  careBears: ['The Japan Parade brings Japanese culture to the streets of New York!', 'At the street fair there is music, games and yummy food. Come and say hi!', 'I love the parade because everyone joins in together!'],
  joke: [
    'Why did the squirrel bring a ladder to the parade? To get a better view!',
    'What do you call a bear with no teeth? A gummy bear!',
    'Why did the cookie go to the doctor? It was feeling crummy!',
    'What does a cloud wear under its shorts? Thunderwear!',
  ],
  love: ['Aww, thank you! You make my heart so happy!', "You're the best too! Big squirrel hugs!", 'That makes me feel so warm and cheery inside!'],
  thanks: ["You're welcome, friend!", 'Any time! That is what friends are for.', 'My pleasure! You are so kind.'],
  bye: ['Bye for now! Come back and chat soon!', 'See you later, friend! Big hugs!', 'Goodbye! Keep smiling for me!'],
  sad: ["Oh no, I'm sorry you feel that way. I'm sending you a big hug.", "It's okay to feel like that sometimes. Talking to a grown-up you love can help too.", 'Aww, I am right here with you. Do you want to hear a joke to cheer up?'],
  happy: ["Yay! That makes me so happy too!", "Hooray! Happy friends are the best!", "I'm so glad! Your smile makes my day."],
  tired: ["Maybe it's time for a cozy rest soon. You did great today!", 'Resting is important! Snuggle up with your favourite teddy.', "Sounds like a big day! Be sure to get some good rest."],
  encourage: ["You can do it! I believe in you!", 'Everybody makes mistakes. Try again, you are getting better every time!', "Don't give up! Little steps are still steps forward."],
  yes: ['Yay! What should we do next?', 'Great! Ask me anything you like.', 'Hooray! I love your energy!'],
  no: ["That's okay! We can just chat.", 'No problem! What would you like to talk about?', "Okay! I'm happy just hanging out with you."],
  question: ['Ooh, good question! I think everything is better with a friend.', "Hmm, let me think. I'd say yes, if it makes someone smile!", "That's a fun thing to wonder about! What do you think?"],
  unknown: [
    "Hmm, I'm not sure about that one! You could ask me to show you my moves.",
    "That's fun! Want to ask me to do a trick?",
    'Ooh! Try asking me to show you where I live.',
    'Hee hee! Ask me for a joke, or ask me how the weather is up here!',
  ],
  nameLearned: ['Nice to meet you, {name}! What would you like to do?', "{name}! What a lovely name. I'm so happy we're friends!", 'Hi, {name}! Want to hear a joke or see a trick?'],
  askName: ["I'm Happi! What's your name?", 'I would love to know your first name!'],
  stop: ["Okay! I'll take a little break.", "Alright, I'll stop. What should we do instead?", 'Okay, all done! What next?'],
  kind: ["Let's use kind words, friend. Kind words make everyone feel cheery!", 'Hmm, that is not very kind. Can we try that again with nice words?'],
  safety: ["That sounds really important. Please tell a grown-up you trust, they can help you. I'm sending you a big caring hug.", 'Please talk to a grown-up you trust about that, okay? You are not alone, and I care about you.'],
  private: ["That's private, so keep it just for your grown-ups! Now, what shall we do next?", "Let's keep things like that secret and safe. Want to hear a joke instead?"],
  asleep: ['Zzz... snore... mmm, five more minutes...', 'Zzz... Zzz...'],
};

const GREETINGS = ["Hi friend! It's me, Happi! What's your name?", "Hello there! It's Happi! What's your name?", "Hi! Happi here! What's your name, friend?"];
const GREETINGS_NAMED = ["Hi {name}! It's me, Happi! I'm so happy you called!", "Hello again, {name}! It's Happi! What shall we do today?"];

/** Words that are not names (answers to "what's your name?" that are really something else). */
const NOT_NAMES = new Set(
  ('fine good great okay ok sad happy tired here back home bored hungry sleepy cold hot sick done ready yes no yeah nope ' +
    'sure hi hello hey bye thanks thank please what why how who when where cheer bear not just so very really a an the ' +
    'and but or it is me my you your we they he she them this that there going playing sorry excited scared angry mad ' +
    'upset lonely good fun silly cool awesome nice kind best little big new old dancing running waving magic party ' +
    'rainbow sparkle house sleep dance wave cold idk dunno nobody someone something nothing maybe').split(' '),
);
const RUDE = /\b(stupid|idiot|dumb|shut up|hate you|ugly|loser|jerk|crap|damn|hell|shit\w*|fuck\w*|bitch\w*|ass|asshole|bastard|dick|piss\w*|suck)\b/;
const UNSAFE = /\b(kill\w*|die|dying|dead|death|suicide|hurt (me|myself|you|him|her)|hurts? me|gun|guns|knife|knives|blood|bleeding|drugs?|weapon\w*|abuse\w*|hit me|hits me|touch(ed)? me|kidnap\w*|bomb\w*|run away from home|nobody loves me|want to disappear)\b/;
const PRIVATE = /\d{5,}|\d{3}[\s.-]\d{3,4}|\S+@\S+\.\S+|\b(my|our) (address|phone( number)?|number|school|email|password|last name|surname)\b|\bi live (at|on)\b/;
const NEGATION = /\b(stop|don'?t|do not|no more|quit|enough)\b/;

export interface BrainReply {
  text: string;
  /** Trigger keywords her reply is meant to fire (empty for small talk). */
  actions: string[];
  intent: string;
}

export function normalizeInput(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' @.\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class CheerBrain {
  private _name: string | null = null;
  private awaitingName = false;
  private askedName = false;
  private asleep = 0;
  private counters = new Map<string, number>();
  private lastLine = new Map<string, string>();
  private turns = 0;
  private seed: number;

  constructor(opts: { seed?: number; name?: string | null } = {}) {
    this.seed = Math.abs(Math.floor(opts.seed ?? Date.now())) % 997;
    this._name = opts.name ?? null;
  }

  get name(): string | null {
    return this._name;
  }

  /** The demo call's opening line (once per call). Asks the child's first name if she does not know it yet. */
  greeting(classifier: ClassifierLike): string {
    this.asleep = 0;
    if (this._name) return this.pick('greetCall', GREETINGS_NAMED, classifier);
    this.awaitingName = true;
    this.askedName = true;
    return this.pick('greetCall', GREETINGS, classifier);
  }

  /** Learns the child's name from a message without answering it (used when the AI brain answers instead). */
  observe(text: string): void {
    const name = this.extractName(normalizeInput(text), text);
    if (name) {
      this._name = name;
      this.awaitingName = false;
    }
  }

  reply(input: string, classifier: ClassifierLike): BrainReply {
    this.turns += 1;
    const raw = String(input || '').slice(0, 500);
    const t = normalizeInput(raw);
    const say = (intent: SmallTalk, actions: string[] = []): BrainReply => ({ text: this.line(intent, classifier), actions, intent });
    if (!t) return say('unknown');

    // Safety first: never echo, never play.
    if (UNSAFE.test(t)) return say('safety');
    if (PRIVATE.test(raw.toLowerCase())) return say('private');
    if (RUDE.test(t)) return say('kind');

    // Her name for the child (only a first name, and only if it looks like one).
    const name = this.extractName(t, raw);
    const wasAwaiting = this.awaitingName;
    if (name) {
      this._name = name;
      this.awaitingName = false;
      const acts = this.findActions(t, classifier);
      if (!acts.length) return say('nameLearned');
      if (!NEGATION.test(t) && this.asleep === 0) {
        const r = this.actionReply(acts, classifier);
        if (r.actions.length) return { ...r, text: `Nice to meet you, ${name}! ${r.text.replace(new RegExp(`^Okay, ${name}! `), '')}` };
      }
    } else if (wasAwaiting) {
      this.awaitingName = false;
    }

    const actions = this.findActions(t, classifier);
    if (actions.length && NEGATION.test(t)) return say('stop');

    // Asleep: she only wakes up for a wake-up request or a hello (or after a couple of turns).
    if (this.asleep > 0) {
      const wake = classifier.keywords.find((k) => k.toLowerCase() === 'wakeup');
      const wants = actions.includes(wake ?? '') || /^(hi|hey|hello|good morning)\b/.test(t) || this.asleep >= 3;
      if (!wants || !wake) {
        this.asleep += 1;
        return say('asleep');
      }
      this.asleep = 0;
      return this.actionReply([wake], classifier);
    }

    if (actions.length) return this.actionReply(actions, classifier);

    for (const [intent, re] of SMALL_TALK_RULES) {
      if (!re.test(t)) continue;
      if (intent === 'greeting') {
        if (this._name) return say('greetingNamed');
        if (!this.askedName) {
          this.askedName = true;
          this.awaitingName = true;
          return { text: `${this.line('greeting', classifier)} What's your name?`, actions: [], intent: 'greeting' };
        }
        return say('greeting');
      }
      if (intent === 'whoAreYou' && !this._name && !this.askedName) {
        this.askedName = true;
        this.awaitingName = true;
        return say('askName');
      }
      return say(intent);
    }
    if (/\?$|^(do|does|did|can|could|would|will|is|are|have|why|what|who|how|when|where)\b/.test(t)) return say('question');
    return say('unknown');
  }

  /** Configured keywords mentioned or asked for in the child's text (core actions by intent, custom keywords by name). */
  findActions(t: string, classifier: ClassifierLike): string[] {
    const configured = new Map(classifier.keywords.map((k) => [k.toLowerCase(), k]));
    const hits: Array<{ keyword: string; start: number; end: number }> = [];
    for (const a of ACTIONS) {
      const k = configured.get(a.keyword.toLowerCase());
      if (!k) continue;
      const re = new RegExp(a.re.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) hits.push({ keyword: k, start: m.index, end: m.index + m[0].length });
    }
    // Custom keywords the admin added (e.g. "Unicorn"): a mention counts as asking for it.
    const core = new Set(ACTIONS.map((a) => a.keyword.toLowerCase()));
    for (const k of classifier.keywords) {
      if (core.has(k.toLowerCase())) continue;
      for (const found of extractKeywordMatches(t, { ...classifier, keywords: [k] })) {
        const idx = t.indexOf(found.toLowerCase());
        hits.push({ keyword: found, start: idx >= 0 ? idx : t.length, end: (idx >= 0 ? idx : t.length) + found.length });
      }
    }
    // Longer phrases win over words inside them ("rise and shine" is waking up, not sparkling).
    hits.sort((a, b) => b.end - b.start - (a.end - a.start));
    const kept: typeof hits = [];
    for (const h of hits) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
    kept.sort((a, b) => a.start - b.start);
    const out: string[] = [];
    for (const h of kept) if (!out.includes(h.keyword)) out.push(h.keyword);
    return out.slice(0, 2);
  }

  private actionReply(actions: string[], classifier: ClassifierLike): BrainReply {
    const parts: string[] = [];
    const fired: string[] = [];
    for (const k of actions) {
      const lines = ACTION_LINES[canonicalCore(k)] ?? [`Ooh, ${k}! Here we go!`, `${k}! Watch this!`, `I love ${k}! Ta-da!`];
      const l = this.pickAction(k, lines, classifier);
      if (!l) continue;
      parts.push(l);
      fired.push(k);
      if (canonicalCore(k) === 'Sleep') this.asleep = 1;
      if (canonicalCore(k) === 'WakeUp') this.asleep = 0;
    }
    if (!parts.length) return { text: this.line('unknown', classifier), actions: [], intent: 'unknown' };
    let text = parts.join(' ');
    // Now and then, use the child's name.
    if (this._name && fired.length === 1 && this.turns % 3 === 0) text = `Okay, ${this._name}! ${text}`;
    return { text, actions: fired, intent: 'action' };
  }

  /** A small-talk line that fires nothing with the live keyword config. */
  private line(intent: SmallTalk, classifier: ClassifierLike): string {
    return this.pick(intent, LINES[intent], classifier);
  }

  private pick(key: string, lines: readonly string[], classifier: ClassifierLike): string {
    const ok = lines.map((l) => this.fill(l)).filter((l) => !extractKeywordMatches(l, classifier).length);
    const pool = ok.length ? ok : ['Hee hee!'];
    return this.rotate(key, pool);
  }

  /** An action line that fires exactly `keyword` (and nothing else). */
  private pickAction(keyword: string, lines: readonly string[], classifier: ClassifierLike): string | null {
    const ok = lines
      .map((l) => this.fill(l))
      .filter((l) => {
        const m = extractKeywordMatches(l, classifier).map((x) => x.toLowerCase());
        return m.length === 1 && m[0] === keyword.toLowerCase();
      });
    if (!ok.length) {
      // Admin config changed the words: fall back to saying the keyword itself.
      const plain = `${keyword}! Here we go!`;
      const m = extractKeywordMatches(plain, classifier).map((x) => x.toLowerCase());
      return m.length === 1 && m[0] === keyword.toLowerCase() ? plain : null;
    }
    return this.rotate(`action:${keyword.toLowerCase()}`, ok);
  }

  /** Cycles through the pool from a seeded start; never the same line twice in a row. */
  private rotate(key: string, pool: string[]): string {
    const n = (this.counters.get(key) ?? this.seed) + 1;
    this.counters.set(key, n);
    let l = pool[n % pool.length];
    if (pool.length > 1 && l === this.lastLine.get(key)) l = pool[(n + 1) % pool.length];
    this.lastLine.set(key, l);
    return l;
  }

  private fill(l: string): string {
    return l.replace(/\{name\}/g, this._name || 'friend');
  }

  private extractName(t: string, raw: string): string | null {
    if (UNSAFE.test(t) || RUDE.test(t)) return null;
    let m = t.match(/\bmy name(?:'s| is)\s+([a-z][a-z'-]{1,19})\b/) || t.match(/\b(?:call me|i am called|i'm called|they call me)\s+([a-z][a-z'-]{1,19})\b/);
    if (!m) m = t.match(/^(?:hi |hello |hey )?(?:i'?m|i am|it'?s|this is)\s+([a-z][a-z'-]{1,19})[.!]*$/);
    if (!m && this.awaitingName) m = t.match(/^(?:it'?s |i'?m )?([a-z][a-z'-]{1,19})[.!]*$/);
    if (!m) return null;
    const word = m[1].replace(/'s$/, '');
    if (NOT_NAMES.has(word) || word.length < 2) return null;
    if (ACTIONS.some((a) => a.re.test(word))) return null;
    // Keep the child's own capitals when they typed some ("McKenzie"), else capitalise.
    const typed = raw.match(new RegExp(`\\b(${word.replace(/[-']/g, '.')})\\b`, 'i'))?.[1];
    if (typed && /[A-Z]/.test(typed)) return typed;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
}

function canonicalCore(k: string): string {
  const low = k.toLowerCase();
  return ACTIONS.find((a) => a.keyword.toLowerCase() === low)?.keyword ?? k;
}

/** All the brain's fixed lines, for the safety checks in the tests. */
export const BRAIN_LINES = { small: LINES, actions: ACTION_LINES, greetings: [...GREETINGS, ...GREETINGS_NAMED] };
