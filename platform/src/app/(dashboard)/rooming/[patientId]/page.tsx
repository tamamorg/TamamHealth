'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BedDouble, FileText } from '@/components/icons/lucide';
import { usePatients } from '@/lib/hooks/usePatients';
import { useAuth } from '@/lib/context';
import { getRoleConfig } from '@/lib/permissions';
import { patientFullName, patientGenderAge, initials, stateTint } from '@/lib/patient-utils';
import RoomingWorkflow from '@/components/nurse/RoomingWorkflow';

/** Focused rooming page opened from a patient row's visit details. */
export default function PatientRoomingPage() {
  const params = useParams();
  const router = useRouter();
  const { currentUser } = useAuth();
  const patientId = String(params?.patientId || '');
  const { patients, loading } = usePatients();
  const patient = useMemo(() => patients.find(item => item._id === patientId) || null, [patients, patientId]);
  const backTarget = currentUser && getRoleConfig(currentUser.role)?.allowedRoutes?.some(route => '/dashboard/nurse'.startsWith(route))
    ? '/dashboard/nurse?station=rooming'
    : '/dashboard/nurse';

  if (loading || !patient) {
    return (
      <main className="page-container flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{loading ? 'Loading patient…' : 'Patient not found.'}</p>
      </main>
    );
  }

  const name = patientFullName(patient);
  const photo = (patient as { photoUrl?: string }).photoUrl;

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => router.push(backTarget)}
        className="flex items-center gap-1.5 text-[12px] font-bold mb-2 no-print"
        style={{ color: 'var(--accent-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <ArrowLeft className="w-4 h-4" /> Back to rooming
      </button>

      <div className="card-elevated flex items-center gap-3 px-4 py-3 mb-3 flex-shrink-0" style={{ borderRadius: 12 }}>
        <span className="ehr-patient-icon" style={stateTint()} aria-hidden>
          {photo ? <img src={photo} alt="" className="ehr-patient-icon-photo" /> : initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>{name}</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{[patient.hospitalNumber, patientGenderAge(patient)].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" onClick={() => router.push(`/patients/${patient._id}`)} className="flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-semibold flex-shrink-0" style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-secondary)' }}>
          <FileText className="w-4 h-4" /> Open chart
        </button>
      </div>

      <section className="card-elevated flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <BedDouble className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Room patient</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Assign a room, record vitals, and mark ready for the clinician.</p>
          </div>
        </div>
        <div className="p-3 flex-1 min-h-0 overflow-y-auto">
          <RoomingWorkflow patientId={patient._id} />
        </div>
      </section>
    </main>
  );
}
