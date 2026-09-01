'use client';

// Reception care-assignment modal. Front-desk staff pick the clinician who will
// provide care for a patient; the choice is written onto the patient record
// (assignedDoctor*) and, when the patient came through triage, onto the triage
// handoff fields. The assigned doctor then sees the patient in their
// "assigned to you" worklist on the clinician dashboard.

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import { Stethoscope, X, Check, Search } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import { ROLE_LABEL } from '@/lib/role-display';
import type { UserRole } from '@/lib/db-types';
import { canAssignStaffAtFacility } from '@/lib/care-team-permissions';

export interface AssignDoctorTarget {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  /** Triage record to stamp with the handoff, if this came from triage. */
  triageId?: string;
  appointmentId?: string;
  encounterId?: string;
  /** Currently assigned doctor id, to pre-select / show as current. */
  currentDoctorId?: string;
}

// The responsible-provider role differs by facility tier. Hospitals are
// doctor-led; primary-care facilities (PHCC / PHCU / primary) are nurse and
// clinical-officer-led, so reception assigns a nurse there instead of a doctor.
const DOCTOR_ROLES: UserRole[] = ['doctor', 'clinical_officer', 'medical_superintendent', 'clinician'];
const NURSE_ROLES: UserRole[] = ['nurse', 'midwife', 'clinical_officer', 'triage_nurse', 'rooming_nurse'];
const HOSPITAL_FACILITY_TYPES = ['national_referral', 'state_hospital', 'county_hospital', 'secondary', 'teaching_hospital'];

export default function AssignDoctorModal({
  target,
  onClose,
  onAssigned,
}: {
  target: AssignDoctorTarget;
  onClose: () => void;
  onAssigned?: (doctor: { id: string; name: string }) => void;
}) {
  const { currentUser } = useAuth();
  const { users, loading } = useUsers();
  const { showToast } = useToast();

  const [selectedId, setSelectedId] = useState<string>(target.currentDoctorId ?? '');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Pick the provider type from the facility tier. Default to doctor-led when
  // the facility type is unknown so hospitals always offer doctors.
  const facilityType = currentUser?.hospital?.facilityType as string | undefined;
  const isHospital = !facilityType || HOSPITAL_FACILITY_TYPES.includes(facilityType);
  const assignableRoles = isHospital ? DOCTOR_ROLES : NURSE_ROLES;
  const providerLabel = isHospital ? 'doctor' : 'nurse';
  const providerLabelCap = isHospital ? 'Doctor' : 'Nurse';

  // Providers at the assigner's facility. Missing facility assignment fails
  // closed instead of exposing every clinician in the tenant.
  // Read out of the user once so the memo below depends on the FIELD rather
  // than on the whole user object: a dependency list naming a property of an
  // object the body reads is narrower than the compiler can infer, and it
  // skips optimizing the component rather than guess.
  const myHospitalId = currentUser?.hospitalId;
  const doctors = useMemo(() => {
    const clinicians = users.filter(
      u => assignableRoles.includes(u.role) && u.isActive !== false,
    );
    const base = clinicians.filter(u => canAssignStaffAtFacility(myHospitalId, u.hospitalId));
    const q = search.trim().toLowerCase();
    const filtered = q
      ? base.filter(u => u.name.toLowerCase().includes(q) || (u.specialty ?? '').toLowerCase().includes(q))
      : base;
    return [...filtered].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
  }, [users, myHospitalId, search, assignableRoles]);

  const handleAssign = async () => {
    const doctor = doctors.find(d => d._id === selectedId);
    if (!doctor) {
      showToast(`Select a ${providerLabel} to assign`, 'error');
      return;
    }
    setSaving(true);
    try {
      // One shared assignment path (patient fields → progress tracker → triage
      // handoff), so this modal and the front desk's inline picker cannot drift.
      const { assignProviderToPatient } = await import('@/lib/services/patient-assignment-service');
      await assignProviderToPatient({
        patientId: target.patientId,
        patientName: target.patientName,
        provider: { id: doctor._id, name: doctor.name, role: doctor.role },
        actor: { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role },
        hospitalId: myHospitalId,
        hospitalName: currentUser?.hospital?.name || currentUser?.hospitalName,
        orgId: currentUser?.orgId,
        triageId: target.triageId,
        appointmentId: target.appointmentId,
        encounterId: target.encounterId,
        note,
      });

      showToast(`${target.patientName} assigned to ${doctor.name}`, 'success');
      onAssigned?.({ id: doctor._id, name: doctor.name });
      onClose();
    } catch {
      showToast('Failed to assign patient', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={480}>
      <div
        className="modal-content card-elevated assign-doctor-modal"
        style={{ width: '100%' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Assign to {providerLabel}</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {target.patientName}{target.hospitalNumber ? ` · ${target.hospitalNumber}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg transition-colors hover:bg-black/5" aria-label="Close">
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {/* Search */}
          <div className="relative assign-doctor-search">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${providerLabel}s…`}
              className="w-full rounded-lg border py-2 ps-9 pe-3 text-sm"
              style={{
                borderColor: 'var(--border-medium)',
                background: 'var(--bg-input, var(--bg-card-solid))',
                color: 'var(--text-primary)',
                paddingInlineStart: 38,
                paddingInlineEnd: 12,
              }}
            />
          </div>

          {/* Doctor list */}
          <div className="max-h-64 overflow-y-auto rounded-lg border assign-doctor-provider-list" style={{ borderColor: 'var(--border-light)' }}>
            {loading ? (
              <p className="p-4 text-sm text-center" style={{ color: 'var(--text-muted)' }}>Loading {providerLabel}s…</p>
            ) : doctors.length === 0 ? (
              <p className="p-4 text-sm text-center" style={{ color: 'var(--text-muted)' }}>No {providerLabel}s available to assign.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
                {doctors.map(d => {
                  const selected = d._id === selectedId;
                  return (
                    <li key={d._id}>
                      <button
                        onClick={() => setSelectedId(d._id)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start transition-colors"
                        style={{ background: selected ? 'var(--accent-light)' : 'transparent' }}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{d.name}</p>
                          <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                            {d.specialty || ROLE_LABEL[d.role] || providerLabelCap}
                            {d.hospitalName ? ` · ${d.hospitalName}` : ''}
                          </p>
                        </div>
                        {selected && (
                          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--accent-primary)' }}>
                            <Check className="w-3.5 h-3.5 text-white" />
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Handoff note */}
          <div>
            <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Handoff note <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. Febrile, ?malaria — needs review this morning"
              className="w-full resize-none rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border-medium)', background: 'var(--bg-input, var(--bg-card-solid))', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:bg-black/5" style={{ color: 'var(--text-muted)' }}>
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={!selectedId || saving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ background: 'var(--accent-primary)' }}
          >
            <Stethoscope className="w-4 h-4" />
            {saving ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
