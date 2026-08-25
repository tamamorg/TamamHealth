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
 * Each button opens its dialog ON the dashboard. They used to route to the
 * management workspace's create deep-link (`/manage?...&new=1`) and let that
 * screen open the dialog, which took an operator off the board they were
 * reading to create one record and left them on a list afterwards. The forms
 * are still not duplicated — `TenancyCreateDialogs` hosts the very components
 * the workspace hosts.
 *
 * Deliberately create-only. Edit and deactivate belong to the record, and are
 * reached from its row in the registry, not from a dashboard header.
 */

import { useState } from 'react';
import { Plus } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { canCreateFacilities, canCreateUsers } from '@/lib/people-nav';
import { TenancyCreateDialogs, type TenancyCreateKind } from '@/modules/tenancy/client';

interface CreateAction {
  /** Doubles as the dialog this button opens. */
  key: TenancyCreateKind;
  label: string;
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
      ? [{ key: 'organization', label: 'Create organization', primary: true } as CreateAction]
      : []),
    ...(canCreateFacilities(role)
      ? [{ key: 'facility', label: 'Add facility', primary: role !== 'super_admin' } as CreateAction]
      : []),
    ...(canCreateUsers(role)
      ? [{ key: 'staff', label: 'Add staff member' } as CreateAction]
      : []),
  ];
}

export default function DashboardCreateActions() {
  const { currentUser } = useAuth();
  const actions = dashboardCreateActions(currentUser?.role);
  const [open, setOpen] = useState<TenancyCreateKind | null>(null);

  if (actions.length === 0) return null;

  return (
    <>
      {actions.map(action => (
        <button
          key={action.key}
          type="button"
          className={`btn btn-sm ${action.primary ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setOpen(action.key)}
          data-action={`dashboard-create-${action.key}`}
        >
          <Plus className="w-4 h-4" /> {action.label}
        </button>
      ))}
      {/* Keyed by kind so a different button always mounts a fresh dialog
          rather than re-using the last one's step and presets. */}
      {open && <TenancyCreateDialogs key={open} kind={open} onDone={() => setOpen(null)} />}
    </>
  );
}
