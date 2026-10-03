'use client';

/**
 * Left rail: what is on the requisition right now — tests, the reason for
 * them, and the comment — visible from every step so the clinician never has
 * to walk back a step to check what they already added. Tests lead: the order
 * is for the tests, and the reason is said about them.
 */

import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabOrderDraft } from './lab-order-types';

export default function LabOrderSidebar({ draft }: { draft: LabOrderDraft }) {
  const { t } = useTranslation();

  return (
    <aside className="labord-rail">
      <div className="labord-rail-group">
        <h4>{draft.kind === 'imaging' ? t('labOrder.studies') : t('labOrder.tests')}</h4>
        {draft.tests.length === 0 && <p className="labord-rail-empty">{t('labOrder.noneYet')}</p>}
        {draft.tests.map(test => (
          <div key={test.name} className="labord-rail-item"><span>{test.name}</span></div>
        ))}
      </div>

      <div className="labord-rail-group">
        <h4>{t('labOrder.reasons')}</h4>
        {draft.indications.length === 0 && <p className="labord-rail-empty">{t('labOrder.noneYet')}</p>}
        {draft.indications.map(indication => (
          <div key={indication.code} className="labord-rail-item">
            <span><strong>{indication.code}</strong> — {indication.title}</span>
          </div>
        ))}
      </div>

      <div className="labord-rail-group">
        <h4>{t('labOrder.comments')}</h4>
        {draft.comments.trim()
          ? <p className="labord-rail-empty" style={{ color: 'var(--text-primary)' }}>{draft.comments}</p>
          : <p className="labord-rail-empty">{t('labOrder.noneYet')}</p>}
      </div>
    </aside>
  );
}
