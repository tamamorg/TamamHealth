'use client';

/**
 * Create staff account, full-page — the same anatomy `/admin/organizations/new`
 * uses, which it takes in turn from `/patients/new`: a back toolbar, a sticky
 * left rail carrying the title and section jump links, and the shared form in a
 * card beside it.
 *
 * This replaces a 440px dialog. An account has three groups of decisions —
 * who the person is, what credential they get, and what they can see — and the
 * scope group changes shape as the role changes (a facility picker appears, and
 * can itself need a facility registered first). That is a page's worth of
 * thinking, and it was happening inside a box that could not show all of it at
 * once.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ArrowLeft } from '@/components/icons/lucide';
import { SadbPage } from '@/components/admin/sadb-ui';
import { UserForm, USER_FORM_SECTIONS, type UserCredentialHandoff } from '@/components/admin/UserForm';
import { CredentialHandoffModal } from '@/modules/identity/client';

export default function AdminUserCreatePage() {
  const { t } = useTranslation();
  const router = useRouter();

  // The host owns the hand-off, not the form: the form unmounts as this page
  // navigates away, and a panel that shows a temporary password exactly once
  // must outlive it. The page stays mounted under the panel and returns to the
  // roster only when the operator closes it.
  const [handoff, setHandoff] = useState<UserCredentialHandoff | null>(null);

  const backToRoster = () => router.push('/admin/users');

  return (
    <SadbPage>
      <div className="sadb-regpage-shell">
        <div className="patient-registration-toolbar">
          <button type="button" onClick={backToRoster} className="patient-registration-back">
            <ArrowLeft className="w-4 h-4" /> {t('adminUsers.backToUsers')}
          </button>
        </div>

        <div className="sadb-regpage">
          <aside className="sadb-regpage-rail" aria-label={t('adminUsers.jumpToSection')}>
            <h1 className="sadb-regpage-title">{t('adminUsers.createUser')}</h1>
            <p className="sadb-regpage-note">{t('adminUsers.createPageNote')}</p>
            <p className="sadb-regpage-jump">{t('adminUsers.jumpToSection')}</p>
            <nav className="sadb-regpage-nav">
              {USER_FORM_SECTIONS.map(s => (
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
            <UserForm onCancel={backToRoster} onSaved={({ handoff: h }) => setHandoff(h)} />
          </div>
        </div>
      </div>

      {handoff && (
        <CredentialHandoffModal
          title={t('adminUsers.handoffTitle')}
          description={t('adminUsers.handoffDescription')}
          username={handoff.username}
          password={handoff.password}
          invitation={handoff.invitation}
          onClose={() => { setHandoff(null); backToRoster(); }}
        />
      )}
    </SadbPage>
  );
}
