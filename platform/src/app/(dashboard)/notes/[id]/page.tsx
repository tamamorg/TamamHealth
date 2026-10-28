'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';

/**
 * A note has no page of its own: it is documented in the patient's chart, in
 * the docked workspace beside the record (the OpenMRS O3 form layout). This
 * route stays so every existing link — worklists, notifications, the
 * unsigned-notes queue — keeps working: it finds the note's patient and opens
 * their chart with the note in the workspace (`?note=`).
 */
export default function ClinicalNoteRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const scope = useDataScope();
  const { t } = useTranslation();
  const [missing, setMissing] = useState(false);
  const noteId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  useEffect(() => {
    if (!noteId || !scope) return;
    let cancelled = false;
    void import('@/lib/clinical-notes/note-service')
      .then(m => m.getClinicalNoteById(noteId, scope))
      .then(note => {
        if (cancelled) return;
        if (!note) { setMissing(true); return; }
        router.replace(`/patients/${encodeURIComponent(note.patientId)}?note=${encodeURIComponent(note._id)}`);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [noteId, scope, router]);

  return (
    <div className="cn-empty" role="status">
      {missing ? t('noteEditor.noteNotFound') : t('noteEditor.loadingNote')}
    </div>
  );
}
