'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { getDefaultDashboard } from '@/lib/role-routes';
import { resolveRouteContext, routeContextBackHref } from '@/lib/navigation/route-context';
import { useConsoleTrailValue } from './ConsoleTrail';
import BackLink from './BackLink';

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
  const context = resolveRouteContext(pathname, homeHref, searchParams.get('returnTo'));
  /* A record page (organization → facility → person) publishes a trail that
     names the records themselves. It wins over the URL-derived context, which
     cannot know that `/admin/facilities/abc123` sits under Juba Teaching
     Group — the level above is not in the URL. */
  const trail = useConsoleTrailValue();
  const shown = !!(trail?.length || context);

  /* Publish the bar's height as --app-route-bar-h. Whatever docks below the
     bar — the chart's workspace drawer, every <Modal variant="slider"> —
     subtracts it from the space it fills; without it they sized themselves to
     the top rail alone and ran past the bottom of the window. Measured, since
     the bar changes height across breakpoints and tucks partly under the rail. */
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (!shown || !el) return;
    const publish = () => {
      // Only the part showing below the top rail counts: the bar's top edge
      // tucks under the rail.
      const bar = el.getBoundingClientRect();
      const railBottom = document.querySelector('.ehr-top-rail')?.getBoundingClientRect().bottom ?? 0;
      const visible = Math.max(0, Math.round(bar.bottom - Math.max(bar.top, railBottom)));
      root.style.setProperty('--app-route-bar-h', `${visible}px`);
    };
    publish();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--app-route-bar-h');
    };
  }, [shown]);

  if (!shown) return null;

  /* Back follows the trail's own parent when there is one: on a record page
     that is the level above, which is a truer "back" than the route group's
     root. `?returnTo=` still overrides both — it carries where the operator
     actually came from. */
  const trailParent = trail?.length ? [...trail].reverse().find(crumb => crumb.href)?.href : undefined;
  const fallbackContext = context ?? {
    crumbs: [],
    fallbackHref: trailParent ?? homeHref,
    showBack: true,
  };
  const backHref = routeContextBackHref(
    trail?.length ? { ...fallbackContext, fallbackHref: trailParent ?? fallbackContext.fallbackHref } : fallbackContext,
    searchParams.get('returnTo'),
    pathname,
  );
  const showBack = trail?.length ? true : fallbackContext.showBack;

  return (
    <div className="route-context-bar" ref={barRef}>
      {showBack && (
        <>
          {/* Back is the screen the user came from (history); `backHref`
              — ?returnTo=, the trail's parent, or the route's parent — is
              only where it goes when there is no in-app page behind this one. */}
          <BackLink className="route-context-back" fallbackHref={backHref} ariaLabel={t('routeContext.back')}>
            <ChevronLeft aria-hidden="true" />
            <span>{t('routeContext.back')}</span>
          </BackLink>
          <span className="route-context-divider" aria-hidden="true" />
        </>
      )}

      <nav className="route-context-crumbs" aria-label={t('breadcrumb.label')}>
        {trail?.length
          ? trail.map((crumb, index) => (
            <span className="route-context-crumb" key={`${crumb.label}-${index}`}>
              {index > 0 && <ChevronRight className="route-context-chevron" aria-hidden="true" />}
              {crumb.href ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span aria-current="page">{crumb.label}</span>
              )}
            </span>
          ))
          : fallbackContext.crumbs.map((crumb, index) => (
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
