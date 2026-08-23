'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/context';
import { getRoleConfig } from '@/lib/permissions';
import { abbreviateProviderName } from '@/lib/patient-utils';

/**
 * Shared greeting header for dashboards that don't use the full EhrCareDashboard
 * shell (stats/form pages like data-entry, government, facility-management).
 *
 * Two lines, the same two every module header carries (see EhrListHeader):
 *
 *   Welcome, Mary Gai
 *   TRIAGE NURSE · CLINICAL WORKSPACE
 *
 * Actions sit at the right.
 */
export default function DashboardGreetingHeader({
  actions,
  subtitle,
  module: moduleLabel,
}: {
  actions?: ReactNode;
  /** Replaces the whole eyebrow (e.g. the super-admin "Command Center · …"). */
  subtitle?: ReactNode;
  /** The module half of the eyebrow, after the role. */
  module?: string;
}) {
  const { currentUser } = useAuth();

  // The role line, for the headers that pass no eyebrow of their own — the
  // facility, facility-overview and MCH boards printed the greeting alone and
  // named the signed-in user's role nowhere on the page.
  const roleLabel = currentUser ? getRoleConfig(currentUser.role).label : undefined;
  const eyebrow = subtitle || [roleLabel, moduleLabel].filter(Boolean).join(' · ');

  return (
    <div className="dashboard-greeting-header">
      <div className="dashboard-greeting-copy">
        <p className="ehr-care-greeting">
          Welcome, {abbreviateProviderName(currentUser?.name) || 'there'}
        </p>
        {eyebrow && <p className="ehr-care-greeting-sub">{eyebrow}</p>}
      </div>
      {actions && <div className="dashboard-greeting-actions">{actions}</div>}
    </div>
  );
}
