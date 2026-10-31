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
import {
  getAllPatients, isMarkedDuplicate, markPatientDuplicate, clearPatientDuplicate,
} from '@/lib/services/patient-service';
import { PATIENT_DUPLICATE_ROLES } from '@/lib/sync/write-permissions';
import type { PatientDoc } from '@/lib/db-types';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import FormField from '@/components/overlay/FormField';
import { FormError } from '@/components/overlay/FormNotices';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import { formatDateTime } from '@/lib/format-utils';
import { ArrowRight, Copy, BarChart3, AlertTriangle, GitCompareArrows } from '@/components/icons/lucide';
import { useNow } from '@/lib/hooks/useNow';
import { useDataScope } from '@/lib/hooks/useDataScope';

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
  const scope = useDataScope();

  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  // Every record in scope, duplicates included; `patients` below is the set the
  // scans run on, so a linked duplicate stops being a candidate or a count.
  const [allPatients, setAllPatients] = useState<PatientDoc[]>([]);
  const patients = useMemo(() => allPatients.filter(p => !isMarkedDuplicate(p)), [allPatients]);
  const linked = useMemo(() => allPatients.filter(isMarkedDuplicate), [allPatients]);
  const canMark = !!currentUser && PATIENT_DUPLICATE_ROLES.includes(currentUser.role);
  const [marking, setMarking] = useState<DupPair | null>(null);
  const [keepId, setKeepId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingConflicts, setPendingConflicts] = useState<number | null>(null);
  const [conflictsError, setConflictsError] = useState(false);

  // Section switching is now URL-backed (?tab=) so every section is
  // deep-linkable, replacing the old page-local saside rail.
  const [activeSection, setActiveSection] = useSadbTab('duplicates');

  const loadPatients = useCallback(async () => {
    if (!scope) return;
    try {
      const all = await getAllPatients(scope, { includeDuplicates: true });
      setAllPatients(all);
    } catch (err) {
      console.error('Failed to load patients for data governance', err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

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
      if (!p.gender) { missingGender++; missing = true; }
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
        const complete = list.filter(p => !!p.dateOfBirth && !!p.gender && !!p.phone).length;
        const score = list.length > 0 ? Math.round((complete / list.length) * 100) : null;
        return { hospitalId: h._id, name: h.name, total: list.length, complete, score };
      })
      .filter(r => r.total > 0)
      .sort((a, b) => (a.score ?? 100) - (b.score ?? 100));

    const belowThreshold = rows.filter(r => r.score !== null && r.score < 80).length;
    return { rows, belowThreshold };
  }, [patients, hospitals]);

  const busy = loading || hospitalsLoading;

  const openMark = (pair: DupPair) => { setMarking(pair); setKeepId(pair.a._id); setReason(''); setMarkError(null); };
  const closeMark = () => { if (!saving) setMarking(null); };
  const actor = () => ({ id: currentUser?._id, name: currentUser?.name || currentUser?.username, role: currentUser!.role });

  const confirmMark = async () => {
    if (!marking || !scope || !currentUser) return;
    const duplicate = keepId === marking.a._id ? marking.b : marking.a;
    setSaving(true);
    setMarkError(null);
    try {
      await markPatientDuplicate(duplicate._id, keepId, reason, actor(), scope);
      showToast(t('dup.marked', { name: patientName(duplicate) }), 'success');
      setMarking(null);
      await loadPatients();
    } catch (err) {
      setMarkError(describeError(err, t('msg.changeNotSavedTryAgain')));
    } finally {
      setSaving(false);
    }
  };

  const undoLink = async (p: PatientDoc) => {
    if (!scope || !currentUser) return;
    try {
      await clearPatientDuplicate(p._id, actor(), scope);
      showToast(t('dup.undone', { name: patientName(p) }), 'success');
      await loadPatients();
    } catch (err) {
      showToast(describeError(err, t('dup.notUndone')), 'error');
    }
  };

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
              title={t('dup.panelTitle')}
              note={t('dup.panelNote')}
              tag={busy ? undefined : (duplicates.length > 0 ? `${duplicates.length} candidate pair${duplicates.length === 1 ? '' : 's'}` : 'No duplicates')}
              tagTone={busy ? undefined : (duplicates.length > 0 ? 'yellow' : 'green')}
            />
            <SadbCard meta={busy ? undefined : `${patients.length.toLocaleString()} patients scanned`}>
              <SaTable
                columns={[
                  { label: 'Patient A', w: 1.3 }, { label: 'Patient B', w: 1.3 },
                  { label: 'Match basis', w: 1.6 }, { label: 'Facility', w: 1.2 },
                  ...(canMark ? [{ label: '', w: 1 }] : []),
                ]}
                empty={busy ? 'Loading…' : 'No duplicate candidates detected.'}
                minWidth={680}
              >
                {duplicates.slice(0, ROW_CAP).map((pair) => {
                  const { a, b, basis } = pair;
                  const facA = (a.registrationHospital && hospitalName.get(a.registrationHospital)) || a.registrationHospital || '—';
                  const facB = (b.registrationHospital && hospitalName.get(b.registrationHospital)) || b.registrationHospital || '—';
                  return (
                    <tr key={`${a._id}|${b._id}`}>
                      <td><strong>{patientName(a)}</strong> <span style={{ color: 'var(--text-muted)' }}>{a.hospitalNumber}</span></td>
                      <td><strong>{patientName(b)}</strong> <span style={{ color: 'var(--text-muted)' }}>{b.hospitalNumber}</span></td>
                      <td>{basis}</td>
                      <td>{facA === facB ? facA : `${facA} / ${facB}`}</td>
                      {canMark && (
                        <td>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openMark(pair)}>
                            {t('dup.mark')}
                          </button>
                        </td>
                      )}
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

            <SadbCard title={t('dup.linkedTitle')} meta={busy ? undefined : t('dup.linkedMeta', { count: linked.length })}>
              <SaTable
                columns={[
                  { label: t('dup.colDuplicate'), w: 1.3 }, { label: t('dup.colKept'), w: 1.3 },
                  { label: t('dup.colReason'), w: 1.6 }, { label: t('dup.colMarked'), w: 1.2 },
                  ...(canMark ? [{ label: '', w: 0.8 }] : []),
                ]}
                empty={busy ? 'Loading…' : t('dup.noneLinked')}
                minWidth={680}
              >
                {linked.map(p => {
                  const kept = allPatients.find(x => x._id === p.duplicateOf);
                  return (
                    <tr key={p._id}>
                      <td><strong>{patientName(p)}</strong> <span style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber}</span></td>
                      <td>
                        {kept
                          ? <><strong>{patientName(kept)}</strong> <span style={{ color: 'var(--text-muted)' }}>{kept.hospitalNumber}</span></>
                          : <span style={{ color: 'var(--text-muted)' }}>{p.duplicateOf}</span>}
                      </td>
                      <td>{p.duplicateReason || '—'}</td>
                      <td>
                        {p.duplicateMarkedAt ? formatDateTime(p.duplicateMarkedAt) : '—'}
                        {p.duplicateMarkedByName ? <span style={{ color: 'var(--text-muted)' }}> {p.duplicateMarkedByName}</span> : null}
                      </td>
                      {canMark && (
                        <td>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => undoLink(p)}>
                            {t('dup.undo')}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </SaTable>
            </SadbCard>

            {marking && (
              <Modal onClose={closeMark} size="sm" labelledBy="dup-mark-title" describedBy="dup-mark-desc">
                <DialogFrame busy={saving}>
                  <DialogHeader titleId="dup-mark-title" title={t('dup.dialogTitle')} onClose={closeMark} />
                  <DialogBody tight>
                    <p id="dup-mark-desc">{t('dup.dialogIntro')}</p>
                    <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
                      <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t('dup.keepLabel')}</legend>
                      {[marking.a, marking.b].map(p => (
                        <label key={p._id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', textTransform: 'none' }}>
                          <input
                            type="radio"
                            name="dup-keep"
                            checked={keepId === p._id}
                            onChange={() => setKeepId(p._id)}
                          />
                          <span>{t('dup.keepOption', { name: patientName(p), number: p.hospitalNumber || '—' })}</span>
                        </label>
                      ))}
                    </fieldset>
                    <FormField id="dup-mark-reason" label={t('dup.reasonLabel')} required className="mt-3">
                      {control => (
                        <input
                          {...control}
                          data-modal-initial-focus
                          className="fs-input"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder={t('dup.reasonPlaceholder')}
                        />
                      )}
                    </FormField>
                    <p className="mt-3" style={{ color: 'var(--text-muted)' }}>{t('dup.notMoved')}</p>
                    {markError && <FormError message={markError} />}
                  </DialogBody>
                  <DialogFooter>
                    <button type="button" className="btn btn-secondary" disabled={saving} onClick={closeMark}>
                      {t('dup.cancel')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={saving || reason.trim().length === 0}
                      onClick={confirmMark}
                    >
                      {saving ? t('dup.saving') : t('dup.confirm')}
                    </button>
                  </DialogFooter>
                </DialogFrame>
              </Modal>
            )}
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
