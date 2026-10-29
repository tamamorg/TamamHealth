'use client';

/**
 * Patient history popup — opened from a note's history sections.
 *
 * It is the chart's own History tab, shown over the note: the same four lists,
 * the same form, the same writes to the chart. A clinician who corrects the
 * history while writing a note is correcting the patient's record, not the
 * note's copy of it, so the next note reads the correction too. The editor
 * re-reads the chart into the note's history sections when this closes.
 */

import FormSlider from '@/components/overlay/FormSlider';
import HistorySection from '@/components/ehr/chart/sections/HistorySection';
import { useTranslation } from '@/lib/i18n/useTranslation';
// The History tab is built from the chart's section and table styles, which
// load with the chart shell — and the note editor also runs on its own route.
import '@/components/ehr/chart/tamam-chart.css';
import './clinical-notes.css';

interface HistoryModalProps {
  patientId: string;
  patientName: string;
  /** Stamped on entries added here, so the chart can say which note they came from. */
  noteId?: string;
  onClose: () => void;
}

export default function HistoryModal({ patientId, patientName, noteId, onClose }: HistoryModalProps) {
  const { t } = useTranslation();
  return (
    <FormSlider
      title={t('history.modalTitle')}
      width={880}
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* `tamam-root` scopes the chart's table rules; the embedded modifier
            drops the full-page shell layout that class also carries. */}
        <div className="tamam-root tamam-root--embedded cn-history-body">
          <HistorySection patientId={patientId} patientName={patientName} sourceNoteId={noteId} />
        </div>
      </div>
    </FormSlider>
  );
}
