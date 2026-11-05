'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { getDefaultDashboard } from '@/lib/role-routes';
import { resolveRouteContext, routeContextBackHref } from '@/lib/navigation/route-context';
import { useConsoleTrailInline, useConsoleTrailValue } from './ConsoleTrail';
import BackLink from './BackLink';
import ModuleHubMenu, { useModuleHubTabs } from './ModuleHubTabs';

/**
 * Back for a page that draws it inside its own layout (`inlineBack`): where it
 * goes when there is no in-app page behind this one, and the label of that
 * place. Same resolution as the bar, so the chart's Back behaves as the bar's.
 */
export function useInlineRouteBack(): { href: string; labelKey: string } | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentUser } = useAuth();
  const homeHref = currentUser ? getDefaultDashboard(currentUser.role) : '/dashboard';
  const returnTo = searchParams.get('returnTo');
  const context = resolveRouteContext(pathname, homeHref, returnTo);
  if (!context?.inlineBack) return null;
  return {
    href: routeContextBackHref(context, returnTo, pathname),
    labelKey: context.crumbs[0]?.labelKey ?? 'routeContext.back',
  };
}

/** One crumb, already in the reader's language. */
export interface ResolvedCrumb { label: string; href?: string }

/**
 * Where Back goes and the crumbs to show, for the bar and for a page that
 * draws them itself (FormPageHead). One resolution, so the two can never send
 * Back to different places.
 *
 * A record page (organization → facility → person) publishes a trail that
 * names the records themselves; it wins over the URL-derived context, which
 * cannot know that `/admin/facilities/abc123` sits under Juba Teaching Group.
 * Back follows the trail's own parent when there is one, and `?returnTo=`
 * overrides both: it carries where the operator actually came from.
 */
export function useRouteBack(): {
  /** The bar would be drawn here (a curated route, or a published trail). */
  hasContext: boolean;
  /** The page draws Back and its title itself, so the bar stays away. */
  inline: boolean;
  showBack: boolean;
  backHref: string;
  crumbs: ResolvedCrumb[];
} {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  // Groups whose URL prefix has no page of its own (/org-admin, since the Org
  // Overview dashboard moved into /facility-management) send Back here, and the
  // roles that share such a prefix do not share a dashboard — so it has to be
  // resolved per role, not hard-coded in the route table.
  const homeHref = currentUser ? getDefaultDashboard(currentUser.role) : '/dashboard';
  const returnTo = searchParams.get('returnTo');
  const context = resolveRouteContext(pathname, homeHref, returnTo);
  const trail = useConsoleTrailValue();
  const trailInline = useConsoleTrailInline();

  const trailParent = trail?.length ? [...trail].reverse().find(crumb => crumb.href)?.href : undefined;
  const fallbackContext = context ?? {
    crumbs: [],
    fallbackHref: trailParent ?? homeHref,
    showBack: true,
  };
  const backHref = routeContextBackHref(
    trail?.length ? { ...fallbackContext, fallbackHref: trailParent ?? fallbackContext.fallbackHref } : fallbackContext,
    returnTo,
    pathname,
  );

  return {
    hasContext: !!(trail?.length || context),
    inline: trail?.length ? trailInline : !!context?.inlineBack,
    showBack: trail?.length ? true : fallbackContext.showBack,
    backHref,
    crumbs: trail?.length
      ? trail
      : fallbackContext.crumbs.map(crumb => ({ label: t(crumb.labelKey), href: crumb.href })),
  };
}

export default function RouteContextBar() {
  const { t } = useTranslation();
  const { hasContext, inline, showBack, backHref, crumbs } = useRouteBack();
  // A page that carries Back in its own layout (the patient chart, every
  // create form via FormPageHead) gets no bar: no strip above the page. A
  // management hub's page gets the bar even without a curated route: it
  // carries the hub's dropdown (ModuleHubMenu) after the hub's name.
  const hub = useModuleHubTabs();
  const shown = (hasContext || !!hub) && !inline;

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
        {hub && (
          <span className="route-context-crumb">
            <span>{hub.hub.label}</span>
            <ChevronRight className="route-context-chevron" aria-hidden="true" />
            <ModuleHubMenu {...hub} />
          </span>
        )}
        {!hub && crumbs.map((crumb, index) => (
          <span className="route-context-crumb" key={`${crumb.label}-${index}`}>
            {index > 0 && <ChevronRight className="route-context-chevron" aria-hidden="true" />}
            {crumb.href ? (
              <Link href={crumb.href}>{crumb.label}</Link>
            ) : (
              <span aria-current="page">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
    </div>
  );
}
