'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import ClinicalNoteEditor from '@/components/clinical-notes/ClinicalNoteEditor';
import { useApp } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';

/**
 * Full-screen note editor. The note owns the viewport height so the section
 * canvas scrolls under a fixed toolbar and footer — a clinician documenting a
 * long encounter should never lose sight of Sign or of when it last saved.
 */
export default function ClinicalNotePage() {
  const params = useParams<{ id: string }>();
  const { currentUser } = useApp();
  const { users } = useUsers();

  const assignable = useMemo(
    () => (users || []).map(u => ({ _id: u._id, name: u.name || u.username })),
    [users],
  );

  const noteId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  if (!noteId) return null;

  return (
    <div style={{ height: '100%', minHeight: 0 }}>
      <ClinicalNoteEditor
        noteId={noteId}
        currentUser={currentUser}
        assignableUsers={assignable}
      />
    </div>
  );
}
