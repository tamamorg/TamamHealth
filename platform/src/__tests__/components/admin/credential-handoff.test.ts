/**
 * @jest-environment node
 *
 * `formatCredentialHandoffText` — the exact text the "Copy credentials"
 * button (components/admin/CredentialHandoffModal.tsx) places on the
 * clipboard. This is the one piece of that panel worth covering directly:
 * the actual text an operator pastes into a handover message/ticket after
 * creating a user or an organization's first admin.
 */
import { formatCredentialHandoffText } from '@/modules/identity/components/CredentialHandoffModal';

describe('formatCredentialHandoffText', () => {
  it('includes both the username and password on separate labeled lines', () => {
    const text = formatCredentialHandoffText('grace.ayen', 'Tr0ub4dor&3');
    expect(text).toBe('Username: grace.ayen\nTemporary password: Tr0ub4dor&3');
  });

  it('does not silently drop unusual characters in the password', () => {
    const text = formatCredentialHandoffText('u', 'p@ss w/ spaces & symbols!');
    expect(text).toContain('p@ss w/ spaces & symbols!');
  });
});
