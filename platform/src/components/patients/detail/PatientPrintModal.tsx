'use client';
import Modal from '@/components/Modal';
import { Printer } from '@/components/icons/lucide';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import FormField from '@/components/overlay/FormField';
import { PrintSectionId, PRINT_SECTION_OPTIONS, DEFAULT_PRINT_SECTIONS } from './chart-constants';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
export default function PatientPrintModal({ setShowPrintModal, setPrintSections, printSections, printSignature, setPrintSignature, setPrintSigned }: {
  setShowPrintModal: Dispatch<SetStateAction<boolean>>;
  setPrintSections: Dispatch<SetStateAction<Set<PrintSectionId>>>;
  printSections: Set<PrintSectionId>;
  printSignature: string;
  setPrintSignature: Dispatch<SetStateAction<string>>;
  setPrintSigned: Dispatch<SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  const close = () => setShowPrintModal(false);
  const canSign = !!printSignature.trim() && printSections.size > 0;
  const sign = () => {
    setShowPrintModal(false);
    setPrintSigned(true);
  };
  return (
    <Modal className="tamam-dialog" onClose={close} size="lg" labelledBy="print-sign-title" describedBy="print-sign-desc">
      <DialogFrame>
        <DialogHeader
          titleId="print-sign-title"
          title={t('ptDetail.printRecord')}
          descriptionId="print-sign-desc"
          description="Patient identity is always included. Select the sections needed for this printout, then sign the document."
          onClose={close}
        />
        <DialogBody className="space-y-5">
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t('ptDetail.printSections')}</span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold"
                      style={{ color: 'var(--tamamhealth-blue)' }}
                      onClick={() => setPrintSections(prev => prev.size === PRINT_SECTION_OPTIONS.length ? new Set() : new Set(DEFAULT_PRINT_SECTIONS))}
                    >
                      {printSections.size === PRINT_SECTION_OPTIONS.length ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PRINT_SECTION_OPTIONS.map(section => (
                      <label key={section.id} className="flex items-start gap-2 rounded-md p-2 cursor-pointer" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                        <input
                          type="checkbox"
                          checked={printSections.has(section.id)}
                          onChange={() => setPrintSections(prev => {
                            const next = new Set(prev);
                            if (next.has(section.id)) next.delete(section.id); else next.add(section.id);
                            return next;
                          })}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{section.label}</span>
                          <span className="block text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>{section.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <FormField label="Clinician name & title" required>
                  {control => (
                    <input
                      {...control}
                      autoFocus
                      value={printSignature}
                      onChange={e => setPrintSignature(e.target.value)}
                      placeholder="e.g. Dr. James Wani Igga, MD"
                      onKeyDown={e => { if (e.key === 'Enter' && canSign) sign(); }}
                    />
                  )}
                </FormField>
        </DialogBody>
        <DialogFooter>
          <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!canSign} onClick={sign}>
            <Printer className="w-3.5 h-3.5" /> Sign &amp; Print selected
          </button>
        </DialogFooter>
      </DialogFrame>
    </Modal>
  );
}
