'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import { AlertTriangle, Package, Send, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReferrals } from '@/lib/hooks/useReferrals';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePatients } from '@/lib/hooks/usePatients';
import { useAuth } from '@/lib/context';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useToast } from '@/components/Toast';
import FileUpload from '@/components/FileUpload';
import type { Attachment } from '@/data/mock';
import Select from '@/components/Select';

// Fallback list used only when the facility hasn't configured its departments
// in Facility Settings (settings.departments drives the picker when present).
const FALLBACK_DEPARTMENTS = [
  'Internal Medicine', 'Pediatrics', 'Obstetrics & Gynecology', 'Surgery',
  'Emergency', 'Cardiology', 'Orthopedics', 'Ophthalmology', 'Neurology',
  'Dermatology', 'ENT', 'Outpatient'
];

// Hierarchical referral destinations based on facility level: Boma(PHCU) →
// Payam(PHCC), Payam(PHCC) → County/State/National, County → State/National,
// State → National, National → National/State.
const ALLOWED_DESTINATION_TYPES: Record<string, string[]> = {
  phcu: ['phcc'],
  phcc: ['county_hospital', 'state_hospital', 'national_referral'],
  county_hospital: ['state_hospital', 'national_referral'],
  state_hospital: ['national_referral'],
  national_referral: ['national_referral', 'state_hospital'],
};

