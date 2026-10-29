/**
 * The visit panel's "Visit note" row reads the clinical-notes store as well as
 * medical records. Consultation notes are written there now, so reading only
 * medical records said "Visit form has not been completed" under a signed note
 * (found walking a patient through the journey on 2026-10-29).
 */
import React from 'react';
import { mountAndFlush } from '../clinical-notes/test-utils';
import { todayIso } from '@/lib/date-utils';
import type { QueueEntry } from '@/lib/services/patient-queue-service';
import type { TriageDoc } from '@/lib/db-types';

jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/hooks/useMedicalRecords', () => ({ useMedicalRecords: () => ({ records: [] }) }));
const SCOPE = { orgId: 'org-1' };
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => SCOPE }));
let notes: unknown[] = [];
jest.mock('@/lib/clinical-notes/note-service', () => ({ listClinicalNotes: jest.fn(async () => notes) }));
jest.mock('@/components/Modal', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import EhrVisitPopup from '@/components/ehr/EhrVisitPopup';

const triage = {
  _id: 'triage-1', patientId: 'pat-1', patientName: 'Test User', status: 'seen', priority: 'GREEN',
  triagedAt: new Date().toISOString(), triagedByName: 'Nurse Achol', encounterId: 'enc-1',
} as unknown as TriageDoc;
const entry = {
  patientId: 'pat-1', patientName: 'Test User', stage: 'awaiting_consultation', acuity: 'GREEN',
  enteredStageAt: new Date().toISOString(), minutesWaiting: 1, targetWaitMinutes: 60,
  score: 1, flaggedForReassessment: false, triageId: 'triage-1',
} as QueueEntry;

const render = () => mountAndFlush(
  <EhrVisitPopup
    inline patientId="pat-1" name="Test User" acuity="GREEN" wait="1 min" appointment={null}
    triage={triage} entry={entry}
    onClose={jest.fn()} onMove={jest.fn()} onOpenChart={jest.fn()} onStartTriage={jest.fn()}
    onEscalate={jest.fn()} onLwbs={jest.fn()} onReturnToDesk={jest.fn()} onCreateNote={jest.fn()}
  />,
);

afterEach(() => { document.body.innerHTML = ''; notes = []; });

it("shows today's signed clinical note as the visit note", async () => {
  notes = [{
    _id: 'note-1', patientId: 'pat-1', serviceDate: todayIso(), status: 'signed', authorName: 'Dr. James Wani Igga',
    updatedAt: new Date().toISOString(), sections: [{ sectionId: 'cc', text: 'Fever and headache for three days' }],
  }];
  const { container } = await render();
  expect(container.textContent).toContain('Fever and headache for three days');
  expect(container.textContent).toContain('Dr. James Wani Igga · Signed');
  expect(container.textContent).not.toContain('Visit form has not been completed');
});

it('still says the form is not done when there is no note today', async () => {
  notes = [{ _id: 'note-0', patientId: 'pat-1', serviceDate: '2020-01-01', status: 'signed', authorName: 'Dr. X', sections: [] }];
  const { container } = await render();
  expect(container.textContent).toContain('Visit form has not been completed');
});
