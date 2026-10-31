/**
 * A worklist row says where the test really is. The coarse status stays
 * `pending` through collection and receipt, which held a drawn specimen under
 * "To collect", and a STAT order's `in_progress` skipped the specimen steps.
 */
import { labBenchStage } from '@/components/dashboards/LabHomeView';
import { benchActionLabel, isOutsideRequest } from '@/components/lab/workflow/lab-workflow-types';

describe('labBenchStage', () => {
  it.each([
    ['ordered', 'collect'],
    ['rejected_needs_recollection', 'collect'],
    ['specimen_collected', 'bench'],
    ['received_at_lab', 'bench'],
    ['in_process', 'bench'],
    ['resulted', 'resulted'],
    ['communicated_to_patient', 'resulted'],
  ] as const)('%s reads as %s', (orderStatus, stage) => {
    expect(labBenchStage({ status: 'pending', orderStatus })).toBe(stage);
  });
});

describe('benchActionLabel', () => {
  it('names what the form will ask for: the specimen, then the result, then the report', () => {
    expect(benchActionLabel('ordered')).toBe('labFlow.nextCollect');
    expect(benchActionLabel('rejected_needs_recollection')).toBe('labFlow.nextCollect');
    for (const stage of ['specimen_collected', 'received_at_lab', 'in_process'] as const) {
      expect(benchActionLabel(stage)).toBe('labFlow.nextResult');
    }
    expect(benchActionLabel('resulted')).toBe('labFlow.nextReport');
  });
});

describe('isOutsideRequest', () => {
  it('covers outside and walk-in requests, never a clinician order', () => {
    expect(isOutsideRequest({ requestSource: 'external_facility' })).toBe(true);
    expect(isOutsideRequest({ requestSource: 'walk_in' })).toBe(true);
    expect(isOutsideRequest({ requestSource: 'facility' })).toBe(false);
    expect(isOutsideRequest({})).toBe(false);
  });
});
