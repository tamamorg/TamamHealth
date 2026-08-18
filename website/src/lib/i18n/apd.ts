import type { Dictionary } from './index';

/**
 * Arabic (Juba) — عربي جوبا.
 *
 * Keys are the English source strings exactly as they appear in `site-data.ts`
 * and in the components' copy; values are the Juba Arabic rendering. Anything
 * absent falls through to English rather than rendering blank, so a half-filled
 * dictionary degrades instead of breaking. `npm run i18n:check` lists what is
 * still missing.
 */
export const apd: Dictionary = {};
