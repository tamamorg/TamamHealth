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
    <div className="pp-card" style={{ textAlign: 'center', padding: 40 }}>
      <Icon size={44} style={{ color: '#94A2B3', opacity: 0.5, margin: '0 auto 10px' }} />
      <p style={{ margin: 0, fontSize: 13, color: '#5D728B' }}>{text}</p>
      {action && onAction && (
        <button type="button" onClick={onAction} className="pp-btn pp-btn-primary" style={{ marginTop: 14 }}>
          <Plus size={14} /> {action}
        </button>
      )}
    </div>
  );
}
