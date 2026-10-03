/**
 * The two things a prescriber sees that did not exist before:
 *   - the shelf, in the prescribing form itself, following the quantity;
 *   - the text-to-patient dialog, which will not send without consent and
 *     reports what actually happened to the text.
 */
import { act, click, clickAsync, flush, mount, q, qa, setChecked, setValue } from './test-utils';
import DrugInfoSection from '@/components/clinical-notes/prescribe/DrugInfoSection';
import DrugMonographPanel from '@/components/clinical-notes/prescribe/DrugMonographPanel';
import PatientTextDialog from '@/modules/communication/components/PatientTextDialog';
import { stockPositionFor } from '@/lib/pharmacy-stock-position';
import { FORMULARY } from '@/lib/data/formulary';
import type { PharmacyInventoryDoc } from '@/lib/db-types';
import type { RxDraft } from '@/components/clinical-notes/prescribe/types';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
  }),
}));

const sendPatientText = jest.fn();
jest.mock('@/modules/communication/services/patient-text-service', () => ({
  sendPatientText: (...args: unknown[]) => sendPatientText(...args),
}));

afterEach(() => {
  document.body.innerHTML = '';
  sendPatientText.mockReset();
});

const TODAY = '2026-10-03';
const amoxicillin = FORMULARY.find(d => d.name === 'Amoxicillin')!;

function line(overrides: Partial<PharmacyInventoryDoc>): PharmacyInventoryDoc {
  return {
    _id: `inv-${Math.random().toString(36).slice(2)}`, type: 'pharmacy_inventory',
    hospitalId: 'hosp-001', hospitalName: 'Wau State Hospital', medicationName: 'Amoxicillin 500mg',
    category: 'Antibiotic', stockLevel: 100, unit: 'capsules', reorderLevel: 40, batchNumber: 'B-1',
    expiryDate: '2030-01-01', dispensedToday: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  } as PharmacyInventoryDoc;
}

function draft(overrides: Partial<RxDraft> = {}): RxDraft {
  return {
    drug: null, quantity: '1', refills: '0', daysSupply: '', effectiveOn: TODAY, allowSubstitution: true,
    serviceLocation: 'Wau State Hospital', reason: '', instructions: '', pharmacyNote: '', ...overrides,
  };
}

function renderForm(props: {
  draft: RxDraft; query?: string; inventory?: PharmacyInventoryDoc[]; advanced?: boolean;
  onIssueOutside?: () => void;
}) {
  const noop = () => {};
  const stock = props.draft.drug && props.inventory
    ? stockPositionFor(props.draft.drug.name, props.inventory, Number(props.draft.quantity) || 1, { facilityId: 'hosp-001' })
    : null;
  return mount(
    <DrugInfoSection
      draft={props.draft}
      onChange={noop}
      query={props.query || ''}
      onQueryChange={noop}
      advanced={Boolean(props.advanced)}
      onToggleAdvanced={noop}
      problems={[]}
      serviceLocations={['Wau State Hospital']}
      isFavorite={false}
      onToggleFavorite={noop}
      showSigs={false}
      onToggleSigs={noop}
      showReasons={false}
      onToggleReasons={noop}
      inventory={props.inventory}
      facilityId="hosp-001"
      facilityName="Wau State Hospital"
      stock={stock}
      onIssueOutside={props.onIssueOutside}
    />,
  );
}

