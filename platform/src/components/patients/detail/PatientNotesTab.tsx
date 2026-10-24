'use client';
import Modal from '@/components/Modal';
import ClinicalNoteViewer from '@/components/clinical-notes/ClinicalNoteViewer';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { NotesList, PhoneNotes } from './lazy-panels';
import type { Dispatch, SetStateAction } from 'react';
import type { AppUser } from '@/lib/context/types';
export default function PatientNotesTab({ patient, currentUser, canConsult, setNoteViewer, notesRefreshToken, noteViewer, setNotesRefreshToken, setChartPanelRequest }: {
  patient: PatientDoc;
  currentUser: AppUser | null;
  canConsult: boolean;
  setNoteViewer: Dispatch<SetStateAction<{ id: string; kind: "clinical" | "record"; } | null>>;
  notesRefreshToken: number;
  noteViewer: { id: string; kind: "clinical" | "record"; } | null;
  setNotesRefreshToken: Dispatch<SetStateAction<number>>;
  setChartPanelRequest: Dispatch<SetStateAction<string | null>>;
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
                // Reading a note no longer leaves the chart: a signed note
                // opens over it, read-only, with addendum and print. An
                // unsigned draft is still being written, so tapping it goes
                // straight to the note drawer instead of a viewer whose only
                // useful button is Edit.
                onOpenNote={(id, kind, status) => {
                  if (kind === 'clinical' && status === 'draft' && canConsult) setChartPanelRequest(`clinical-note:${id}`);
                  else setNoteViewer({ id, kind });
                }}
                refreshToken={notesRefreshToken}
              />
              {/* Telephone contacts stay separate: they are care-team messages
                  about a patient, not documentation of an encounter. PhoneNotes
                  brings its own ChartSection card. */}
              <PhoneNotes patient={patient} />
              {noteViewer && (
                <Modal
                  className="tamam-dialog"
                  width={880}
                  onClose={() => { setNoteViewer(null); setNotesRefreshToken(n => n + 1); }}
                >
                  <ClinicalNoteViewer
                    noteId={noteViewer.id}
                    kind={noteViewer.kind}
                    onClose={() => { setNoteViewer(null); setNotesRefreshToken(n => n + 1); }}
                    onEdit={id => { setNoteViewer(null); setChartPanelRequest(`clinical-note:${id}`); }}
                  />
                </Modal>
              )}
            </div>
  );
}
