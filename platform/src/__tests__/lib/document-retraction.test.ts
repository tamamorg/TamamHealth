import { canRetractDocument, canSeeRetractedDocuments } from '@/lib/clinical/document-retraction';

describe('who may retract a document', () => {
  const doc = { uploadedById: 'user-amira' };

  it('lets the person who filed it take it back, whatever their role', () => {
    expect(canRetractDocument({ id: 'user-amira', role: 'front_desk' }, doc)).toBe(true);
  });

  it('lets clinicians and the records office, not other staff', () => {
    for (const role of ['doctor', 'clinical_officer', 'records_hmis_officer', 'hrio']) {
      expect([role, canRetractDocument({ id: 'x', role }, doc)]).toEqual([role, true]);
    }
    for (const role of ['front_desk', 'nurse', 'cashier', 'lab_tech']) {
      expect([role, canRetractDocument({ id: 'x', role }, doc)]).toEqual([role, false]);
    }
  });

  it('refuses when nobody is identified', () => {
    expect(canRetractDocument(undefined, doc)).toBe(false);
    expect(canRetractDocument({ id: 'user-amira' }, doc)).toBe(false);
  });

  it('shows the retraction note to clinical staff only', () => {
    expect(canSeeRetractedDocuments('nurse')).toBe(true);
    expect(canSeeRetractedDocuments('doctor')).toBe(true);
    expect(canSeeRetractedDocuments('cashier')).toBe(false);
    expect(canSeeRetractedDocuments(undefined)).toBe(false);
  });
});
