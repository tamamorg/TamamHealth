'use client';

/**
 * Super-admin → Data Governance.
 * MPI duplicate review, facility completeness, and validity scanning —
 * everything computed client-side from the real patient/hospital stores on
 * a single load. No fabricated counts: every number here is derived from
 * getAllPatients()/useHospitals() or the conflicts API.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  SadbPage, SadbCard, SadbChip, SadbKvRow, SadbShell, SadbPanelHeader, useSadbTab,
} from '@/components/admin/sadb-ui';
import { SaTable } from '@/components/admin/sa-ui';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { apiFetch } from '@/lib/api-fetch';
import { getAllPatients } from '@/lib/services/patient-service';
import type { PatientDoc } from '@/lib/db-types';
import { ArrowRight, Copy, BarChart3, AlertTriangle, GitCompareArrows } from '@/components/icons/lucide';
import { useNow } from '@/lib/hooks/useNow';

const ROW_CAP = 50;

function patientName(p: PatientDoc): string {
  const name = [p.firstName, p.surname].filter(Boolean).join(' ').trim();
  return name || p.hospitalNumber || p._id;
}

function normPhone(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 ? digits : null;
}

interface DupPair {
  a: PatientDoc;
  b: PatientDoc;
  basis: string;
}

export default function AdminDataGovernancePage() {
  const router = useRouter();
  const { hospitals, loading: hospitalsLoading } = useHospitals();

  const [patients, setPatients] = useState<PatientDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingConflicts, setPendingConflicts] = useState<number | null>(null);
  const [conflictsError, setConflictsError] = useState(false);

  // Section switching is now URL-backed (?tab=) so every section is
  // deep-linkable, replacing the old page-local saside rail.
  const [activeSection, setActiveSection] = useSadbTab('duplicates');

  const loadPatients = useCallback(async () => {
    try {
      const all = await getAllPatients();
      setPatients(all);
    } catch (err) {
      console.error('Failed to load patients for data governance', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConflicts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/conflicts?status=pending');
      if (!res.ok) { setConflictsError(true); return; }
      const body = await res.json();
      setPendingConflicts(Array.isArray(body.conflicts) ? body.conflicts.length : 0);
      setConflictsError(false);
    } catch {
      setConflictsError(true);
    }
  }, []);

  useEffect(() => { loadPatients(); }, [loadPatients]);
  useEffect(() => { loadConflicts(); }, [loadConflicts]);

  const hospitalName = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hospitals) map.set(h._id, h.name);
    return map;
  }, [hospitals]);

  // ── Duplicate candidates: group by (surname+firstName+dob) OR identical phone ──
  // Known scale limit: this expands each match group pairwise (O(n²) within a
  // group), which is fine for the small groups a name/DOB or phone collision
  // produces but would not scale to a facility uploading a large duplicate
  // batch at once. Flagged, not fixed, here.
  const duplicates = useMemo<DupPair[]>(() => {
    const pairKeys = new Set<string>();
    const pairs: DupPair[] = [];

    const addGroupPairs = (group: PatientDoc[], basis: string) => {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const key = [group[i]._id, group[j]._id].sort().join('|');
          if (pairKeys.has(key)) continue;
          pairKeys.add(key);
          pairs.push({ a: group[i], b: group[j], basis });
        }
      }
    };

    const byNameDob = new Map<string, PatientDoc[]>();
    const byPhone = new Map<string, PatientDoc[]>();

    for (const p of patients) {
      const surname = (p.surname || '').trim().toLowerCase();
      const first = (p.firstName || '').trim().toLowerCase();
      const dob = (p.dateOfBirth || '').trim();
      if (surname && first && dob) {
        const key = `${surname}|${first}|${dob}`;
        const arr = byNameDob.get(key) || [];
        arr.push(p);
        byNameDob.set(key, arr);
      }
      const phone = normPhone(p.phone);
      if (phone) {
        const arr = byPhone.get(phone) || [];
        arr.push(p);
        byPhone.set(phone, arr);
      }
    }

    for (const group of byNameDob.values()) {
      if (group.length > 1) addGroupPairs(group, 'Name + DOB match');
    }
    for (const group of byPhone.values()) {
      if (group.length > 1) addGroupPairs(group, 'Same phone number');
    }

    return pairs;
  }, [patients]);

  // ── Missing / invalid value scan ──
  // The clock is an input, not something read mid-render: see useNow.
  const now = useNow();
  const validity = useMemo(() => {
    let missingDob = 0;
    let missingGender = 0;
    let missingPhone = 0;
    let futureDob = 0;
    let missingAny = 0;

    for (const p of patients) {
      let missing = false;
      if (!p.dateOfBirth) { missingDob++; missing = true; }
      else {
        const d = new Date(p.dateOfBirth).getTime();
        if (!Number.isNaN(d) && d > now) futureDob++;
      }
      if (p.gender !== 'Male' && p.gender !== 'Female') { missingGender++; missing = true; }
      if (!p.phone) { missingPhone++; missing = true; }
      if (missing) missingAny++;
    }

    return { missingDob, missingGender, missingPhone, futureDob, missingAny };
  }, [patients, now]);

  // ── Completeness by facility ──
  const completeness = useMemo(() => {
    const byHospital = new Map<string, PatientDoc[]>();
    for (const p of patients) {
      const hid = p.registrationHospital;
      if (!hid) continue;
      const arr = byHospital.get(hid) || [];
      arr.push(p);
      byHospital.set(hid, arr);
    }

    const rows = hospitals
      .map(h => {
        const list = byHospital.get(h._id) || [];
        const complete = list.filter(p => !!p.dateOfBirth && (p.gender === 'Male' || p.gender === 'Female') && !!p.phone).length;
        const score = list.length > 0 ? Math.round((complete / list.length) * 100) : null;
        return { hospitalId: h._id, name: h.name, total: list.length, complete, score };
      })
      .filter(r => r.total > 0)
      .sort((a, b) => (a.score ?? 100) - (b.score ?? 100));

    const belowThreshold = rows.filter(r => r.score !== null && r.score < 80).length;
    return { rows, belowThreshold };
  }, [patients, hospitals]);

  const busy = loading || hospitalsLoading;

  const railGroups = [{
    title: 'Data Governance',
    items: [
      { id: 'duplicates', label: 'Duplicate review', icon: Copy, count: busy ? '…' : duplicates.length },
      { id: 'completeness', label: 'Completeness', icon: BarChart3, count: busy ? '…' : completeness.rows.length },
      { id: 'invalid', label: 'Invalid values', icon: AlertTriangle, count: validity.missingAny },
      { id: 'reconciliation', label: 'Reconciliation', icon: GitCompareArrows, count: conflictsError ? 0 : pendingConflicts ?? '…' },
    ],
  }];

  return (
    <SadbPage>
      <SadbShell groups={railGroups} active={activeSection} onSelect={setActiveSection}>
        {activeSection === 'duplicates' && (
          <>
            <SadbPanelHeader
              title="Duplicate patient review (MPI)"
              note="Candidates from a matching name + date of birth, or a shared phone number. Review each pair before merging — nothing here merges automatically."
              tag={busy ? undefined : (duplicates.length > 0 ? `${duplicates.length} candidate pair${duplicates.length === 1 ? '' : 's'}` : 'No duplicates')}
              tagTone={busy ? undefined : (duplicates.length > 0 ? 'yellow' : 'green')}
            />
            <SadbCard meta={busy ? undefined : `${patients.length.toLocaleString()} patients scanned`}>
              <SaTable
                columns={[
                  { label: 'Patient A', w: 1.3 }, { label: 'Patient B', w: 1.3 },
                  { label: 'Match basis', w: 1.6 }, { label: 'Facility', w: 1.2 },
                ]}
                empty={busy ? 'Loading…' : 'No duplicate candidates detected.'}
                minWidth={680}
              >
                {duplicates.slice(0, ROW_CAP).map(({ a, b, basis }) => {
                  const facA = (a.registrationHospital && hospitalName.get(a.registrationHospital)) || a.registrationHospital || '—';
                  const facB = (b.registrationHospital && hospitalName.get(b.registrationHospital)) || b.registrationHospital || '—';
                  return (
                    <tr key={`${a._id}|${b._id}`}>
                      <td><strong>{patientName(a)}</strong> <span style={{ color: 'var(--text-muted)' }}>{a.hospitalNumber}</span></td>
                      <td><strong>{patientName(b)}</strong> <span style={{ color: 'var(--text-muted)' }}>{b.hospitalNumber}</span></td>
                      <td>{basis}</td>
                      <td>{facA === facB ? facA : `${facA} / ${facB}`}</td>
                    </tr>
                  );
                })}
              </SaTable>
              {!busy && duplicates.length > ROW_CAP && (
                <p className="sadb-card-meta" style={{ padding: '10px 14px', margin: 0, borderTop: '1px solid var(--border-light)' }}>
                  Showing first {ROW_CAP} of {duplicates.length}.
                </p>
              )}
            </SadbCard>
          </>
        )}

        {activeSection === 'completeness' && (
          <>
            <SadbPanelHeader
              title="Data completeness by facility"
              note="Scores registered patients that have a date of birth, gender, and phone on file."
              tag={busy ? undefined : (completeness.belowThreshold > 0 ? `${completeness.belowThreshold} below 80%` : 'All facilities ≥80%')}
              tagTone={busy ? undefined : (completeness.belowThreshold > 0 ? 'red' : 'green')}
            />
            <SadbCard meta={busy ? undefined : `${completeness.rows.length} facilities with patients`}>
              <SaTable
                columns={[
                  { label: 'Facility', w: 2.2 }, { label: 'Patients', w: 0.9 },
                  { label: 'Complete', w: 0.9 }, { label: 'Score', w: 0.9 },
                ]}
                empty={busy ? 'Loading…' : 'No facilities with registered patients yet.'}
                minWidth={520}
              >
                {completeness.rows.slice(0, ROW_CAP).map(r => (
                  <tr key={r.hospitalId}>
                    <td><strong>{r.name}</strong></td>
                    <td className="sa-num">{r.total}</td>
                    <td className="sa-num">{r.complete}</td>
                    <td className="sa-num">
                      <SadbChip tone={r.score! >= 90 ? 'green' : r.score! >= 70 ? 'yellow' : 'red'}>{r.score}%</SadbChip>
                    </td>
                  </tr>
                ))}
              </SaTable>
              {!busy && completeness.rows.length > ROW_CAP && (
                <p className="sadb-card-meta" style={{ padding: '10px 14px', margin: 0, borderTop: '1px solid var(--border-light)' }}>
                  Showing first {ROW_CAP} of {completeness.rows.length}.
                </p>
              )}
            </SadbCard>
          </>
        )}

        {activeSection === 'invalid' && (
          <>
            <SadbPanelHeader
              title="Invalid & missing values"
              note="Scans every patient record for a missing date of birth, gender, phone, or a date of birth in the future."
              tag={busy ? undefined : (validity.missingAny > 0 ? `${validity.missingAny} flagged` : 'No issues found')}
              tagTone={busy ? undefined : (validity.missingAny > 0 ? 'yellow' : 'green')}
            />
            <SadbCard meta={busy ? undefined : `${patients.length.toLocaleString()} records scanned`}>
              <SadbKvRow label="Missing date of birth" value={busy ? '—' : validity.missingDob} />
              <SadbKvRow label="Missing gender" value={busy ? '—' : validity.missingGender} />
              <SadbKvRow label="Missing phone" value={busy ? '—' : validity.missingPhone} />
              <SadbKvRow label="Future date of birth" value={busy ? '—' : validity.futureDob} />
            </SadbCard>
          </>
        )}

        {activeSection === 'reconciliation' && (
          <>
            <SadbPanelHeader
              title="Reconciliation & requests"
              note="Sync conflicts awaiting resolution, and any patient data export or deletion requests."
              tag={conflictsError ? 'Unavailable' : (busy ? undefined : ((pendingConflicts ?? 0) > 0 ? `${pendingConflicts} pending` : 'Clear'))}
              tagTone={conflictsError ? 'neutral' : ((pendingConflicts ?? 0) > 0 ? 'red' : 'green')}
            />
            <SadbCard>
              <SadbKvRow
                label="Pending sync conflicts"
                value={conflictsError ? '—' : pendingConflicts ?? '…'}
                valueTone={!conflictsError && (pendingConflicts ?? 0) > 0 ? 'warn' : undefined}
              />
              <div style={{ padding: '0 14px 14px' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push('/admin/conflicts')}>
                  Open reconciliation queue
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="sadb-kv">
                <span>Export / deletion requests</span>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'inherit', fontWeight: 600 }}>None — policy-gated, no request store configured</span>
              </div>
              <div style={{ padding: '14px 14px 0' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push('/admin/security')}>
                  Review data policy
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </SadbCard>
          </>
        )}
      </SadbShell>
    </SadbPage>
  );
}
