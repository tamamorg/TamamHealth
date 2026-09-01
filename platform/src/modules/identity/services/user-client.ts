import { apiFetch } from '@/lib/api-fetch';
import type { UserDoc, UserRole } from '@/lib/db-types';
import type { InvitationOutcome } from '@/modules/identity/provisioning/invite-window';

export interface CreateClientUserData {
  username: string;
  password: string;
  name: string;
  role: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  facilityIds?: string[];
  orgId?: string;
  photoUrl?: string;
  department?: string;
  specialty?: string;
  phone?: string;
  email?: string;
}

async function usersRequest(
  payload: object,
): Promise<Record<string, unknown>> {
  const response = await apiFetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'User action failed');
  }
  return body;
}

export async function getClientUserById(id: string): Promise<UserDoc | null> {
  const response = await apiFetch('/api/users', { cache: 'no-store' });
  const body = await response.json().catch(() => ({})) as { users?: UserDoc[]; error?: string };
  if (!response.ok) throw new Error(body.error || 'Unable to load user');
  return body.users?.find(user => user._id === id) ?? null;
}

export async function createClientUserWithInvitation(
  data: CreateClientUserData,
): Promise<{ user: UserDoc; invitation: InvitationOutcome }> {
  const body = await usersRequest(data);
  return {
    user: body.user as UserDoc,
    invitation: (body.invitation as InvitationOutcome | undefined) ?? { sent: false, reason: 'send_failed' },
  };
}

export async function updateClientUser(userId: string, changes: Partial<UserDoc>): Promise<UserDoc> {
  const body = await usersRequest({ action: 'update', userId, ...changes });
  return body.user as UserDoc;
}

export async function resetClientUserPassword(userId: string, newPassword: string): Promise<void> {
  await usersRequest({ action: 'reset_password', userId, newPassword });
}

export async function resendClientUserInvite(userId: string): Promise<InvitationOutcome | undefined> {
  const body = await usersRequest({ action: 'resend_invite', userId });
  return body.invitation as InvitationOutcome | undefined;
}

export async function setClientUserActive(userId: string, active: boolean): Promise<void> {
  await usersRequest({ action: active ? 'reactivate' : 'deactivate', userId });
}

export async function deleteClientUser(userId: string): Promise<void> {
  await usersRequest({ action: 'delete', userId });
}
