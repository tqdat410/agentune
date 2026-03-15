export const MOOD_VALUES = ['focus', 'energetic', 'chill', 'debug', 'ship'] as const;
export type Mood = (typeof MOOD_VALUES)[number];

const MOOD_PRESETS: Record<Mood, string[]> = {
  focus: [
    'lofi hip hop beats to study to',
    'ambient focus music instrumental',
    'deep concentration music',
    'coding music playlist instrumental',
    'lo-fi chill beats for programming',
  ],
  energetic: [
    'upbeat electronic music playlist',
    'high energy workout music',
    'pump up songs 2024',
    'edm festival mix',
    'fast-paced coding music',
  ],
  chill: [
    'chill acoustic playlist',
    'relaxing jazz music',
    'soft indie folk playlist',
    'peaceful piano music',
    'calm evening music playlist',
  ],
  debug: [
    'intense dramatic orchestral music',
    'epic battle music',
    'suspenseful thriller soundtrack',
    'hans zimmer type beats',
    'dark intense coding music',
  ],
  ship: [
    'celebration party music',
    'victory anthem playlist',
    'feel good happy songs',
    'we are the champions type songs',
    'triumphant orchestral music',
  ],
};

export function normalizeMood(input: string): Mood | null {
  const normalized = input.trim().toLowerCase();
  return MOOD_VALUES.find((mood) => mood === normalized) ?? null;
}

export function getMoodQueries(mood: Mood): string[] {
  return [...MOOD_PRESETS[mood]];
}

export function getRandomMoodQuery(mood: Mood): string {
  const queries = MOOD_PRESETS[mood];
  const index = Math.floor(Math.random() * queries.length);
  return queries[index];
}
