import { click, mount, qa, setChecked, setValue } from '../clinical-notes/test-utils';
import EhrVisitPopup, { EhrQueueMoveDialog } from '@/components/ehr/EhrVisitPopup';
import EhrVisitActionDialog from '@/components/ehr/EhrVisitActionDialog';
import { returnedToDeskItems } from '@/modules/communication/notifications/visit-updates';
import type { QueueEntry } from '@/lib/services/patient-queue-service';
import type { EncounterDoc, TriageDoc } from '@/lib/db-types';

// Keys as text: the assertions name the action, not a translation of it.
jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/hooks/useMedicalRecords', () => ({
  useMedicalRecords: () => ({ records: [] }),
}));
jest.mock('@/components/Modal', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div data-modal>{children}</div>,
}));

const triage = {
  _id: 'triage-1', patientId: 'pat-1', patientName: 'Test User', status: 'pending',
  priority: 'RED', triagedAt: '2026-09-19T12:00:00.000Z', triagedByName: 'Nurse Achol',
  encounterId: 'enc-1',
} as unknown as TriageDoc;

const entry = {
  patientId: 'pat-1', patientName: 'Test User', stage: 'awaiting_rooming', acuity: 'RED',
  enteredStageAt: '2026-09-19T12:00:00.000Z', minutesWaiting: 1, targetWaitMinutes: 10,
  score: 1, flaggedForReassessment: false, triageId: 'triage-1',
} as QueueEntry;

const handlers = () => ({
  onClose: jest.fn(), onMove: jest.fn(), onOpenChart: jest.fn(), onStartTriage: jest.fn(),
  onEscalate: jest.fn(), onLwbs: jest.fn(), onReturnToDesk: jest.fn(), onCreateNote: jest.fn(),
});

