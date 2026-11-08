import { formatAuditAction } from '@/components/admin/sa-ui';

describe('formatAuditAction', () => {
  it('prints an action code as plain words', () => {
    expect(formatAuditAction('login_success')).toBe('Login success');
    expect(formatAuditAction('SHIFT_HANDOFF_SIGNED')).toBe('Shift handoff signed');
    expect(formatAuditAction('user.deactivated')).toBe('User deactivated');
  });
  it('copes with empty input', () => {
    expect(formatAuditAction('')).toBe('');
    expect(formatAuditAction(undefined)).toBe('');
  });
});
