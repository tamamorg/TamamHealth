'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { isRouteAllowed, getDefaultDashboard } from '@/lib/permissions';
import { ShieldAlert, ArrowLeft, Loader2 } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSyncExternalStore } from 'react';
import { getDisabledAppRoutes, isAppDisabled, subscribeDisabledApps } from '@/lib/settings/disabled-apps';

export default function RoleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  useSyncExternalStore(subscribeDisabledApps, getDisabledAppRoutes, getDisabledAppRoutes);

  if (!currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  if (!isRouteAllowed(currentUser.role, pathname) || isAppDisabled(pathname)) {
    const defaultDash = getDefaultDashboard(currentUser.role);
    return (
      <div className="flex-1 flex items-center justify-center p-8" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{
            background: 'transparent',
          }}>
            <ShieldAlert className="w-8 h-8" style={{ color: 'var(--color-danger)' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            {t('consultation.accessRestricted')}
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            {t('roleGuard.noAccessMessage', { role: currentUser.role.replace('_', ' ') })}
          </p>
          <button
            onClick={() => router.push(defaultDash)}
            className="btn btn-primary"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('government.backToDashboard')}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