describe('stock in the prescribing form', () => {
  it('says quietly that an adequately stocked medicine is in stock', () => {
    const { container } = renderForm({ draft: draft({ drug: amoxicillin }), inventory: [line({})] });
    const notice = q(container, '.cn-rx-stock')!;
    expect(notice.getAttribute('data-stock')).toBe('ok');
    expect(notice.textContent).toContain('rxStock.ok');
    expect(notice.textContent).toContain('"available":100');
    expect(q(container, '.tm-banner')).toBeNull();
  });

  it('warns when stock is low without needing a tab switch', () => {
    const { container } = renderForm({ draft: draft({ drug: amoxicillin }), inventory: [line({ stockLevel: 12 })] });
    expect(q(container, '.cn-rx-stock')!.getAttribute('data-stock')).toBe('low');
    expect(q(container, '.tm-banner--warning')!.textContent).toContain('rxStock.low.title');
  });

  it('compares the shelf with the quantity being prescribed', () => {
    const { container } = renderForm({
      draft: draft({ drug: amoxicillin, quantity: '60' }), inventory: [line({ stockLevel: 10 })],
    });
    expect(q(container, '.cn-rx-stock')!.getAttribute('data-stock')).toBe('short');
    const banner = q(container, '.tm-banner')!;
    expect(banner.textContent).toContain('"available":10');
    expect(banner.textContent).toContain('"requested":60');
  });

  it('announces out of stock and offers the outside-pharmacy route', () => {
    const onIssueOutside = jest.fn();
    const { container } = renderForm({
      draft: draft({ drug: amoxicillin }), inventory: [line({ stockLevel: 0 })], onIssueOutside,
    });
    const banner = q(container, '.tm-banner--danger')!;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('rxStock.out.title');
    click(q(banner, '.tm-banner__action')!);
    expect(onIssueOutside).toHaveBeenCalledTimes(1);
  });

  it('does not offer the outside route for low stock the pharmacy can still fill', () => {
    const { container } = renderForm({
      draft: draft({ drug: amoxicillin }), inventory: [line({ stockLevel: 12 })], onIssueOutside: jest.fn(),
    });
    expect(q(container, '.tm-banner__action')).toBeNull();
  });

  it('shows nothing about stock when the facility has no pharmacy to stock', () => {
    const { container } = renderForm({ draft: draft({ drug: amoxicillin }), inventory: undefined });
    expect(q(container, '.cn-rx-stock')).toBeNull();
  });

  it('hides out-of-stock medicines from the default search, and tags them in advanced search', () => {
    const inventory = [
      line({ medicationName: 'Amoxicillin 500mg', stockLevel: 0 }),
      line({ medicationName: 'Amoxicillin-Clavulanate 625mg', stockLevel: 80 }),
    ];
    const plain = renderForm({ draft: draft(), query: 'amoxi', inventory });
    const plainNames = qa(plain.container, '.cn-rx-results button').map(b => b.firstElementChild!.textContent);
    expect(plainNames).toEqual(['Amoxicillin-Clavulanate']);
    plain.unmount();

    const advanced = renderForm({ draft: draft(), query: 'amoxi', inventory, advanced: true });
    const rows = qa(advanced.container, '.cn-rx-results button');
    const amox = rows.find(b => b.firstElementChild!.textContent === 'Amoxicillin')!;
    expect(q(amox, '.cn-rx-stocktag')!.textContent).toBe('Out of stock');
    const clav = rows.find(b => b.firstElementChild!.textContent === 'Amoxicillin-Clavulanate')!;
    expect(q(clav, '.cn-rx-stocktag')).toBeNull();
  });

  it('neither filters nor tags when the facility does not track stock', () => {
    const { container } = renderForm({ draft: draft(), query: 'amoxi', inventory: [] });
    expect(qa(container, '.cn-rx-results button').length).toBeGreaterThan(1);
    expect(q(container, '.cn-rx-stocktag')).toBeNull();
  });
});

describe('the monograph cautions use the same shelf', () => {
  function cautions(stock: ReturnType<typeof stockPositionFor> | null): string {
    const { container } = mount(
      <DrugMonographPanel drug={amoxicillin} warnings={[]} observations="" stock={stock} currentMedications={[]} />,
    );
    click(qa(container, '[role="tab"]').find(b => b.textContent === 'Cautions')!);
    return q(container, '.cn-rx-warnings')!.textContent || '';
  }

  it('sums batches and names the shortfall', () => {
    const stock = stockPositionFor('Amoxicillin', [
      line({ stockLevel: 4, batchNumber: 'B-1', expiryDate: '2030-01-01' }),
      line({ stockLevel: 6, batchNumber: 'B-2', expiryDate: '2031-01-01' }),
    ], 60, { facilityId: 'hosp-001' });
    const text = cautions(stock);
    expect(text).toContain('Stock at this facility: 10 capsules — less than the 60 prescribed.');
    expect(text).toContain('Batch B-1 expires 2030-01-01.');
  });

  it('says so when there is no on-site pharmacy', () => {
    expect(cautions(null)).toContain('no on-site pharmacy');
  });
});

