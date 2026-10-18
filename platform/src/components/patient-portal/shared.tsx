'use client';

import { Plus, User } from '@/components/icons/lucide';

/* ─── Helpers ─── */

// Chip tones from the design's CHIP map — see .pp-chip--* in globals.css.
export type ChipTone = 'green' | 'yellow' | 'red' | 'blue' | 'neutral';

// Short month names for the design's date plates ("27 / AUG") and vitals
// sublines ("13 Aug · Post-natal check"). Chrome-level formatting, English
// like the rest of the portal chrome.
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateParts(iso: string): { day: string; mon: string } {
  const [, m, d] = (iso || '').split('-');
  return { day: d || '—', mon: MONTHS[Number(m) - 1] || '' };
}
export function shortDate(iso: string): string {
  const { day, mon } = dateParts(iso);
  return mon ? `${Number(day)} ${mon}` : iso;
}

export function Empty({ icon: Icon, text, action, onAction }: { icon: typeof User; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pp-card pp-empty">
      <span className="pp-ic pp-ic--lg" aria-hidden><Icon size={20} strokeWidth={1.6} /></span>
      <p>{text}</p>
      {action && onAction && (
        <button type="button" onClick={onAction} className="pp-btn pp-btn-primary">
          <Plus size={14} /> {action}
        </button>
      )}
    </div>
  );
}

export type CardTone = 'blue' | 'green' | 'amber' | 'rose' | 'iris';

/** Card header with a toned icon tile, so every section reads at a glance. */
export function CardHead({ icon: Icon, title, tone = 'blue', right }: { icon: typeof User; title: string; tone?: CardTone; right?: React.ReactNode }) {
  return (
    <div className="pp-card-head">
      <h2>
        <span className={`pp-ic pp-ic--${tone}`} aria-hidden><Icon size={14} strokeWidth={1.8} /></span>
        {title}
      </h2>
      {right}
    </div>
  );
}
