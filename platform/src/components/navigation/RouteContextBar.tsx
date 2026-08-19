'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { getDefaultDashboard } from '@/lib/role-routes';
import { resolveRouteContext, routeContextBackHref } from '@/lib/navigation/route-context';

export default function RouteContextBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  // Groups whose URL prefix has no page of its own (/org-admin, since the Org
  // Overview dashboard moved into /facility-management) send Back here, and the
  // roles that share such a prefix do not share a dashboard — so it has to be
  // resolved per role, not hard-coded in the route table.
  const homeHref = currentUser ? getDefaultDashboard(currentUser.role) : '/dashboard';
  const context = resolveRouteContext(pathname, homeHref);

  if (!context) return null;

  const backHref = routeContextBackHref(context, searchParams.get('returnTo'), pathname);

  return (
    <div className="route-context-bar">
      {context.showBack && (
        <>
          <Link className="route-context-back" href={backHref} aria-label={t('routeContext.back')}>
            <ChevronLeft aria-hidden="true" />
            <span>{t('routeContext.back')}</span>
          </Link>
          <span className="route-context-divider" aria-hidden="true" />
        </>
      )}

      <nav className="route-context-crumbs" aria-label={t('breadcrumb.label')}>
        {context.crumbs.map((crumb, index) => (
          <span className="route-context-crumb" key={`${crumb.labelKey}-${index}`}>
            {index > 0 && <ChevronRight className="route-context-chevron" aria-hidden="true" />}
            {crumb.href ? (
              <Link href={crumb.href}>{t(crumb.labelKey)}</Link>
            ) : (
              <span aria-current="page">{t(crumb.labelKey)}</span>
            )}
          </span>
        ))}
      </nav>
    </div>
  );
}
