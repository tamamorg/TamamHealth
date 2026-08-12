import { redactUserForClient } from '@/lib/services/user-service';
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
});
