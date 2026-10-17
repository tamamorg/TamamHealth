'use client';
import Modal from '@/components/Modal';
import { X, Printer } from '@/components/icons/lucide';
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
  return (
            <Modal className="tamam-dialog" onClose={() => setShowPrintModal(false)} width={560} labelledBy="print-sign-title">
              <div className="rounded-xl p-6 space-y-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                <div className="flex items-center justify-between">
                  <h2 id="print-sign-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t('ptDetail.printRecord')}</h2>
                  <button className="p-1 rounded" onClick={() => setShowPrintModal(false)} style={{ color: 'var(--text-muted)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  Patient identity is always included. Select the sections needed for this printout, then sign the document.
                </p>
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
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Clinician name &amp; title</label>
                  <input
                    autoFocus
                    value={printSignature}
                    onChange={e => setPrintSignature(e.target.value)}
                    placeholder="e.g. Dr. James Wani Igga, MD"
                    className="w-full p-2.5 rounded-md text-[13px]"
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && printSignature.trim() && printSections.size > 0) {
                        setShowPrintModal(false);
                        setPrintSigned(true);
                      }
                    }}
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button className="btn btn-sm btn-secondary" onClick={() => setShowPrintModal(false)}>Cancel</button>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={!printSignature.trim() || printSections.size === 0}
                    onClick={() => {
                      setShowPrintModal(false);
                      setPrintSigned(true);
                    }}
                  >
                    <Printer className="w-3.5 h-3.5" /> Sign &amp; Print selected
                  </button>
                </div>
              </div>
            </Modal>
  );
}
