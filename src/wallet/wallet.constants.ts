export const REVEAL_HINT_COST = 1;
export const ELIMINATE_HINT_COST = 1;
// Doğrulanamayan çevrimdışı galibiyetlerden günlük kazanılabilecek en fazla altın.
export const OFFLINE_DAILY_GOLD_CAP = 200;

export const winReward = (attempts: number) => Math.max(21 - attempts, 1);

export type StoreType = 'theme' | 'keypad' | 'effect';
export type CatalogItem = { id: string; price: number; type: StoreType; value: string };

export const CATALOG: CatalogItem[] = [
  { id: 'theme-classic', price: 0, type: 'theme', value: 'classic' },
  { id: 'keypad-classic', price: 0, type: 'keypad', value: 'classic' },
  { id: 'effect-confetti', price: 0, type: 'effect', value: 'confetti' },
  { id: 'theme-midnight', price: 30, type: 'theme', value: 'midnight' },
  { id: 'theme-sunset', price: 30, type: 'theme', value: 'sunset' },
  { id: 'keypad-mint', price: 20, type: 'keypad', value: 'mint' },
  { id: 'keypad-violet', price: 20, type: 'keypad', value: 'violet' },
  { id: 'effect-golden', price: 50, type: 'effect', value: 'golden' },
  { id: 'effect-neon', price: 50, type: 'effect', value: 'neon' },
];

export const DEFAULT_OWNED = ['theme-classic', 'keypad-classic', 'effect-confetti'];
export const DEFAULT_EQUIPPED = { theme: 'classic', keypad: 'classic', effect: 'confetti' };
