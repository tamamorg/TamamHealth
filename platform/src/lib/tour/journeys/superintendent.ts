import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';
import { clinicalOfficerTourSteps } from '../clinical-officer-steps';

// ── Medical superintendent — clinical journey + oversight stops ────────────
export const SUPERINTENDENT_STEPS: TourStep[] = [
  ...clinicalOfficerTourSteps.filter(s => s.id !== 'finish'),
  {
    id: 'payments-oversight',
    route: '/payments',
    target: '',
    title: 'Financial oversight',
    body: 'You also see collections, the pending-verification queue, and claims — the money side of the visits you supervise.',
  },
  {
    id: 'hr-oversight',
    route: '/hr',
    target: '',
    title: 'People',
    body: 'Shifts, leave, and payroll for the clinical teams you run.',
  },
  messagingStep('/dashboard'),
  finishStep('/dashboard'),
];
