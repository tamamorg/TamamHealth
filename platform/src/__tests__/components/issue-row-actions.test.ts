import { issueRowActions } from '@/modules/communication/components/IssueReportsQueue';
import { ISSUE_NEXT_STEP, issueStepIndex } from '@/modules/communication/issue-rules';

const t = (key: string) => key;
const moves = (status: string) => issueRowActions({ issueStatus: status as never }, 'u1', t).filter(o => !o.group).map(o => o.value);

it('steps run Reported → Acknowledged → In progress → Resolved → Closed', () => {
  expect(['new', 'acknowledged', 'in_progress', 'resolved'].map(s => ISSUE_NEXT_STEP[s as 'new']!.to)).toEqual(['acknowledged', 'in_progress', 'resolved', 'closed']);
  expect(ISSUE_NEXT_STEP.closed).toBeNull();
  expect(issueStepIndex('in_progress')).toBe(2);
});

it('the pill offers the next step, a close, and reopen once finished', () => {
  expect(moves('new')).toEqual(['acknowledged', 'closed']);
  expect(moves('in_progress')).toEqual(['resolved', 'closed']);
  expect(moves('resolved')).toEqual(['closed', 'in_progress']);
  expect(moves('closed')).toEqual(['in_progress']);
});

it('always offers to open the issue, and assignment when it is not already mine', () => {
  const all = issueRowActions({ issueStatus: 'new' as never, issueAssignedToId: 'u2' }, 'u1', t).map(o => o.value);
  expect(all).toEqual(expect.arrayContaining(['__assign-me', '__unassign', '__open']));
});
