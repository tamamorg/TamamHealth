'use client';

/**
 * Create Organization, full-page — the same shared OrganizationForm the
 * registry's modal hosts, wearing the register-patient page anatomy
 * (/patients/new): a back toolbar, then a sticky left rail carrying the title
 * and the section jump links, with the form in a card beside it. Reached from
 * the modal header's expand button; back and cancel both return to the
 * registry.
 *
 * Create only — editing stays in the registry's modal, next to the row being
 * edited, so there is no /admin/organizations/[id]/edit page to drift from it.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useConsoleTrail } from '@/components/navigation/ConsoleTrail';
import FormPageHead from '@/components/navigation/FormPageHead';
import { SadbPage } from '@/components/admin/sadb-ui';
import { OrganizationForm, ORG_FORM_SECTIONS } from '@/components/admin/OrganizationForm';
import type { OrgAdminHandoff } from '@/components/admin/OrganizationForm';
import { CredentialHandoffModal } from '@/modules/identity/client';

export default function AdminOrganizationCreatePage() {
  const { t } = useTranslation();
  const router = useRouter();

  // Same host duty as the registry page: the form unmount-races its own
  // success, so the one-time credential panel lives with the host. Here the
  // page stays mounted under the panel and navigates back only when the
  // operator closes it — the credentials show exactly once either way.
  const [handoff, setHandoff] = useState<OrgAdminHandoff | null>(null);

  const backToRegistry = () => router.push('/admin/organizations');

  // Title and Back are in the bar at the top (RouteContextBar).
  useConsoleTrail('admin-org-new', [{ label: t('breadcrumb.organizations'), href: '/admin/organizations' }, { label: t('orgAdmin.createOrganization') }], { inline: true });

  return (
    <SadbPage>
      <div className="sadb-regpage-shell">

        <div className="sadb-regpage">
          {/* Left rail: title + the form's table of contents, generated from
              the same ORG_FORM_SECTIONS list the form renders its anchors
              from, so the rail and the sections can never drift apart. */}
          <aside className="sadb-regpage-rail" aria-label={t('orgAdmin.jumpToSection')}>
            <FormPageHead />
            <p className="sadb-regpage-note">{t('orgAdmin.createPageNote')}</p>
            <p className="sadb-regpage-jump">{t('orgAdmin.jumpToSection')}</p>
            <nav className="sadb-regpage-nav">
              {ORG_FORM_SECTIONS.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className="sadb-regpage-navitem"
                  onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  {t(s.labelKey)}
                </button>
              ))}
            </nav>
          </aside>

          <div className="sadb-card sadb-regpage-form">
            <OrganizationForm
              onCancel={backToRegistry}
              onSaved={({ handoff: h }) => { if (h) setHandoff(h); else backToRegistry(); }}
            />
          </div>
        </div>
      </div>

      {handoff && (
        <CredentialHandoffModal
          title={t('orgAdmin.handoffTitle')}
          description={t('orgAdmin.handoffDescription')}
          username={handoff.username}
          password={handoff.password}
          invitation={handoff.invitation}
          onClose={() => { setHandoff(null); backToRegistry(); }}
        />
      )}
    </SadbPage>
  );
}
