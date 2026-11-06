'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';

/**
 * Minimal public chrome for the pay-by-link checkout flow. A payer opens this
 * without a staff session, so we deliberately avoid the dashboard layout and
 * show only a slim branded header (mirroring the patient-portal layout).
 */
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--bg-card-solid)',
        borderBottom: '1px solid var(--border-medium)',
        padding: '0 20px', height: 52, display: 'flex', alignItems: 'center',
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/tamamhealth-logo.svg" alt={t('app.name')} style={{ width: 28, height: 28 }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>{t('app.name')}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent-primary)', padding: '3px 8px', borderRadius: 0, background: 'var(--accent-light)' }}>{t('ui.securePayment')}</span>
        </Link>
      </header>
      <main style={{ width: '100%' }}>{children}</main>
    </div>
  );
}
