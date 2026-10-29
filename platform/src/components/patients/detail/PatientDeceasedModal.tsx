'use client';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import FormField from '@/components/overlay/FormField';
import { toIsoDate } from '@/lib/date-utils';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useId, type Dispatch, type SetStateAction } from 'react';
export default function PatientDeceasedModal({ deceasedSubmitting, setShowDeceasedModal, patient, deceasedDateInput, setDeceasedDateInput, handleToggleDeceased }: {
  deceasedSubmitting: boolean;
  setShowDeceasedModal: Dispatch<SetStateAction<boolean>>;
  patient: PatientDoc;
  deceasedDateInput: string;
  setDeceasedDateInput: Dispatch<SetStateAction<string>>;
  handleToggleDeceased: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const descId = useId();
  const close = () => { if (!deceasedSubmitting) setShowDeceasedModal(false); };
  return (
    <Modal className="tamam-dialog" onClose={close} size="sm" labelledBy={titleId} describedBy={descId}>
      <DialogFrame busy={deceasedSubmitting}>
        <DialogHeader
          titleId={titleId}
          title={patient.isDeceased ? 'Mark patient alive?' : 'Mark patient deceased?'}
          descriptionId={descId}
          description={patient.isDeceased ? (
            <>
              This clears the deceased status recorded on {patientFullName(patient)}&apos;s chart
              {patient.deceasedDate ? ` (date of death ${patient.deceasedDate})` : ''} and
              reactivates the record. Use it to correct a record marked in error.
            </>
          ) : (
            <>
              This marks {patientFullName(patient)}&apos;s chart deceased and deactivates the
              record. To complete the civil record, register the death in the Deaths module.
            </>
          )}
          tone={patient.isDeceased ? 'plain' : 'danger'}
          onClose={close}
        />
        {!patient.isDeceased && (
          <DialogBody tight>
            <FormField label={t('ptDetail.dateOfDeath')} id="deceased-date" required>
              {control => (
                <input {...control} type="date" max={toIsoDate(new Date())} value={deceasedDateInput} onChange={e => setDeceasedDateInput(e.target.value)} />
              )}
            </FormField>
          </DialogBody>
        )}
        <DialogFooter>
          <button type="button" onClick={close} className="btn btn-secondary" disabled={deceasedSubmitting}>Cancel</button>
          <button
            type="button"
            onClick={handleToggleDeceased}
            className={patient.isDeceased ? 'btn btn-primary' : 'btn btn-danger-solid'}
            disabled={deceasedSubmitting || (!patient.isDeceased && !deceasedDateInput)}
          >
            {deceasedSubmitting ? 'Saving…' : patient.isDeceased ? 'Mark patient alive' : 'Mark patient deceased'}
          </button>
        </DialogFooter>
      </DialogFrame>
    </Modal>
  );
}
