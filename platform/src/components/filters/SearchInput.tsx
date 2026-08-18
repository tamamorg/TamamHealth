'use client';

import { Search, X } from '@/components/icons/lucide';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Lets the field grow to fill the filter row. Defaults to true. */
  grow?: boolean;
  className?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
}

/**
 * Consistent search field used across every list page: leading search icon,
 * a clear (✕) affordance that appears once there is a query, and the shared
 * focus ring. Replaces the ad-hoc `relative` + absolute-icon snippets that
 * were copy-pasted onto each page.
 */
export default function SearchInput({
  value,
  onChange,
  placeholder,
  grow = true,
  className = '',
  autoFocus,
  'aria-label': ariaLabel,
}: SearchInputProps) {
  return (
    <div
      className={`relative ${grow ? 'flex-1 min-w-[180px]' : ''} ${className}`}
    >
      <Search
        size={15}
        className="absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: 'var(--text-muted)' }}
      />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="search-icon-input"
        style={{ background: 'var(--overlay-subtle)', paddingInlineEnd: value ? 34 : undefined }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute end-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full transition-colors"
          style={{ width: 20, height: 20, color: 'var(--text-muted)', background: 'var(--border-light)' }}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
