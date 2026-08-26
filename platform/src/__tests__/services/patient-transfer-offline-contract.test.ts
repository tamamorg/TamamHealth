import fs from 'node:fs';
import path from 'node:path';

const hookSource = fs.readFileSync(path.join(process.cwd(), 'src/lib/hooks/usePatientTransfers.ts'), 'utf8');
const pageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(dashboard)/transfers/page.tsx'), 'utf8');
const dockSource = fs.readFileSync(path.join(process.cwd(), 'src/modules/communication/components/MessagingDock.tsx'), 'utf8');
const serviceSource = fs.readFileSync(path.join(process.cwd(), 'src/lib/services/patient-transfer-service.ts'), 'utf8');

describe('patient transfer offline write boundary', () => {
  it('does not route browser mutations through the API', () => {
    expect(hookSource).not.toContain("fetch('/api/patient-transfers'");
    expect(pageSource).not.toContain("fetch('/api/patient-transfers'");
    expect(dockSource).not.toContain("fetch('/api/patient-transfers'");
  });

  it('uses the local domain service for request and state transitions', () => {
    expect(hookSource).toContain('svc.createTransferRequest({');
    expect(hookSource).toContain('svc.acceptTransfer(');
    expect(hookSource).toContain('svc.rejectTransfer(');
    expect(hookSource).toContain('svc.completeTransfer(');
  });

  it('marks every persisted transfer mutation pending for replication', () => {
    expect(serviceSource).toContain('withPendingOfflineSync({ ...doc');
    expect(serviceSource).toContain('withPendingOfflineSync(doc)');
  });
});
