'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import {
  Building2, RefreshCw, Settings as SettingsIcon,
} from '@/components/icons/lucide';
import { FacilitySettingsView } from '@/components/settings/FacilitySettingsView';
import FacilitySyncPanel from '@/components/settings/FacilitySyncPanel';


export default function SettingsPage() {
  const { currentUser } = useApp();
  const { canManageUsers, canAccess } = usePermissions();
  const router = useRouter();
  // Personal settings live at /settings — this page is management only.
  useEffect(() => {
    if (currentUser && !canManageUsers && !canAccess('/facility-settings')) router.replace('/settings');
  }, [currentUser, canManageUsers, canAccess, router]);

  // User Management and Hospital Management are gone — see the note where the
  // tab bodies used to be. What is left is genuinely this page's own: the
  // facility's configuration and its DHIS2 sync.
  type SettingsTab = 'facility' | 'sync';
  const [activeTab, setActiveTab] = useState<SettingsTab>('facility');
  const visibleTabs = useMemo<Array<{ key: SettingsTab; label: string; icon: typeof Building2 }>>(() => [
    ...(canAccess('/facility-settings') ? [
      { key: 'facility' as const, label: 'Facility Settings', icon: Building2 },
    ] : []),
    { key: 'sync' as const, label: 'Facility Sync', icon: RefreshCw },
  ], [canAccess]);

  useEffect(() => {
    if (!visibleTabs.some(tab => tab.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || 'sync');
    }
  }, [activeTab, visibleTabs]);

  // Personal preferences (profile, password, screen-lock PIN, connectivity
  // toggle, notification settings) moved to /settings some time ago; their
  // state and handlers stayed behind here, unreferenced, and are removed
  // with the management tabs above. /settings owns all of it.

  // The user- and hospital-management state and handlers that lived here
  // went with their tabs on 2026-08-21: search, role/facility filters, the
  // user form, the reset-password dialog, the row-action menu, and the
  // twenty-five-field hospital form. Accounts are administered on
  // /admin/users and /org-admin/users; facilities on the facility console. Both now
  // share one dialog and one set of tenancy rules.

  if (!currentUser) return null;

  return (
    <>
      <main className="page-container page-enter settings-manage-shell">
        <section className="ehr-set-section">
          <div className="ehr-set-section-head">
            <span><SettingsIcon /></span>
            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
              <h3>Facility configuration</h3>
              <small>This facility&rsquo;s setup and its DHIS2 sync</small>
            </div>
          </div>
        </section>

        {/* Tab bar */}
        <div className="settings-tab-strip">
          {[
            ...visibleTabs,
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={activeTab === tab.key ? 'active' : undefined}
              data-tour={`settings-tab-${tab.key}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══════════════ FACILITY SETTINGS TAB ═══════════════ */}
        {activeTab === 'facility' && <FacilitySettingsView embedded />}

        {/* The User Management and Hospital Management tabs were removed on
            2026-08-21. Both were duplicate CRUD surfaces for records the
            platform already manages elsewhere, and both had drifted:

              • the user form could not set an organization at all (its hook's
                type had no `orgId`), so creating an org_admin here always 400'd,
                and it hardcoded `getAvailableRoles('public')` — offering
                public-sector roles to private-sector organizations;
              • the hospital form offered three of the five facility types, so a
                PHCC or PHCU could never be registered from Settings, and it
                stamped `currentUser.orgId`, which a platform operator does not
                have — every super_admin attempt threw.

            Accounts live on /admin/users and /org-admin/users; facilities live
            on the facility console. Both now share one dialog and one set of rules. */}

        {/* ═══════════════ FACILITY SYNC TAB ═══════════════ */}
        {/* The panel itself is shared: Settings → Integrations & sync renders
            the same runner, so the only surface that can push to DHIS2 is no
            longer one a footer link is the only way into. */}
        {activeTab === 'sync' && <FacilitySyncPanel />}
      </main>

    </>
  );
}
