export const PROMPTS = [
  'how are you, really?',
  'what happened today?',
  "what's been on your mind lately?",
  "tell me something you don't want to forget.",
  'what are you afraid to say?',
  'what made you happy today?',
  'what are you feeling right now?',
  "tell me about someone you're thinking about.",
  'what do you wish someone understood?',
  'what would you tell your future self?',
  "what's something you're proud of?",
  'what are you trying to let go of?',
  'what do you wish you could say?',
  'tell me about today.',
  'say something you need to hear.',
];

/** Pick `count` prompts, avoiding the ones currently shown when possible. */
export function pickPrompts(count: number, avoid: string[] = [], random = Math.random): string[] {
  const pool = PROMPTS.filter((p) => !avoid.includes(p));
  const source = pool.length >= count ? pool : [...PROMPTS];
  const out: string[] = [];
  const copy = [...source];
  while (out.length < count && copy.length) {
    out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
  }
  return out;
}

export const REMINDER_LINES = [
  'anything on your mind?',
  'want to leave yourself a little voicemail?',
  'what went unsaid today?',
  "i'm here if you need to talk.",
];
