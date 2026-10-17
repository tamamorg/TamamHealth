import React from 'react';
import { mountAndFlush } from './test-utils';
import MobileNotesTab from '@/components/mobile/patients/tabs/MobileNotesTab';

jest.mock('@/lib/hooks/useDataScope', () => {
  const scope = { userId: 'u1', orgId: 'o1', hospitalId: 'h1' };
  return { useDataScope: () => scope };
});
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: null }) }));
jest.mock('@/components/clinical-notes/ClinicalNoteViewer', () => ({ __esModule: true, default: () => <div>viewer</div> }));
jest.mock('@/lib/clinical-notes/note-service', () => ({
  ...jest.requireActual('@/lib/clinical-notes/note-service'),
  getNotesByPatient: async () => [{
    _id: 'n1', type: 'clinical_note', patientId: 'p', patientName: 'M', noteType: 'soap', status: 'signed',
    sections: [{ sectionId: 'subjective', text: 'Desktop clinical note text' }],
    serviceDate: '2026-10-05', serviceTime: '10:00', authorName: 'Dr. Igga',
  }],
}));
jest.mock('@/lib/services/patient-note-service', () => ({
  getNotesByPatient: async () => [{
    _id: 'l1', type: 'patient_note', patientId: 'p', body: 'Legacy internal note', authorId: 'u', authorName: 'Nurse Keji', createdAt: '2026-10-01T08:00:00Z',
  }],
}));

it('lists clinical and legacy notes merged, newest first', async () => {
  const m = await mountAndFlush(<MobileNotesTab patientId="p" />);
  const text = m.container.textContent || '';
  expect(text.indexOf('Desktop clinical note text')).toBeGreaterThan(-1);
  expect(text.indexOf('Legacy internal note')).toBeGreaterThan(text.indexOf('Desktop clinical note text'));
  expect(text).toContain('Signed');
  expect(text).toContain('Dr. Igga · 2026-10-05');
  m.unmount();
});
