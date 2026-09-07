export type RestrictedMentalHealthNoteCategory = 'assessment' | 'therapy' | 'safeguarding' | 'risk' | 'follow_up';

export interface RestrictedMentalHealthNote {
  id: string;
  patientId: string;
  patientName: string;
  episodeId: string;
  category: RestrictedMentalHealthNoteCategory;
  narrative: string;
  hospitalId: string;
  orgId: string;
  authoredBy: string;
  authoredByName: string;
  authoredAt: string;
  updatedAt: string;
}
