'use client';
import Modal from '@/components/Modal';
import { X } from '@/components/icons/lucide';
import { toIsoDate } from '@/lib/date-utils';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { stopsClickPropagation } from '@/lib/a11y';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { Dispatch, SetStateAction } from 'react';
export default function PatientDeceasedModal({ deceasedSubmitting, setShowDeceasedModal, patient, deceasedDateInput, setDeceasedDateInput, handleToggleDeceased }: {
  deceasedSubmitting: boolean;
  setShowDeceasedModal: Dispatch<SetStateAction<boolean>>;
  patient: PatientDoc;
  deceasedDateInput: string;
  setDeceasedDateInput: Dispatch<SetStateAction<string>>;
  handleToggleDeceased: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
        <Modal className="tamam-dialog" onClose={() => !deceasedSubmitting && setShowDeceasedModal(false)} width={440}>
          <div className="modal-content card-elevated p-5 w-full" {...stopsClickPropagation}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">
                {patient.isDeceased ? 'Mark patient alive?' : 'Mark patient deceased?'}
              </h3>
              <button onClick={() => !deceasedSubmitting && setShowDeceasedModal(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            {patient.isDeceased ? (
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                This clears the deceased status recorded on {patientFullName(patient)}&apos;s chart
                {patient.deceasedDate ? ` (date of death ${patient.deceasedDate})` : ''} and
                reactivates the record. Use it to correct a record marked in error.
              </p>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
                  This marks {patientFullName(patient)}&apos;s chart deceased and deactivates the
                  record. To complete the civil record, register the death in the Deaths module.
                </p>
                <label htmlFor="deceased-date" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ptDetail.dateOfDeath')}</label>
                <input
                  id="deceased-date"
                  type="date"
                  max={toIsoDate(new Date())}
                  value={deceasedDateInput}
                  onChange={e => setDeceasedDateInput(e.target.value)}
                />
              </>
            )}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setShowDeceasedModal(false)} className="btn btn-sm btn-secondary" disabled={deceasedSubmitting}>Cancel</button>
              <button
                onClick={handleToggleDeceased}
                className="btn btn-sm btn-primary"
                style={patient.isDeceased ? undefined : { background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                disabled={deceasedSubmitting || (!patient.isDeceased && !deceasedDateInput)}
              >
                {deceasedSubmitting ? 'Saving…' : patient.isDeceased ? 'Mark patient alive' : 'Mark patient deceased'}
              </button>
            </div>
          </div>
        </Modal>
  );
}
