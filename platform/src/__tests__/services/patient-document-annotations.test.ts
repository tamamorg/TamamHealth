const mockGet = jest.fn();
const mockPut = jest.fn();

jest.mock('@/lib/db', () => ({
  patientDocumentsDB: () => ({ get: mockGet, put: mockPut }),
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import type { DataScope } from '@/lib/services/data-scope';
import type { PatientDocumentDoc } from '@/lib/db-types';
import { logAuditSafe } from '@/lib/services/audit-service';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import {
  addImageAnnotation,
  deleteImageAnnotation,
  updateImageAnnotation,
} from '@/lib/services/patient-document-service';

const mockAudit = jest.mocked(logAuditSafe);
const mockSync = jest.mocked(emitSyncEvent);

const scope: DataScope = { role: 'doctor', orgId: 'org-1', hospitalId: 'hospital-1' };
const actor = { id: 'user-1', name: 'Dr. Test' };

function imageDocument(overrides: Partial<PatientDocumentDoc> = {}): PatientDocumentDoc {
  return {
    _id: 'pdoc-1',
    _rev: '1-a',
    type: 'patient_document',
    patientId: 'patient-1',
    title: 'Chest X-ray',
    category: 'radiology',
    fileName: 'chest.png',
    mimeType: 'image/png',
    base64Data: 'AA==',
    sizeBytes: 1,
    hospitalId: 'hospital-1',
    orgId: 'org-1',
    createdAt: '2026-08-24T10:00:00.000Z',
    updatedAt: '2026-08-24T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPut.mockResolvedValue({ rev: '2-b' });
});

test('creates normalized, attributed image annotations and emits sync', async () => {
  mockGet.mockResolvedValue(imageDocument());

  const updated = await addImageAnnotation('pdoc-1', { label: ' Right lower-zone opacity ', x: 0.72, y: 0.63 }, scope, actor);

  expect(updated.imageAnnotations).toEqual([
    expect.objectContaining({ label: 'Right lower-zone opacity', x: 0.72, y: 0.63, status: 'active', createdById: 'user-1' }),
  ]);
  expect(mockPut).toHaveBeenCalledWith(expect.objectContaining({ _id: 'pdoc-1' }));
  expect(mockAudit).toHaveBeenCalledWith('ADD_IMAGE_ANNOTATION', 'user-1', 'Dr. Test', expect.stringContaining('Chest X-ray'));
  expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'pdoc-1', operation: 'update', resourceVersion: '2-b' }));
});

test('edits a label and tombstones deletion instead of erasing clinical mark-up', async () => {
  const annotation = {
    id: 'ann-1', label: 'Opacity', x: 0.4, y: 0.5, status: 'active' as const,
    createdAt: '2026-08-24T10:00:00.000Z', createdById: 'user-1',
  };
  mockGet.mockResolvedValueOnce(imageDocument({ imageAnnotations: [annotation] }));
  const edited = await updateImageAnnotation('pdoc-1', 'ann-1', 'Consolidation', scope, actor);
  expect(edited.imageAnnotations?.[0]).toEqual(expect.objectContaining({ label: 'Consolidation', updatedById: 'user-1' }));

  mockGet.mockResolvedValueOnce(imageDocument({ _rev: '2-b', imageAnnotations: edited.imageAnnotations }));
  const deleted = await deleteImageAnnotation('pdoc-1', 'ann-1', scope, actor);
  expect(deleted.imageAnnotations).toHaveLength(1);
  expect(deleted.imageAnnotations?.[0]).toEqual(expect.objectContaining({ status: 'deleted', deletedById: 'user-1' }));
});

test('re-reads and preserves a concurrently-synced annotation after a 409', async () => {
  const synced = {
    id: 'ann-remote', label: 'Remote label', x: 0.2, y: 0.3, status: 'active' as const,
    createdAt: '2026-08-24T10:00:00.000Z',
  };
  mockGet
    .mockResolvedValueOnce(imageDocument())
    .mockResolvedValueOnce(imageDocument({ _rev: '2-remote', imageAnnotations: [synced] }));
  mockPut
    .mockRejectedValueOnce({ status: 409, name: 'conflict' })
    .mockResolvedValueOnce({ rev: '3-local' });

  const updated = await addImageAnnotation('pdoc-1', { label: 'Local label', x: 0.6, y: 0.7 }, scope, actor);

  expect(mockGet).toHaveBeenCalledTimes(2);
  expect(updated.imageAnnotations?.map(annotation => annotation.label)).toEqual(['Remote label', 'Local label']);
});

test('fails closed for a document outside the clinician facility', async () => {
  mockGet.mockResolvedValue(imageDocument({ hospitalId: 'hospital-2' }));
  await expect(addImageAnnotation('pdoc-1', { label: 'No access', x: 0.5, y: 0.5 }, scope, actor))
    .rejects.toThrow('outside your assigned scope');
  expect(mockPut).not.toHaveBeenCalled();
});
