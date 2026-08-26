import { getAvailableRoles } from '@/lib/permissions';
import { canonicalizeUserRole } from '@/lib/user-role';
import { resolveRole } from '@/modules/identity/provisioning/bulk-user-import';

describe('nurse role consolidation', () => {
  it.each(['midwife', 'triage_nurse', 'rooming_nurse'] as const)(
    'normalizes the legacy %s role to nurse',
    role => expect(canonicalizeUserRole(role)).toBe('nurse'),
  );

  it('does not offer retired nursing roles for new assignments', () => {
    for (const roles of [getAvailableRoles('public', true), getAvailableRoles('private')]) {
      expect(roles).toContain('nurse');
      expect(roles).not.toContain('midwife');
      expect(roles).not.toContain('triage_nurse');
      expect(roles).not.toContain('rooming_nurse');
    }
  });

  it.each(['midwife', 'triage nurse', 'rooming nurse'])(
    'imports the old label "%s" as nurse',
    label => expect(resolveRole(label)).toBe('nurse'),
  );
});