export default function ReferralFormModal({ onClose, onSent }: { onClose: () => void; onSent?: () => void }) {
  const { t } = useTranslation();
  const { createWithTransfer } = useReferrals();
  const { showToast } = useToast();
  const { hospitals } = useHospitals();
  const { patients } = usePatients();
  const { currentUser } = useAuth();
  const { departments: facilityDepartments } = useSettings();
  const departments = facilityDepartments.length ? facilityDepartments : FALLBACK_DEPARTMENTS;
  const OUR_HOSPITAL_ID = currentUser?.hospitalId || '';

  const currentFacilityType = currentUser?.hospital?.facilityType;
  const allowedTypes = currentFacilityType ? ALLOWED_DESTINATION_TYPES[currentFacilityType] : undefined;
  const otherHospitals = hospitals.filter(h =>
    h._id !== OUR_HOSPITAL_ID &&
    (!allowedTypes || allowedTypes.includes(h.facilityType))
  );

  const [formPatient, setFormPatient] = useState('');
  const [formPatientSearch, setFormPatientSearch] = useState('');
  const [formHospital, setFormHospital] = useState('');
  const [formDepartment, setFormDepartment] = useState('');
  const [formUrgency, setFormUrgency] = useState<'routine' | 'urgent' | 'emergency'>('routine');
  const [formReason, setFormReason] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formAttachments, setFormAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitReferral = async () => {
    try {
      setSubmitting(true);
      const patient = patients.find(p => p._id === formPatient);
      const toHospital = hospitals.find(h => h._id === formHospital);
      const fromHospital = hospitals.find(h => h._id === OUR_HOSPITAL_ID);
      await createWithTransfer(
        {
          patientId: formPatient,
          // Guard the optional middleName — `${undefined}` would otherwise
          // persist a literal "John undefined Doe" into the referral payload.
          patientName: patient
            ? `${patient.firstName} ${patient.middleName || ''} ${patient.surname}`.replace(/\s+/g, ' ').trim()
            : '',
          fromHospitalId: OUR_HOSPITAL_ID,
          fromHospital: fromHospital?.name || '',
          toHospitalId: formHospital,
          toHospital: toHospital?.name || '',
          department: formDepartment,
          urgency: formUrgency,
          reason: formReason,
          notes: formNotes,
          referringDoctor: currentUser?.name || '',
          // The dashboard's "Open referrals" rail filters on createdBy — a
          // referral without it is invisible to the clinician who sent it.
          createdBy: currentUser?._id,
          referralDate: new Date().toISOString().split('T')[0],
          status: 'sent',
        },
        formAttachments,
        currentUser?.name || 'Unknown'
      );
      showToast(t('referrals.toastSent'), 'success');
      onSent?.();
      onClose();
    } catch (err) {
      console.error('Failed to submit referral:', err);
      showToast(t('referrals.toastSubmitFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPatient = formPatient ? patients.find(p => p._id === formPatient) : null;
  const patientQuery = formPatientSearch.trim().toLowerCase();
  const patientMatches = patientQuery.length >= 1
    ? patients.filter(p => {
        const name = `${p.firstName || ''} ${p.middleName || ''} ${p.surname || ''}`.toLowerCase();
        return name.includes(patientQuery)
          || (p.hospitalNumber || '').toLowerCase().includes(patientQuery)
          || (p.phone || '').toLowerCase().includes(patientQuery);
      }).slice(0, 8)
    : [];

  return (
    <Modal onClose={onClose} width={760} align="top" labelledBy="referral-form-title">
      <div className="modal-panel modal-panel--lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5" style={{ color: 'var(--tamamhealth-blue)' }} />
            <h2 id="referral-form-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t('referrals.createNew')}
            </h2>
            <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--accent-light)', color: 'var(--tamamhealth-blue)' }}>
              {t('referrals.autoPackages')}
            </span>
          </div>
          <button type="button" aria-label={t('action.cancel')} onClick={onClose} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {/* Patient */}
          <div>
            <label>{t('referrals.patient')}</label>
            {selectedPatient ? (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  {t('referrals.selectedPrefix')} <span className="font-semibold">{selectedPatient.firstName} {selectedPatient.surname}</span>
                  <span className="text-xs ms-2" style={{ color: 'var(--text-muted)' }}>({selectedPatient.hospitalNumber})</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setFormPatient(''); setFormPatientSearch(''); }}
                  className="text-xs underline"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {t('referrals.change')}
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="search"
                  value={formPatientSearch}
                  onChange={e => setFormPatientSearch(e.target.value)}
                  placeholder={t('referrals.patientSearchPlaceholder')}
                  className="w-full p-2.5 rounded-lg outline-none text-sm"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
                {patientMatches.length > 0 && (
                  <div className="mt-1 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card)' }}>
                    {patientMatches.map(p => (
                      <button
                        key={p._id}
                        type="button"
                        onClick={() => { setFormPatient(p._id); setFormPatientSearch(''); }}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-start hover:bg-white/5 transition-colors"
                        style={{ borderBottom: '1px solid var(--border-light)' }}
                      >
                        <span className="text-sm font-semibold truncate">{p.firstName} {p.surname}</span>
                        <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber}</span>
                      </button>
                    ))}
                  </div>
                )}
                {patientQuery.length >= 1 && patientMatches.length === 0 && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('referrals.noPatientsMatch')}</p>
                )}
              </div>
            )}
          </div>

          {/* Destination Hospital */}
          <div>
            <label>{t('referrals.destinationHospital')}</label>
            <Select value={formHospital} onChange={(e) => setFormHospital(e.target.value)}>
              <option value="">{t('referrals.selectHospital')}</option>
              {otherHospitals.map(h => (
                <option key={h._id} value={h._id}>
                  {h.name} ({h.state})
                </option>
              ))}
            </Select>
          </div>

          {/* Department */}
          <div>
            <label>{t('referrals.department')}</label>
            <Select value={formDepartment} onChange={(e) => setFormDepartment(e.target.value)}>
              <option value="">{t('referrals.selectDepartment')}</option>
              {departments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </div>

          {/* Urgency */}
          <div>
            <label>{t('referrals.urgency')}</label>
            <div className="flex gap-3 mt-1">
              {(['routine', 'urgent', 'emergency'] as const).map(level => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setFormUrgency(level)}
                  className={`badge urgency-${level} cursor-pointer px-4 py-2 text-sm transition-all`}
                  style={{
                    opacity: formUrgency === level ? 1 : 0.45,
                    transform: formUrgency === level ? 'scale(1.05)' : 'scale(1)',
                    border: formUrgency === level ? '2px solid currentColor' : '2px solid transparent',
                    borderRadius: '4px',
                  }}
                >
                  {level === 'emergency' && <AlertTriangle className="w-3.5 h-3.5 inline me-1" />}
                  {t(`referrals.urgency_${level}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Reason */}
          <div className="col-span-2">
            <label>{t('referrals.reasonForReferral')}</label>
            <textarea
              value={formReason}
              onChange={(e) => setFormReason(e.target.value)}
              rows={2}
              placeholder={t('referrals.reasonPlaceholder')}
            />
          </div>

          {/* Clinical Notes */}
          <div className="col-span-2">
            <label>{t('referral.notes')}</label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={3}
              placeholder={t('referrals.notesPlaceholder')}
            />
          </div>

          {/* Referral Attachments */}
          <div className="col-span-2">
            <label>{t('referrals.attachmentsOptional')}</label>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              {t('referrals.attachmentsHint')}
            </p>
            <FileUpload
              attachments={formAttachments}
              onAdd={(att) => setFormAttachments(prev => [...prev, att])}
              onRemove={(id) => setFormAttachments(prev => prev.filter(a => a.id !== id))}
              uploaderName={currentUser?.name || 'Unknown'}
              maxFiles={5}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-5 pt-4 border-t" style={{ borderColor: 'var(--border-light)' }}>
          <button onClick={onClose} className="btn btn-secondary">
            {t('action.cancel')}
          </button>
          <button
            onClick={handleSubmitReferral}
            className="btn btn-primary"
            disabled={!formPatient || !formHospital || !formDepartment || !formReason || submitting}
            style={{
              opacity: (!formPatient || !formHospital || !formDepartment || !formReason || submitting) ? 0.5 : 1,
              cursor: (!formPatient || !formHospital || !formDepartment || !formReason || submitting) ? 'not-allowed' : 'pointer',
            }}
          >
            <Package className="w-4 h-4" />
            {submitting ? t('referrals.packagingSending') : t('referrals.sendWithPackage')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
