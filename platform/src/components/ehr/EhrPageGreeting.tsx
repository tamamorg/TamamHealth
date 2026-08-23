'use client';

/**
 * The two lines every module page opens with:
 *
 *   Welcome, Gatluak Puok       ← 24px, the largest text on the page
 *   LAB TECHNICIAN · LABORATORY ← who they are signed in as, and where they are
 *
 * The module name used to be the 24px line on its own. It is already printed
 * in the rail, the module menu and the browser tab, so it was the third copy of
 * a word nobody needed three times — while the one thing a shared workstation
 * user genuinely has to check, whose session this is, appeared nowhere. The
 * clinical dashboards already greeted by name; this makes the rest match.
 *
 * Used by EhrListHeader (which covers ~30 module pages) and directly by the
 * few headers that hand-roll their own toolbar.
 */

import { useAuth } from '@/lib/context';
import { getRoleConfig } from '@/lib/permissions';
import { abbreviateProviderName } from '@/lib/patient-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function EhrPageGreeting({
  module: moduleLabel,
  className = '',
}: {
  /** The module half of the eyebrow, after the role. */
  module?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();

  const roleLabel = currentUser ? getRoleConfig(currentUser.role).label : '';
  const eyebrow = [roleLabel, moduleLabel].filter(Boolean).join(' · ');
  const name = abbreviateProviderName(currentUser?.name);

  return (
    <span className={`ehr-list-header-copy ${className}`.trim()}>
      <span className="ehr-list-header-greeting">
        {name ? t('header.welcome', { name }) : t('header.welcomeAnon')}
      </span>
      {eyebrow && <span className="ehr-care-greeting-sub">{eyebrow}</span>}
    </span>
  );
}
