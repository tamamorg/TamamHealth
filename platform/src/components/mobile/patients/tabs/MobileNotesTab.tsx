'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import type { PatientNoteDoc } from '@/lib/db-types';
import { useDataScope } from '@/lib/hooks/useDataScope';

export default function MobileNotesTab({ patientId }: { patientId: string }) {
  const [notes, setNotes] = useState<PatientNoteDoc[] | null>(null);
  const scope = useDataScope();

  // No hook exists for patient notes — mirror the direct service-call
  // pattern used at patients/[id]/page.tsx:180-184.
  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    import('@/lib/services/patient-note-service')
      .then((m) => m.getNotesByPatient(patientId, scope))
      .then((n) => { if (!cancelled) setNotes(n); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [patientId, scope]);

  if (notes === null) {
    return (
      <div className="mobile-shell-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (notes.length === 0) {
    return <EmptyState title="No notes" message="Clinical notes for this patient will appear here." />;
  }

  return (
    <div className="mobile-chart-tab-body">
      {notes.map((n) => (
        <div key={n._id} className="mobile-chart-card">
          <p className="mobile-note-body">{n.body}</p>
          <small className="mobile-note-meta">{n.authorName} · {new Date(n.createdAt || '').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
        </div>
      ))}
    </div>
  );
}
