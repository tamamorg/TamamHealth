'use client';

import type { ComponentType, CSSProperties } from 'react';

export interface FilterTabItem {
  /** Stable filter value */
  key: string;
  /** Visible label */
  label: string;
  /** Count rendered as a badge after the label. Omit to hide the badge. */
  count?: number;
  /** Optional leading icon */
  icon?: ComponentType<{ size?: number; style?: CSSProperties }>;
  /** Optional accent colour for the badge/active state (defaults to the primary accent) */
  tint?: string;
}

interface FilterTabsProps {
  tabs: FilterTabItem[];
  active: string;
  onChange: (key: string) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  className?: string;
}

/**
 * Segmented filter control with an inline count badge per tab.
 *
 * Replaces the standalone KPI/stat-card strips on list pages — the numbers that
 * used to live in summary cards are surfaced here, next to the filter they describe.
 */
export default function FilterTabs({
  tabs,
  active,
  onChange,
  size = 'md',
  ariaLabel,
  className = '',
}: FilterTabsProps) {
  const pad = size === 'sm' ? 'px-3 py-1' : 'px-3.5 py-1.5';
  const text = size === 'sm' ? 'text-[11px]' : 'text-xs';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex flex-wrap items-center gap-1 p-0.5 rounded-lg ${className}`}
      style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}
    >
      {tabs.map(tab => {
        const isActive = tab.key === active;
        const accent = tab.tint ?? 'var(--accent-primary)';
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`${pad} ${text} font-semibold rounded-md transition-all flex items-center gap-1.5 whitespace-nowrap ${
              isActive ? '' : 'hover:bg-[var(--overlay-light)] hover:text-[var(--text-secondary)]'
            }`}
            style={{
              background: isActive ? accent : 'transparent',
              color: isActive ? '#FFFFFF' : 'var(--text-muted)',
              boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.14)' : 'none',
            }}
          >
            {Icon ? <Icon size={size === 'sm' ? 12 : 14} style={{ color: 'inherit', stroke: 'currentColor', flexShrink: 0 }} /> : null}
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none tabular-nums"
                style={{
                  background: isActive ? 'rgba(255,255,255,0.22)' : 'var(--border-light)',
                  color: isActive ? '#FFFFFF' : 'var(--text-secondary)',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
