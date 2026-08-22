import { redactUserForClient } from '@/modules/identity/services/user-service';
import type { UserDoc } from '@/lib/db-types';

describe('user API redaction', () => {
  it('never returns password or PIN verifiers', () => {
    const user: UserDoc = {
      _id: 'user-nurse',
      type: 'user',
      username: 'nurse',
      passwordHash: 'bcrypt-secret',
      pinHash: 'pin-secret',
      name: 'Nurse One',
      role: 'nurse',
      orgId: 'org-clinic',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const safe = redactUserForClient(user);
    expect(safe).toMatchObject({ _id: 'user-nurse', username: 'nurse', orgId: 'org-clinic' });
    expect(safe).not.toHaveProperty('passwordHash');
    expect(safe).not.toHaveProperty('pinHash');
  });

  it('strips what the retired second factor left on old documents', () => {
    // The authenticator is gone and `UserDoc` no longer declares these, so
    // nothing writes them and no destructure can name them — but a document
    // written while the feature existed still carries them. `totpSecret` is a
    // standing credential: anyone holding it can generate that account's codes
    // forever. Until `npm run db:strip-totp` has cleared storage, this strip is
    // the only thing between it and a response body.
    const legacy = {
      _id: 'user-admin',
      type: 'user',
      username: 'admin',
      passwordHash: 'bcrypt-secret',
      name: 'Org Admin',
      role: 'org_admin',
      orgId: 'org-clinic',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      totpRecoveryCodeHashes: ['deadbeef'],
      totpLastUsedStep: 58000000,
      totpEnabledAt: '2026-08-01T00:00:00.000Z',
    } as unknown as UserDoc;

    const safe = redactUserForClient(legacy) as Record<string, unknown>;
    for (const field of ['totpSecret', 'totpRecoveryCodeHashes', 'totpLastUsedStep', 'totpEnabledAt']) {
      expect(safe).not.toHaveProperty(field);
    }
    // The account itself still comes back — this strips credentials, not users.
    expect(safe).toMatchObject({ _id: 'user-admin', username: 'admin', role: 'org_admin' });
  });
});
