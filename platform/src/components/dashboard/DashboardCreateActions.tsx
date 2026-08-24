'use client';

/**
 * The create actions that sit at the right of an ADMIN dashboard's greeting.
 *
 * One definition for both admin boards — the super-admin command center and
 * the org/facility management dashboard — so the two can never offer a
 * different answer to "what can this person create?". Each entry is gated by
 * the same helper the rest of the app gates on (`canCreateFacilities`,
 * `canCreateUsers`), never by a role list written out again here: a role added
 * to one of those helpers picks the button up automatically.
 *
 * Every target is the management workspace's own create deep-link (`&new=1`),
 * which is where these dialogs actually live. Nothing is duplicated — the
 * button opens the same form the workspace's own "Add" button opens.
 *
 * Deliberately create-only. Edit and deactivate belong to the record, and are
 * reached from its row in the registry, not from a dashboard header.
 */

import { useRouter } from 'next/navigation';
import { Plus } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { canCreateFacilities, canCreateUsers } from '@/lib/people-nav';

interface CreateAction {
  key: string;
  label: string;
  href: string;
  /** The one primary button, if any — the action that role opens most. */
  primary?: boolean;
}

/**
 * What the signed-in role may create, most-consequential first.
 *
 * Organizations are super-admin only: an org admin creating a tenant would be
 * creating the thing that scopes them.
 */
export function dashboardCreateActions(role: string | undefined): CreateAction[] {
  if (!role) return [];
  return [
    ...(role === 'super_admin'
      ? [{ key: 'organization', label: 'Create organization', href: '/manage?view=organizations&new=1', primary: true }]
      : []),
    ...(canCreateFacilities(role)
      ? [{ key: 'facility', label: 'Add facility', href: '/manage?view=facilities&new=1', primary: role !== 'super_admin' }]
      : []),
    ...(canCreateUsers(role)
      ? [{ key: 'staff', label: 'Add staff member', href: '/manage?view=people&new=1' }]
      : []),
  ];
}

export default function DashboardCreateActions() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const actions = dashboardCreateActions(currentUser?.role);

  if (actions.length === 0) return null;

  return (
    <>
      {actions.map(action => (
        <button
          key={action.key}
          type="button"
          className={`btn btn-sm ${action.primary ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => router.push(action.href)}
          data-action={`dashboard-create-${action.key}`}
        >
          <Plus className="w-4 h-4" /> {action.label}
        </button>
      ))}
    </>
  );
}