function renderPopup(overrides: Partial<React.ComponentProps<typeof EhrVisitPopup>> = {}) {
  const fns = handlers();
  const mounted = mount(
    <EhrVisitPopup
      inline
      patientId="pat-1"
      name="Test User"
      acuity="RED"
      wait="1 min"
      appointment={null}
      triage={triage}
      entry={entry}
      {...fns}
      {...overrides}
    />,
  );
  const line = mounted.container.querySelector('.ehr-visit-pop-actions')!;
  const lineLabels = () => qa<HTMLButtonElement>(line, 'button').map(b => b.textContent?.trim() || b.getAttribute('aria-label') || '');
  const openMore = () => {
    click(line.querySelector('.ehr-visit-more-trigger')!);
    return qa<HTMLButtonElement>(document.body, '.ehr-visit-more-menu [role="menuitem"]');
  };
  return { ...mounted, fns, line, lineLabels, openMore };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('visit panel action line', () => {
  it('keeps only the forward actions on the line, with More last — after the note button', () => {
    const { line, lineLabels } = renderPopup();

    const labels = lineLabels();
    expect(labels).toContain('Open chart');
    for (const gone of ['Escalate', 'LWBS', 'Return to desk', 'Review triage']) {
      expect(labels.some(label => label.includes(gone))).toBe(false);
    }
    expect(line.querySelector('[aria-label="Move to another queue"]')).toBeNull();

    const controls = Array.from(line.children);
    const note = controls.findIndex(el => el.classList.contains('cn-split'));
    const more = controls.findIndex(el => el.classList.contains('ehr-visit-more-trigger'));
    expect(note).toBeGreaterThanOrEqual(0);
    expect(more).toBeGreaterThan(note);
  });

  it('moves the row\'s actions under More, in order, and runs the one chosen', () => {
    const { fns, openMore } = renderPopup();

    const items = openMore();
    expect(items.map(item => item.querySelector('strong')?.textContent)).toEqual([
      'visitActions.move',
      'visitActions.reviewTriage',
      'visitActions.returnToDesk',
      'visitActions.lwbs',
    ]);

    click(items[3]);
    expect(fns.onLwbs).toHaveBeenCalledTimes(1);
    // Choosing closes the menu.
    expect(document.body.querySelector('.ehr-visit-more-menu')).toBeNull();
  });

  it('does not repeat Escalate beside Move — the Move entry says it carries it', () => {
    const { openMore } = renderPopup();

    const items = openMore();
    expect(items.some(item => item.textContent?.includes('visitActions.escalate'))).toBe(false);
    expect(items[0].textContent).toContain('visitActions.moveHintEscalate');
  });

  it('still offers escalation when there is no Move to carry it (patient in consultation)', () => {
    const { fns, openMore } = renderPopup({ entry: null });

    const items = openMore();
    const labels = items.map(item => item.querySelector('strong')?.textContent);
    expect(labels).not.toContain('visitActions.move');
    expect(labels).toContain('visitActions.escalate');

    click(items[labels.indexOf('visitActions.escalate')]);
    expect(fns.onEscalate).toHaveBeenCalledTimes(1);
  });

  it('keeps "Start triage" on the line for an untriaged arrival', () => {
    const { lineLabels, openMore } = renderPopup({ triage: null, entry: null, onEscalate: undefined, onLwbs: undefined, onReturnToDesk: undefined });

    expect(lineLabels()).toContain('Start triage');
    // Nothing is left for More, so it does not draw an empty menu.
    expect(document.body.querySelector('.ehr-visit-more-trigger')).toBeNull();
    expect(openMore).toThrow();
  });

  it('draws the same menu whatever role is signed in — it is built from handlers, not roles', () => {
    const doctor = renderPopup();
    const doctorItems = doctor.openMore().map(item => item.textContent);
    doctor.unmount();
    document.body.innerHTML = '';

    // A nurse's dashboard grants the same handlers minus consultation verbs.
    const nurse = renderPopup({ onCall: undefined, onAcknowledge: undefined });
    expect(nurse.openMore().map(item => item.textContent)).toEqual(doctorItems);
  });
});

describe('move dialog — emergency care as a destination', () => {
  it('offers the escalation only when the visit can be escalated', () => {
    const plain = mount(<EhrQueueMoveDialog entry={entry} saving={false} onClose={jest.fn()} onMove={jest.fn()} />);
    expect(plain.container.querySelector('.ehr-queue-move-option--escalate')).toBeNull();
  });

  it('escalates with the comment and never calls onMove', () => {
    const onMove = jest.fn();
    const onEscalate = jest.fn();
    const { container } = mount(
      <EhrQueueMoveDialog entry={entry} saving={false} onClose={jest.fn()} onMove={onMove} onEscalate={onEscalate} />,
    );

    setChecked(container.querySelector<HTMLInputElement>('.ehr-queue-move-option--escalate input')!, true);

    // Priority is moot for a visit leaving the queue, and the consequence is stated.
    expect(container.querySelector('.ehr-queue-move-priorities')).toBeNull();
    expect(container.querySelector('.ehr-queue-move-escalate-note')).not.toBeNull();

    setValue(container.querySelector<HTMLTextAreaElement>('textarea')!, '  SpO2 dropping  ');
    const commit = container.querySelector<HTMLButtonElement>('.ehr-queue-move-footer button.primary')!;
    expect(commit.className).toContain('danger');
    click(commit);

    expect(onEscalate).toHaveBeenCalledWith('SpO2 dropping');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('goes back to an ordinary move when another destination is picked', () => {
    const onMove = jest.fn();
    const { container } = mount(
      <EhrQueueMoveDialog entry={entry} saving={false} onClose={jest.fn()} onMove={onMove} onEscalate={jest.fn()} />,
    );
    setChecked(container.querySelector<HTMLInputElement>('.ehr-queue-move-option--escalate input')!, true);
    const rooming = container.querySelectorAll<HTMLInputElement>('input[name="queue-destination"]')[0];
    setChecked(rooming, true);

    expect(container.querySelector('.ehr-queue-move-priorities')).not.toBeNull();
    expect(container.querySelector('.ehr-queue-move-footer button.primary')!.className).not.toContain('danger');
  });

  it('lets a visit parked on open orders be escalated without a lone, un-unpickable radio', () => {
    const parked = { ...entry, stage: 'awaiting_lab' } as QueueEntry;
    const { container } = mount(
      <EhrQueueMoveDialog entry={parked} saving={false} onClose={jest.fn()} onMove={jest.fn()} onEscalate={jest.fn()} />,
    );
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="queue-destination"]');
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
  });
});

describe('visit action dialog — one shape for every exit under More', () => {
  it.each(['return_to_desk', 'lwbs', 'escalate'] as const)('%s uses the Move dialog kit', kind => {
    const { container } = mount(
      <EhrVisitActionDialog kind={kind} patientName="Test User" saving={false} onClose={jest.fn()} onConfirm={jest.fn()} />,
    );
    expect(container.querySelector('.ehr-queue-move .ehr-queue-move-head h3')).not.toBeNull();
    expect(container.querySelector('.ehr-queue-move-comment textarea')).not.toBeNull();
    expect(container.querySelectorAll('.ehr-queue-move-footer button')).toHaveLength(2);
  });

  it('records the picked reason, then the comment', () => {
    const onConfirm = jest.fn();
    const { container } = mount(
      <EhrVisitActionDialog kind="return_to_desk" patientName="Test User" saving={false} onClose={jest.fn()} onConfirm={onConfirm} />,
    );
    setChecked(container.querySelectorAll<HTMLInputElement>('input[name="visit-action-reason"]')[1], true);
    setValue(container.querySelector<HTMLTextAreaElement>('textarea')!, 'back after lunch');
    click(container.querySelector('.ehr-queue-move-footer button.primary')!);

    expect(onConfirm).toHaveBeenCalledWith('visitActions.reasonRebook — back after lunch');
  });

  it('marks only the actions that close the visit as danger, and confirms with no reason given', () => {
    const onConfirm = jest.fn();
    const lwbs = mount(
      <EhrVisitActionDialog kind="lwbs" patientName="Test User" saving={false} onClose={jest.fn()} onConfirm={onConfirm} />,
    );
    const commit = lwbs.container.querySelector<HTMLButtonElement>('.ehr-queue-move-footer button.primary')!;
    expect(commit.className).toContain('danger');
    click(commit);
    expect(onConfirm).toHaveBeenCalledWith('');

    const back = mount(
      <EhrVisitActionDialog kind="return_to_desk" patientName="Test User" saving={false} onClose={jest.fn()} onConfirm={jest.fn()} />,
    );
    expect(back.container.querySelector('.ehr-queue-move-footer button.primary')!.className).not.toContain('danger');
  });

  it('cannot be committed twice while saving', () => {
    const { container } = mount(
      <EhrVisitActionDialog kind="lwbs" patientName="Test User" saving onClose={jest.fn()} onConfirm={jest.fn()} />,
    );
    expect(container.querySelector<HTMLButtonElement>('.ehr-queue-move-footer button.primary')!.disabled).toBe(true);
  });
});

describe('reception feed — a visit closed as LWBS lands on the desk too', () => {
  const now = Date.parse('2026-09-19T13:00:00.000Z');
  const lwbs = {
    _id: 'enc-1', patientId: 'pat-1', patientName: 'Test User Person', status: 'lwbs',
    statusHistory: [
      { from: null, to: 'awaiting_triage', at: '2026-09-19T12:00:00.000Z', byUserId: 'desk' },
      { from: 'awaiting_triage', to: 'lwbs', at: '2026-09-19T12:30:00.000Z', byUserId: 'user-dr.wani', reason: 'Could not wait' },
    ],
    updatedAt: '2026-09-19T12:30:00.000Z',
  } as unknown as EncounterDoc;

  it('tells reception, with the clinician\'s reason', () => {
    const items = returnedToDeskItems([lwbs], { _id: 'user-desk.amira', role: 'front_desk' }, now, 10);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('Left without being seen');
    expect(items[0].subtitle).toBe('Could not wait');
    expect(items[0].href).toBe('/patients/pat-1');
  });

  it('stays off clinical feeds and off the feed of the clerk who closed it', () => {
    expect(returnedToDeskItems([lwbs], { _id: 'user-dr.wani', role: 'doctor' }, now, 10)).toHaveLength(0);
    expect(returnedToDeskItems([lwbs], { _id: 'user-dr.wani', role: 'front_desk' }, now, 10)).toHaveLength(0);
  });

  it('ages out with the closure window', () => {
    const later = now + 4 * 24 * 60 * 60 * 1000;
    expect(returnedToDeskItems([lwbs], { _id: 'user-desk.amira', role: 'front_desk' }, later, 10)).toHaveLength(0);
  });
});
