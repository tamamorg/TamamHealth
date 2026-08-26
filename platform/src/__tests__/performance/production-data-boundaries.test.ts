import fs from 'node:fs';
import path from 'node:path';
import { CRITICAL_TRANSLATIONS } from '@/lib/i18n/critical-translations';

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');

describe('production data and bundle boundaries', () => {
  it.each([
    ['lib/services/triage-service.ts', 'getTriageByPatient'],
    ['lib/services/immunization-service.ts', 'getByPatient'],
    ['lib/services/problem-service.ts', 'getProblemsByPatient'],
    ['lib/services/referral-service.ts', 'getReferralsByPatient'],
    ['lib/services/prescription-service.ts', 'getPrescriptionsByPatient'],
  ])('%s keeps %s on an indexed patient selector', (file, functionName) => {
    const text = source(file);
    const start = text.indexOf(`function ${functionName}`);
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, text.indexOf('\n}', start) + 2);
    expect(body).toContain('{ patientId }');
    expect(body).toContain("['type', 'patientId']");
    expect(body).not.toMatch(/await getAll[A-Za-z]+/);
  });

  it('does not mount closed-dock staff and message-body reads', () => {
    const dock = source('modules/communication/components/MessagingDock.tsx');
    expect(dock).toContain('useStaffChat({ enabled, messagesEnabled: open })');
    expect(dock).toContain('useUsers(enabled && open)');

    const hook = source('lib/hooks/useStaffChat.ts');
    expect(hook).toContain('if (!enabled) return;');
    expect(hook).toContain('messagesEnabled && activeId');
  });

  it('keeps patient chart workspaces behind dynamic tab/action boundaries', () => {
    const chart = source('components/patients/PatientDetailPage.tsx');
    for (const component of ['BillingTab', 'LabWorkspace', 'PharmacyWorkspace', 'PatientTimeline']) {
      expect(chart).toMatch(new RegExp(`const ${component} = dynamic\\(`));
      expect(chart).not.toMatch(new RegExp(`import ${component} from`));
    }
  });

  it('bounds billing encounter history and defers claims/payment panels', () => {
    const billing = source('components/payments/BillingWorkspace.tsx');
    expect(billing).toContain('getEncountersClosedSince');
    expect(billing).not.toContain('getAllEncounters(scope)');
    expect(billing).toContain("dynamic(() => import('@/components/payments/ClaimsPanel'))");
    expect(billing).toContain("dynamic(() => import('@/components/payments/PaymentPanel'))");
  });

  it('keeps every sign-in label usable before a lazy locale chunk is available', () => {
    const login = source('app/login/page.tsx');
    const literalKeys = [...login.matchAll(/t\('(login\.[^']+)'/g)].map(match => match[1]);
    const keys = new Set([
      ...literalKeys,
      'login.shotAdminAlt',
      'login.shotMinistryAlt',
      'login.shotStaffAlt',
    ]);
    for (const locale of ['en', 'apd'] as const) {
      for (const key of keys) expect(CRITICAL_TRANSLATIONS[locale][key]).toBeTruthy();
    }
  });
});