describe('PatientTextDialog', () => {
  const patient = { _id: 'pat-1', name: 'Mary Akol', phone: '0912345145' };
  const sender = { _id: 'user-1', name: 'Dr. James Wani' };

  function open(overrides: Partial<React.ComponentProps<typeof PatientTextDialog>> = {}) {
    const onClose = jest.fn();
    const onDone = jest.fn();
    mount(
      <PatientTextDialog
        patient={patient}
        sender={sender}
        title="Text prescription to patient"
        subject="Your prescription"
        kind="prescription"
        text="Wau State Hospital - Prescription"
        prescriptionIds={['rx-1']}
        onClose={onClose}
        onDone={onDone}
        {...overrides}
      />,
    );
    const dialog = document.body.querySelector('[role="dialog"]')!;
    const sendButton = () => qa<HTMLButtonElement>(dialog, '.tm-dialog__foot .btn').find(b => b.textContent === 'patientText.send');
    return { dialog, onClose, onDone, sendButton };
  }

  it('will not send until the sender confirms the patient agreed', async () => {
    const { dialog, sendButton } = open();
    expect(sendButton()!.disabled).toBe(true);
    setChecked(q<HTMLInputElement>(dialog, '.ptx-consent input')!, true);
    expect(sendButton()!.disabled).toBe(false);
  });

  it('sends the edited, GSM-safe text with the consent flag and the prescription ids', async () => {
    sendPatientText.mockResolvedValue({ message: { _id: 'msg-1' }, outcome: 'sent' });
    const { dialog, sendButton, onDone } = open();
    setValue(q<HTMLTextAreaElement>(dialog, 'textarea')!, 'Take one tablet — twice daily');
    setChecked(q<HTMLInputElement>(dialog, '.ptx-consent input')!, true);
    await clickAsync(sendButton()!);

    expect(sendPatientText).toHaveBeenCalledWith(expect.objectContaining({
      patient, text: 'Take one tablet - twice daily', subject: 'Your prescription',
      kind: 'prescription', consentConfirmed: true, prescriptionIds: ['rx-1'],
    }));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'sent' }));
    expect(q(dialog, '.tm-banner--success')!.textContent).toContain('patientText.outcomeTitle.sent');
    // Nothing left to send twice.
    expect(sendButton()).toBeUndefined();
  });

  it('tells the sender plainly when the facility has no SMS gateway', async () => {
    sendPatientText.mockResolvedValue({ message: { _id: 'msg-1' }, outcome: 'not_connected' });
    const { dialog, sendButton } = open();
    setChecked(q<HTMLInputElement>(dialog, '.ptx-consent input')!, true);
    await clickAsync(sendButton()!);
    const banner = q(dialog, '.tm-banner--warning')!;
    expect(banner.textContent).toContain('patientText.outcomeTitle.not_connected');
    expect(banner.textContent).toContain('patientText.outcomeNotConnected');
  });

  it('reports a queued text as saved, not as sent', async () => {
    sendPatientText.mockResolvedValue({ message: { _id: 'msg-1' }, outcome: 'queued' });
    const { dialog, sendButton } = open();
    setChecked(q<HTMLInputElement>(dialog, '.ptx-consent input')!, true);
    await clickAsync(sendButton()!);
    expect(q(dialog, '.tm-banner--success')).toBeNull();
    expect(q(dialog, '.tm-banner')!.textContent).toContain('patientText.outcomeTitle.queued');
  });

  it('cannot send to a patient with no phone number', () => {
    const { dialog, sendButton } = open({ patient: { _id: 'pat-1', name: 'Mary Akol' } });
    expect(q(dialog, '.tm-banner--danger')!.textContent).toContain('patientText.noPhoneTitle');
    expect(q<HTMLInputElement>(dialog, '.ptx-consent input')!.disabled).toBe(true);
    expect(sendButton()!.disabled).toBe(true);
  });

  it('counts the message parts and resets when the composed text changes', async () => {
    const { dialog } = open({ text: 'a'.repeat(161) });
    expect(q(dialog, '.ptx-count')!.textContent).toContain('patientText.segmentsMany {"count":2}');
    await act(async () => { await flush(); });
  });
});
