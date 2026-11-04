'use client';

/**
 * Back and the page title, drawn at the top of a form's own rail.
 *
 * Full-page forms (patient registration, every create page, the admin create
 * pages) used to spend a full-width strip under the top rail on "‹ Back ·
 * Patients › Register New Patient", with the form starting below it. The
 * user wanted that strip gone: the form's left rail already holds its table
 * of contents and orientation note, so Back and the title sit at the head of
 * that rail instead and the page starts at the top rail.
 *
 * Same resolution as the bar (useRouteBack), so Back goes where it always
 * did: the screen the user came from, else ?returnTo=, else the parent. The
 * page must also opt out of the bar: `useConsoleTrail(id, crumbs, { inline:
 * true })`, or `inlineBack` on its route-context entry.
 */
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import BackLink from './BackLink';
import { useRouteBack } from './RouteContextBar';
import './form-page-head.css';

export default function FormPageHead({ title }: {
  /** Overrides the last crumb as the heading (defaults to it). */
  title?: string;
}) {
  const { t } = useTranslation();
  const { showBack, backHref, crumbs } = useRouteBack();
  const heading = title ?? crumbs[crumbs.length - 1]?.label;
  /* The parent is what Back already names, so a two-level page shows no crumb
     line; deeper record trails (Organizations › Republic of South Sudan ›
     Juba Teaching Hospital › New user) keep the levels above as links. */
  const parents = crumbs.slice(0, -1);

  return (
    <div className="form-page-head">
      {showBack && (
        <BackLink className="form-page-head__back" fallbackHref={backHref} ariaLabel={t('routeContext.back')}>
          <ChevronLeft aria-hidden="true" />
          <span>{t('routeContext.back')}</span>
        </BackLink>
      )}
      {parents.length > 1 && (
        <nav className="form-page-head__crumbs" aria-label={t('breadcrumb.label')}>
          {parents.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="form-page-head__crumb">
              {index > 0 && <ChevronRight aria-hidden="true" />}
              {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
            </span>
          ))}
        </nav>
      )}
      {heading && <h1 className="form-page-head__title">{heading}</h1>}
    </div>
  );
}
