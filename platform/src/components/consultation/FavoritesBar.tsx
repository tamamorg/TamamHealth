'use client';

/**
 * Favorites quick-pick row for a consultation section (diagnoses, medicines,
 * procedures). Renders the clinician's saved favorites as one-tap chips — the
 * HealthBridge "favorites under every section" pattern — so a frequent item is
 * added without searching. A separate <FavoriteStar> toggles an item in/out of
 * the favorites list.
 */
import { Star } from '@/components/icons/lucide';
import type { ClinicalFavoriteDoc } from '@/lib/db-types';

export function FavoritesBar({
  favorites,
  onPick,
  label = 'Favorites',
}: {
  favorites: ClinicalFavoriteDoc[];
  onPick: (fav: ClinicalFavoriteDoc) => void;
  label?: string;
}) {
  if (favorites.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Star className="w-3.5 h-3.5" style={{ color: 'var(--color-warning, #D97706)' }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {favorites.map(fav => (
          <button
            key={fav._id}
            type="button"
            onClick={() => onPick(fav)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors"
            style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)', border: '1px solid var(--accent-border, var(--border-light))' }}
            title={fav.code}
          >
            {fav.code && <span className="font-mono">{fav.code}</span>}
            <span className="truncate max-w-[180px]">{fav.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A star toggle button used inline next to an added item. */
export function FavoriteStar({
  active,
  onToggle,
  title,
}: {
  active: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={title ?? (active ? 'Remove from favorites' : 'Save to favorites')}
      className="flex-shrink-0 p-1 rounded transition-colors"
      style={{ color: active ? 'var(--color-warning, #D97706)' : 'var(--text-muted)' }}
    >
      <Star className="w-4 h-4" style={active ? { fill: 'var(--color-warning, #D97706)' } : undefined} />
    </button>
  );
}
