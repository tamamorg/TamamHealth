'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/context';

/**
 * Shared greeting header for dashboards that don't use the full EhrCareDashboard
 * shell (stats/form pages like data-entry, government, facility-management).
 * Renders ONLY the "Welcome, {name}" greeting — matching the Clinical Officer
 * header exactly, with no extra title/eyebrow text. Actions sit at the right.
 */
export default function DashboardGreetingHeader({
  actions,
  subtitle,
}: {
  actions?: ReactNode;
  /** Optional eyebrow line under the greeting (e.g. the super-admin "Command Center · …"). */
  subtitle?: ReactNode;
}) {
  const { currentUser } = useAuth();

  return (
    <div className="dashboard-greeting-header">
      <div className="dashboard-greeting-copy">
        <p className="ehr-care-greeting">Welcome, {currentUser?.name || 'there'}</p>
        {subtitle && <p className="ehr-care-header-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="dashboard-greeting-actions">{actions}</div>}
    </div>
  );
}
