'use client';

/**
 * The per-patient triage form as a slider over the page it was opened from —
 * the worklist, the calendar, the rooming queue — instead of a trip to
 * `/triage/[patientId]` and back. The form is that page's own TriageWorkflow,
 * pinned to the patient; the chart opens the same form in its workspace.
 *
 * The route still exists for links that arrive from outside the app shell
 * (notifications, handover messages).
 */

import FormSlider from '@/components/overlay/FormSlider';
import TriageWorkflow from '@/components/nurse/TriageWorkflow';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function TriageSlider({ patientId, patientName, onClose }: {
  patientId: string;
  patientName?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <FormSlider title={t('routeContext.triage')} subtitle={patientName} width={720} onClose={onClose}>
      <TriageWorkflow lockedPatientId={patientId} onSaved={onClose} embedded />
    </FormSlider>
  );
}
