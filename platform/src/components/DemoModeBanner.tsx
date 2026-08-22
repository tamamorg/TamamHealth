'use client';

/**
 * DemoModeBanner — inline notice shown above any screen that's rendering
 * sample/demo data instead of real records. Mounted by the page itself
 * (radiology, nutrition, payments portal, etc.) only when it decides to
 * fall back to bundled SAMPLE_* arrays.
 *
 * Visibility is the caller's responsibility — render this component only
 * when `NEXT_PUBLIC_DEMO_MODE === 'true'` AND the page is actually about
 * to display demo data. We do NOT inspect the env var here so the banner
 * is reusable for any future demo-data surface.
 *
 * Visual style matches ConnectivityNotice: warning amber palette via
 * --color-warning, --card-radius, and a duotone alert icon.
 */

import { AlertTriangle } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

export interface DemoModeBannerProps {
  /** Compact spacing for placement directly above KPI strips. */
  dense?: boolean;
}

export default function DemoModeBanner({ dense = false }: DemoModeBannerProps) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2"
      style={{
        padding: dense ? '6px 12px' : '10px 14px',
        marginBottom: dense ? 8 : 12,
        borderRadius: 'var(--card-radius)',
        background: 'rgba(254, 230, 151, 0.10)',
        border: '1px solid rgba(254, 230, 151, 0.30)',
        color: 'var(--color-warning-text)',
        fontSize: dense ? 11.5 : 12.5,
        fontWeight: 600,
      }}
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span>
        {t('common.demoModeBanner')}
      </span>
    </div>
  );
}
