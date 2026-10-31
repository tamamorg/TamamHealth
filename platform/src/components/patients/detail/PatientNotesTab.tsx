'use client';
import ClinicalNoteViewer from '@/components/clinical-notes/ClinicalNoteViewer';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { NotesList, PhoneNotes } from './lazy-panels';
import type { Dispatch, SetStateAction } from 'react';
import type { AppUser } from '@/lib/context/types';
export default function PatientNotesTab({ patient, currentUser, canConsult, setNoteViewer, notesRefreshToken, noteViewer, setNotesRefreshToken, setChartPanelRequest, onCreateNote, onOpenRecord }: {
  patient: PatientDoc;
  currentUser: AppUser | null;
  canConsult: boolean;
  setNoteViewer: Dispatch<SetStateAction<{ id: string; kind: "clinical" | "record"; } | null>>;
  notesRefreshToken: number;
  noteViewer: { id: string; kind: "clinical" | "record"; } | null;
  setNotesRefreshToken: Dispatch<SetStateAction<number>>;
  setChartPanelRequest: Dispatch<SetStateAction<string | null>>;
  /** The header's "+ Note": today's unsigned draft or a new Consultation,
   *  opened in the chart's slider. */
  onCreateNote: () => void;
  /** A consultation record opens in the chart sidebar, where it is signed. */
  onOpenRecord: (recordId: string) => void;
}) {
  return (
            <div className="space-y-4">
              {/* Clinical notes are the encounter record now that the
                  consultation wizard is retired, so they lead this tab rather
                  than being signposted off to the Activity feed. NotesList
                  brings its own ChartSection card, so no wrapper here. */}
              <NotesList
                patientId={patient._id}
                patientName={patientFullName(patient)}
                mrn={patient.hospitalNumber}
                patientDob={patient.dateOfBirth}
                currentUser={currentUser}
                showCreate={canConsult}
                // Create note goes straight to the Consultation form in the
                // slider, like the header's "+ Note" — no note-type menu. The
                // form's own type picker changes it if a different note is
                // wanted.
                onCreate={onCreateNote}
                // Reading a note no longer leaves the chart, and a saved note
                // always opens locked: a signed one with addendum and print, a
                // draft with Edit for those who may write notes.
                onOpenNote={(id, kind) => {
                  if (kind === 'record') onOpenRecord(id);
                  else setNoteViewer({ id, kind });
                }}
                refreshToken={notesRefreshToken}
              />
              {/* Telephone contacts stay separate: they are care-team messages
                  about a patient, not documentation of an encounter. PhoneNotes
                  brings its own ChartSection card. */}
              <PhoneNotes patient={patient} />
              {/* Opens as a slider, like every other chart form: the note
                  reads beside the list it was picked from. */}
              {noteViewer && (
                <ClinicalNoteViewer
                  presentation="slider"
                  noteId={noteViewer.id}
                  kind={noteViewer.kind}
                  onClose={() => { setNoteViewer(null); setNotesRefreshToken(n => n + 1); }}
                  onEdit={canConsult ? id => { setNoteViewer(null); setChartPanelRequest(`clinical-note:${id}:edit`); } : undefined}
                />
              )}
            </div>
  );
}
