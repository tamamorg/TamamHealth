import { accountRequestsDB } from '../db';
import type { AccountRequestDoc, UserRole } from '../db-types';
import { findByType } from './db-query';

export interface CreateAccountRequestInput {
  applicantName: string;
  email: string;
  phone?: string;
  requestedRole: UserRole;
  organizationId?: string;
  organizationName?: string;
  organizationSlug?: string;
  organizationCountry?: string;
  facilityId?: string;
  facilityName?: string;
  message?: string;
}

export async function getAccountRequests(): Promise<AccountRequestDoc[]> {
  return findByType<AccountRequestDoc>(accountRequestsDB(), 'account_request');
}

export async function createAccountRequest(input: CreateAccountRequestInput): Promise<AccountRequestDoc> {
  const db = accountRequestsDB();
  const now = new Date().toISOString();
  const email = input.email.trim().toLowerCase();
  const existing = (await getAccountRequests()).find(r =>
    r.status === 'pending' && r.email === email && r.organizationId === input.organizationId &&
    r.requestedRole === input.requestedRole,
  );
  if (existing) return existing;
  const doc: AccountRequestDoc = {
    ...input,
    email,
    applicantName: input.applicantName.trim(),
    type: 'account_request',
    status: 'pending',
    reviewerRole: input.requestedRole === 'org_admin' ? 'super_admin' : 'org_admin',
    _id: `account-request-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };
  const response = await db.put(doc);
  doc._rev = response.rev;
  return doc;
}

export async function updateAccountRequest(id: string, patch: Partial<AccountRequestDoc>): Promise<AccountRequestDoc> {
  const db = accountRequestsDB();
  const current = await db.get(id) as AccountRequestDoc;
  const next = { ...current, ...patch, _id: current._id, _rev: current._rev, updatedAt: new Date().toISOString() };
  const response = await db.put(next);
  next._rev = response.rev;
  return next;
}
