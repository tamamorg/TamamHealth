'use client';

import type { OfflineCredentialClaims } from './offline-credential';

const STORAGE_KEY = 'tamamhealth.offline-session.v1';
const OFFLINE_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface StoredOfflineSession {
  claims: OfflineCredentialClaims;
  createdAt: string;
  expiresAt: string;
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isClaims(value: unknown): value is OfflineCredentialClaims {
  if (!value || typeof value !== 'object') return false;
  const claims = value as Partial<OfflineCredentialClaims>;
  return typeof claims._id === 'string'
    && typeof claims.username === 'string'
    && typeof claims.name === 'string'
    && typeof claims.role === 'string';
}

/**
 * Keep an authenticated browser session alive across a reload during an
 * outage. This is deliberately not a JWT and is never sent to the server.
 * Server APIs and CouchDB replication continue to require their httpOnly
 * server-issued sessions.
 */
export function startOfflineSession(claims: OfflineCredentialClaims): void {
  const target = storage();
  if (!target) return;
  const now = Date.now();
  const value: StoredOfflineSession = {
    claims,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OFFLINE_SESSION_TTL_MS).toISOString(),
  };
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A session that cannot be retained still works until this page reloads.
  }
}

export function readOfflineSession(): OfflineCredentialClaims | null {
  const target = storage();
  if (!target) return null;
  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredOfflineSession>;
    const expiresAt = Date.parse(parsed.expiresAt ?? '');
    if (!isClaims(parsed.claims) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      target.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.claims;
  } catch {
    return null;
  }
}

export function clearOfflineSession(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Already absent/unavailable.
  }
}

