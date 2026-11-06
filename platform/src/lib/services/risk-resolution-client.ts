'use client';
/**
 * Browser-side write path for Risk Center resolutions.
 *
 * risk_resolution docs live in the pull-only `tamamhealth_platform_config`
 * database, so a browser write to the local copy never replicates up. These
 * wrappers POST to /api/risk-resolution instead; the server writes the
 * canonical doc and replication carries it down to every device (security/data
 * audit 2026-11-05, §2.1 #11). The actor is stamped server-side from the auth
 * claim, so it is not sent from here.
 *
 * Reads (getRiskResolutions, indexResolutions, isRiskResolved) stay in
 * risk-resolution-service — they read the local replica and need no server call.
 */
import type { ResolveRiskInput } from './risk-resolution-service';
import type { RiskResolutionDoc } from '../db-types';

async function postRisk<T>(payload: Record<string, unknown>): Promise<T> {
  const { apiFetch } = await import('../api-fetch');
  const res = await apiFetch('/api/risk-resolution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Risk resolution not saved (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

export async function resolveRisk(input: ResolveRiskInput): Promise<RiskResolutionDoc> {
  const { resolution } = await postRisk<{ resolution: RiskResolutionDoc }>({ action: 'resolve', input });
  return resolution;
}

export async function resolveRisks(inputs: ResolveRiskInput[]): Promise<{ resolved: RiskResolutionDoc[]; failed: number }> {
  return postRisk<{ resolved: RiskResolutionDoc[]; failed: number }>({ action: 'resolve-batch', inputs });
}

export async function reopenRisk(riskId: string): Promise<void> {
  await postRisk<{ ok: true }>({ action: 'reopen', riskId });
}
