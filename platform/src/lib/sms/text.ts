/**
 * Pure helpers for composing text-message bodies. No provider, no env — safe
 * to import from the browser (import this file, not `@/lib/sms`, which loads
 * the gateway providers).
 *
 * A text is billed and split per segment, and one character outside the GSM-7
 * alphabet silently switches the whole message to UCS-2, cutting a segment
 * from 160 characters to 70. Clinical text is full of such characters (the
 * em dash, the middle dot, curly quotes), so anything the platform composes is
 * passed through `toSmsSafe` first and the segment count is shown to the
 * sender before they send.
 */

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** GSM-7 extension table: valid, but each costs two septets. */
const GSM7_EXTENDED = '^{}\\[~]|€';

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[–—−]/g, '-'],
  [/…/g, '...'],
  [/[·•‣◦]/g, '-'],
  [/×/g, 'x'],
  [/↔/g, '<->'],
  [/→/g, '->'],
  [/≤/g, '<='],
  [/≥/g, '>='],
  [/[   ]/g, ' '],
  [/\t/g, ' '],
];

/** Swap typographic characters for their GSM-7 equivalents and tidy spacing. */
export function toSmsSafe(text: string): string {
  let out = text || '';
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  return out
    .split('\n')
    .map(line => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface SmsSegmentInfo {
  encoding: 'gsm7' | 'ucs2';
  /** Length in the units the encoding bills by (septets or UTF-16 units). */
  length: number;
  segments: number;
  /** Units one more segment would add room for. */
  perSegment: number;
}

/** How a body will be split by the carrier. Empty text is zero segments. */
export function smsSegments(text: string): SmsSegmentInfo {
  const body = text || '';
  let septets = 0;
  let gsm = true;
  for (const ch of body) {
    if (GSM7_BASIC.includes(ch)) septets += 1;
    else if (GSM7_EXTENDED.includes(ch)) septets += 2;
    else { gsm = false; break; }
  }
  if (gsm) {
    const single = septets <= 160;
    return {
      encoding: 'gsm7',
      length: septets,
      segments: septets === 0 ? 0 : single ? 1 : Math.ceil(septets / 153),
      perSegment: single ? 160 : 153,
    };
  }
  const units = body.length;
  const single = units <= 70;
  return {
    encoding: 'ucs2',
    length: units,
    segments: units === 0 ? 0 : single ? 1 : Math.ceil(units / 67),
    perSegment: single ? 70 : 67,
  };
}

/** Hard ceiling on a platform-composed text: ten concatenated GSM-7 segments. */
export const MAX_PATIENT_TEXT_LENGTH = 1530;

/**
 * Show a phone number without publishing it: "+211 9•• ••• 145". Used
 * wherever a record notes *that* a text went to the patient's number.
 */
export function maskPhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 5) return phone ? '•••' : '';
  return `${phone.trim().startsWith('+') ? '+' : ''}${digits.slice(0, 3)}•••••${digits.slice(-3)}`;
}

/**
 * Normalise a raw phone number to E.164.
 *
 * Defaults assume South Sudan (+211) since that is the platform's primary
 * deployment. Numbers that already have a country code (start with `+` or
 * `211`) are kept as-is; a leading `0` is treated as the SS trunk prefix
 * and rewritten. Everything else is prefixed with `+` and digits only.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('211')) return '+' + digits;
  if (digits.startsWith('0')) return '+211' + digits.slice(1);
  if (raw.startsWith('+')) return raw;
  return '+' + digits;
}
