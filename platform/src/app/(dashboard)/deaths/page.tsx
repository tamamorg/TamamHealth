'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PatientName from '@/components/PatientName';
import { useDeaths } from '@/lib/hooks/useDeaths';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientAge } from '@/lib/patient-utils';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import { toIsoDate, todayIso } from '@/lib/date-utils';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import Modal from '@/components/Modal';

// Shared control styling inside the header's Filters popover.
const filterFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;
import { Plus, Search, X, FileText, ChevronDown, ChevronUp, UserCheck, ExternalLink } from '@/components/icons/lucide';
import Select from '@/components/Select';

export default function DeathsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { deaths, register } = useDeaths();
  const { hospitals } = useHospitals();
  const { patients } = usePatients();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { canRecordVitalEvents } = usePermissions();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const deathFromQueryRef = useRef(false);
  // Per-column filters (replace the old search + gender top bar).
  const [colFilters, setColFilters] = useState({ certificate: '', name: '', sex: '', age: '', cause: '', manner: '', facility: '', registered: '' });
  const setColFilter = (k: string, v: string) => setColFilters(f => ({ ...f, [k]: v }));
  const ageBandOf = (age: number | null) => age == null ? null : age < 18 ? 'child' : age < 65 ? 'adult' : 'elderly';
  const [showForm, setShowForm] = useState(false);
  const [expandedDeath, setExpandedDeath] = useState<string | null>(null);
  const [patientLookup, setPatientLookup] = useState('');
  const [linkedPatientId, setLinkedPatientId] = useState<string | undefined>(undefined);
  // The visit this death closes, when registering from an open encounter
  // (?patientId=&encounterId=) — e.g. the ward or consultation flow.
  const [encounterId, setEncounterId] = useState<string | undefined>(undefined);
  const [form, setForm] = useState({
    deceasedFirstName: '', deceasedSurname: '', deceasedGender: 'Male' as 'Male' | 'Female',
    dateOfBirth: '', dateOfDeath: todayIso(), ageAtDeath: 0,
    placeOfDeath: '', facilityId: '', facilityName: '',
    immediateCause: '', immediateICD11: '', antecedentCause1: '', antecedentICD11_1: '',
    antecedentCause2: '', antecedentICD11_2: '', underlyingCause: '', underlyingICD11: '',
    contributingConditions: '', contributingICD11: '',
    mannerOfDeath: 'natural' as const, maternalDeath: false, pregnancyRelated: false,
    certifiedBy: '', certifierRole: '', state: '', county: '', certificateNumber: '',
    deathNotified: true, deathRegistered: false,
  });

  const patientMatches = useMemo(() => {
    if (!patientLookup || patientLookup.length < 2) return [];
    const q = patientLookup.toLowerCase();
    return (patients || [])
      .filter(p => !p.isDeceased && (
        // Sex and registration state came off the Filters popover, so they
        // belong in what a search matches — otherwise "female" and
        // "registered" would have stopped narrowing anything.
        `${p.firstName} ${p.surname} ${p.gender || ''}`.toLowerCase().includes(q) ||
        (p.hospitalNumber || '').toLowerCase().includes(q)
      ))
      .slice(0, 6);
  }, [patientLookup, patients]);

  // Auto-link if the user types an EXACT hospital number — saves a click in
  // the typical CRVS workflow where the death is recorded immediately after
  // the patient's last vital sign and the hospital number is known.
  useEffect(() => {
    if (linkedPatientId || !patientLookup || patientLookup.length < 4) return;
    const exact = (patients || []).find(p =>
      !p.isDeceased && (p.hospitalNumber || '').toLowerCase() === patientLookup.trim().toLowerCase()
    );
    if (exact) {
      selectLinkedPatient(exact._id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientLookup, patients]);

  // Deep link (?patientId=&encounterId=): open the registration form
  // pre-filled with the patient this death closes out — e.g. from the ward
  // or a consultation — and carry the open visit through so a successful
  // registration can close it (see handleSubmit).
  useEffect(() => {
    const qPatientId = searchParams?.get('patientId');
    if (!qPatientId || deathFromQueryRef.current) return;
    if (!(patients || []).some(p => p._id === qPatientId)) return;
    deathFromQueryRef.current = true;
    selectLinkedPatient(qPatientId);
    setEncounterId(searchParams?.get('encounterId') || undefined);
    setShowForm(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, patients]);

  const filtered = (deaths || []).filter(d => {
    const f = colFilters;
    if (f.certificate && !(d.certificateNumber || '').toLowerCase().includes(f.certificate.toLowerCase())) return false;
    if (f.name && !`${d.deceasedFirstName} ${d.deceasedSurname}`.toLowerCase().includes(f.name.toLowerCase())) return false;
    if (f.sex && d.deceasedGender !== f.sex) return false;
    if (f.age && ageBandOf(d.ageAtDeath) !== f.age) return false;
    if (f.cause && !`${d.underlyingICD11 || ''} ${d.underlyingCause || ''} ${d.immediateCause || ''}`.toLowerCase().includes(f.cause.toLowerCase())) return false;
    if (f.manner && !(d.mannerOfDeath || '').replace(/_/g, ' ').toLowerCase().includes(f.manner.toLowerCase())) return false;
    if (f.facility && !(d.facilityName || '').toLowerCase().includes(f.facility.toLowerCase())) return false;
    if (f.registered && (f.registered === 'yes') !== !!d.deathRegistered) return false;
    return true;
  });

  // Header stat chips — computed from data already loaded on this page,
  // unaffected by the column filters (same as the patients header).
  const thisMonthPrefix = new Date().toISOString().slice(0, 7);
  const deathStats = useMemo(() => {
    const all = deaths || [];
    return {
      total: all.length,
      thisMonth: all.filter(d => d.dateOfDeath?.startsWith(thisMonthPrefix)).length,
      certified: all.filter(d => !!d.certifiedBy).length,
      uncertified: all.filter(d => !d.certifiedBy).length,
    };
  }, [deaths, thisMonthPrefix]);

  // `width` is a share normalised against the row total below — sized to the
  // content each column carries, so Cause of death (free text) doesn't take
  // the row on auto layout while Sex and Age sit narrower than their labels.
  const deathCols = [
    { key: 'certificate', label: t('deaths.colCertificate'), width: 12 },
    { key: 'deceased', label: t('deaths.colDeceased'), width: 16 },
    { key: 'sex', label: t('nurse.colGender'), width: 7 },
    { key: 'age', label: t('deaths.colAge'), width: 6 },
    { key: 'dateOfDeath', label: t('deaths.colDateOfDeath'), width: 11 },
    { key: 'cause', label: t('deaths.colCause'), width: 17 },
    { key: 'manner', label: t('deaths.colManner'), width: 10 },
    { key: 'facility', label: t('deaths.colFacility'), width: 12 },
    { key: 'registered', label: t('deaths.colRegistered'), width: 9 },
  ];
  const deathColTotal = deathCols.reduce((sum, c) => sum + c.width, 0);

  const handleSubmit = async () => {
    if (!form.deceasedFirstName.trim() || !form.deceasedSurname.trim() || !form.dateOfDeath || !form.immediateCause.trim()) {
      showToast(t('patientNew.toastFillRequired'), 'error');
      return;
    }
    const fac = hospitals.find(h => h._id === (form.facilityId || currentUser?.hospitalId));
    // An encounter id is a URL-borne claim, not a fact: verify it belongs to
    // the patient this death is being registered FOR (and to this org/
    // facility) before it is stamped on the certificate or driven to a
    // terminal status. A stale param surviving an unlink/patient-swap used to
    // close a different — living — patient's visit as deceased.
    let verifiedEncounterId: string | undefined;
    if (encounterId && linkedPatientId) {
      try {
        const { resolvePatientEncounter } = await import('@/lib/services/encounter-service');
        const enc = await resolvePatientEncounter(encounterId, linkedPatientId, scope);
        verifiedEncounterId = enc?._id;
      } catch { /* unverifiable → treated as absent */ }
    }
    try {
      await register({
        ...form,
        patientId: linkedPatientId,
        encounterId: verifiedEncounterId,
        facilityId: fac?._id || currentUser?.hospitalId || '',
        facilityName: fac?.name || currentUser?.hospitalName || '',
        state: fac?.state || form.state,
        certifiedBy: form.certifiedBy || currentUser?.name || '',
        certificateNumber: form.certificateNumber || `SS-D-${Date.now().toString(36).toUpperCase()}`,
      });
      showToast(t('deaths.registeredSuccess'), 'success');
      setShowForm(false);

      // Death closes the visit (best-effort — the death record above is
      // already the CRVS source of truth; neither of these can be allowed
      // to make registration itself look like it failed).
      if (verifiedEncounterId) {
        try {
          const { transitionEncounter } = await import('@/lib/services/encounter-service');
          await transitionEncounter(verifiedEncounterId, 'deceased', {
            actorId: currentUser?._id,
            actorRole: currentUser?.role,
          });
        } catch (err) {
          console.warn('[deaths] could not close the encounter (death was registered):', err);
        }
      }
      if (linkedPatientId) {
        try {
          const { getAppointmentsByPatient, updateAppointmentStatus } = await import('@/lib/services/appointment-service');
          const today = toIsoDate(new Date());
          const upcoming = (await getAppointmentsByPatient(linkedPatientId))
            .filter(a => (a.status === 'scheduled' || a.status === 'confirmed') && a.appointmentDate >= today);
          for (const appt of upcoming) {
            await updateAppointmentStatus(appt._id, 'cancelled', {
              cancelledReason: 'Patient deceased',
              actorId: currentUser?._id,
              actorName: currentUser?.name,
            });
          }
        } catch (err) {
          console.warn('[deaths] could not cancel future appointments (death was registered):', err);
        }
      }

      setLinkedPatientId(undefined);
      setEncounterId(undefined);
      setPatientLookup('');
    } catch {
      showToast(t('deaths.registerFailed'), 'error');
    }
  };

  const selectLinkedPatient = (patientId: string) => {
    const p = patients.find(x => x._id === patientId);
    if (!p) return;
    setLinkedPatientId(p._id);
    // A visit link belongs to the patient it arrived with — never carry it
    // onto a manually-picked one. (The deep-link effect re-sets it right
    // after this call for the patient it named.)
    setEncounterId(undefined);
    setPatientLookup('');
    // Pre-fill the form with the patient's known data
    const dob = p.dateOfBirth || '';
    const ageAtDeath = patientAge(p) ?? 0;
    setForm(f => ({
      ...f,
      deceasedFirstName: p.firstName || f.deceasedFirstName,
      deceasedSurname: p.surname || f.deceasedSurname,
      deceasedGender: (p.gender as 'Male' | 'Female') || f.deceasedGender,
      dateOfBirth: dob || f.dateOfBirth,
      ageAtDeath: ageAtDeath || f.ageAtDeath,
      state: p.state || f.state,
      county: p.county || f.county,
    }));
  };

  const ICD11Select = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <div>
      <label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <Select value={value} onChange={e => onChange(e.target.value)} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}>
        <option value="">{t('deaths.selectIcd11')}</option>
        {COMMON_ICD11_CODES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.title}</option>)}
      </Select>
    </div>
  );

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* Table */}
        <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('deaths.title')}
            stats={[
              { label: 'Registered', value: deathStats.total, color: LIST_STAT_COLORS.muted },
              { label: 'This month', value: deathStats.thisMonth, color: LIST_STAT_COLORS.blue },
              { label: 'Certified', value: deathStats.certified, color: LIST_STAT_COLORS.amber },
              { label: 'Uncertified', value: deathStats.uncertified, color: LIST_STAT_COLORS.green },
            ]}
            search={{ value: colFilters.name, onChange: v => setColFilter('name', v), placeholder: t('deaths.searchPlaceholder') || 'Search by name, certificate, cause…', ariaLabel: t('deaths.searchPlaceholder') || 'Search deaths' }}
            actions={
              <>
                {canRecordVitalEvents && (
                  <button data-tour="register-death-btn" onClick={() => setShowForm(true)} className="btn btn-primary flex items-center gap-2" style={{ height: 38, whiteSpace: 'nowrap' }}>
                    <Plus className="w-4 h-4" /> {t('deaths.registerDeath')}
                  </button>
                )}
              </>
            }
          />
          <div className="ehr-list-scroll">
          <table className="data-table" style={{ minWidth: 1040, tableLayout: 'fixed' }}>
            <colgroup>
              {deathCols.map(c => (
                <col key={c.key} style={{ width: `${(c.width / deathColTotal * 100).toFixed(2)}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {deathCols.map(c => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d._id} className="cursor-pointer hover:bg-[var(--table-row-hover)]" onClick={() => setExpandedDeath(expandedDeath === d._id ? null : d._id)}>
                  <td className="font-mono text-xs">{d.certificateNumber}</td>
                  <td><PatientName patientId={d.patientId} name={`${d.deceasedFirstName} ${d.deceasedSurname}`} gender={d.deceasedGender} nameClassName="text-sm font-semibold" /></td>
                  <td className="text-sm">{d.deceasedGender}</td>
                  <td className="text-sm">{d.ageAtDeath < 1 ? t('deaths.neonate') : `${d.ageAtDeath}y`}</td>
                  <td className="text-xs font-mono">{d.dateOfDeath}</td>
                  <td>
                    <div>
                      {d.underlyingICD11 && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded me-1" style={{ background: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger-text)' }}>{d.underlyingICD11}</span>}
                      <span className="text-xs">{d.underlyingCause || d.immediateCause}</span>
                    </div>
                  </td>
                  <td className="text-xs capitalize">{(d.mannerOfDeath || '').replace(/_/g, ' ')}</td>
                  <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{(d.facilityName || '').replace(' Hospital', '').replace(' Teaching', '')}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <span className={`badge text-[10px] ${d.deathRegistered ? 'badge-normal' : 'badge-warning'}`}>
                        {d.deathRegistered ? t('deaths.yes') : t('deaths.no')}
                      </span>
                      {expandedDeath === d._id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {d.patientId && (
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--overlay-subtle)]"
                          title={`Open ${d.deceasedFirstName} ${d.deceasedSurname}'s chart`}
                          aria-label={`Open ${d.deceasedFirstName} ${d.deceasedSurname}'s chart`}
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/patients/${d.patientId}?tab=history`);
                          }}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {expandedDeath && (() => {
                const d = filtered.find(x => x._id === expandedDeath);
                if (!d) return null;
                return (
                  <tr>
                    <td colSpan={9} style={{ background: 'var(--overlay-subtle)', padding: 0 }}>
                      <div className="p-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('deaths.fullName')}</span>{d.deceasedFirstName} {d.deceasedSurname}</div>
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('deaths.gender')}</span>{d.deceasedGender}</div>
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('deaths.dateOfBirth')}</span>{d.dateOfBirth || t('deaths.na')}</div>
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('deaths.placeOfDeath')}</span>{d.placeOfDeath || d.facilityName}</div>
                        </div>
                        <hr className="section-divider" />
                        <div className="p-3 rounded-lg" style={{ background: 'rgba(224, 49, 39,0.06)', border: '1px solid rgba(224, 49, 39,0.15)' }}>
                          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-danger-text)' }}>{t('deaths.causeChain')}</p>
                          <div className="data-row-divider-sm text-xs">
                            <p><span className="font-semibold">{t('deaths.causeImmediate')}</span> {d.immediateCause} {d.immediateICD11 && <span className="font-mono text-[10px] px-1 rounded" style={{ background: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger-text)' }}>{d.immediateICD11}</span>}</p>
                            {d.antecedentCause1 && <p><span className="font-semibold">{t('deaths.causeDueTo')}</span> {d.antecedentCause1} {d.antecedentICD11_1 && <span className="font-mono text-[10px] px-1 rounded" style={{ background: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger-text)' }}>{d.antecedentICD11_1}</span>}</p>}
                            {d.antecedentCause2 && <p><span className="font-semibold">{t('deaths.causeDueToC')}</span> {d.antecedentCause2} {d.antecedentICD11_2 && <span className="font-mono text-[10px] px-1 rounded" style={{ background: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger-text)' }}>{d.antecedentICD11_2}</span>}</p>}
                            {d.underlyingCause && <p><span className="font-semibold">{t('deaths.causeUnderlying')}</span> {d.underlyingCause} {d.underlyingICD11 && <span className="font-mono text-[10px] px-1 rounded" style={{ background: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger-text)' }}>{d.underlyingICD11}</span>}</p>}
                            {d.contributingConditions && <p><span className="font-semibold">{t('deaths.causeContributing')}</span> {d.contributingConditions}</p>}
                          </div>
                        </div>
                        <hr className="section-divider" />
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('deaths.colManner')}</span><span className="capitalize">{(d.mannerOfDeath || '').replace(/_/g, ' ')}</span></div>
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('deaths.maternalDeath')}</span>{d.maternalDeath ? t('deaths.yes') : t('deaths.no')}</div>
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('deaths.certifiedBy')}</span>{d.certifiedBy || t('deaths.na')} ({d.certifierRole || t('deaths.na')})</div>
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('deaths.location')}</span>{d.county || t('deaths.na')}, {d.state}</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
          </div>
        </div>

        {/* Death Registration Form Modal */}
        {showForm && (
          <Modal onClose={() => setShowForm(false)} width={768} labelledBy="death-registration-title">
            <div className="modal-panel w-full overflow-y-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <div className="flex items-center gap-2"><FileText className="w-5 h-5" style={{ color: 'var(--color-danger)' }} /><h2 id="death-registration-title" className="font-semibold">{t('deaths.modalTitle')}</h2></div>
                <button onClick={() => setShowForm(false)}><X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} /></button>
              </div>
              <div className="p-4 space-y-4">
                {/* Link to existing patient (optional) */}
                <div className="rounded-lg p-3" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33, 145, 208,0.2))' }}>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--accent-primary)' }}>
                    <UserCheck className="w-3 h-3" />
                    {t('deaths.linkPatient')}
                  </label>
                  {linkedPatientId ? (
                    (() => {
                      const lp = patients.find(p => p._id === linkedPatientId);
                      return (
                        <div className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                          <div className="text-xs">
                            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{lp?.firstName} {lp?.surname}</p>
                            <p style={{ color: 'var(--text-muted)' }}>{lp?.hospitalNumber} · {lp?.gender}{lp?.estimatedAge ? ` · ${lp.estimatedAge}y` : ''}</p>
                          </div>
                          <button onClick={() => { setLinkedPatientId(undefined); setEncounterId(undefined); }} className="text-[10px] font-semibold" style={{ color: 'var(--accent-primary)' }}>{t('deaths.unlink')}</button>
                        </div>
                      );
                    })()
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                        <input
                          type="text"
                          value={patientLookup}
                          onChange={e => setPatientLookup(e.target.value)}
                          placeholder={t('deaths.searchPatientPlaceholder')}
                          className="w-full text-xs p-2 ps-8 rounded-lg outline-none"
                          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      {patientMatches.length > 0 && (
                        <div className="mt-1.5 rounded-lg overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                          {patientMatches.map(p => (
                            <button
                              key={p._id}
                              onClick={() => selectLinkedPatient(p._id)}
                              className="w-full px-2.5 py-2 text-start text-xs hover:bg-[var(--overlay-subtle)] transition-colors"
                              style={{ borderBottom: '1px solid var(--border-light)' }}
                            >
                              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{p.firstName} {p.surname}</p>
                              <p style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber} · {p.gender}{p.estimatedAge ? ` · ${p.estimatedAge}y` : ''}</p>
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                        {t('deaths.linkHint')}
                      </p>
                    </>
                  )}
                </div>

                <hr className="section-divider" />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('deaths.deceasedInfo')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><label className="field-required text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.firstNameRequired')}</label><input type="text" required value={form.deceasedFirstName} onChange={e => setForm({ ...form, deceasedFirstName: e.target.value })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }} /></div>
                  <div><label className="field-required text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.surname')}</label><input type="text" required value={form.deceasedSurname} onChange={e => setForm({ ...form, deceasedSurname: e.target.value })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }} /></div>
                  <div><label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.gender')}</label><Select value={form.deceasedGender} onChange={e => setForm({ ...form, deceasedGender: e.target.value as 'Male' | 'Female' })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}><option value="Male">{t('deaths.male')}</option><option value="Female">{t('deaths.female')}</option></Select></div>
                  <div><label className="field-required text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.colDateOfDeath')}</label><input type="date" required value={form.dateOfDeath} onChange={e => setForm({ ...form, dateOfDeath: e.target.value })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }} /></div>
                  <div><label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.ageAtDeath')}</label><input type="number" value={form.ageAtDeath} onChange={e => setForm({ ...form, ageAtDeath: Number(e.target.value) })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }} /></div>
                  <div><label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.mannerOfDeath')}</label><Select value={form.mannerOfDeath} onChange={e => setForm({ ...form, mannerOfDeath: e.target.value as typeof form.mannerOfDeath })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}><option value="natural">{t('deaths.mannerNatural')}</option><option value="accident">{t('deaths.mannerAccident')}</option><option value="intentional_self_harm">{t('deaths.mannerSelfHarm')}</option><option value="assault">{t('deaths.mannerAssault')}</option><option value="pending_investigation">{t('deaths.mannerPending')}</option><option value="unknown">{t('deaths.mannerUnknown')}</option></Select></div>
                </div>

                <hr className="section-divider" />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('deaths.causeChainWhoFormat')}</h3>
                <div data-tour="death-cause-chain" className="p-3 rounded-lg space-y-3" style={{ background: 'rgba(224, 49, 39,0.05)', border: '1px solid rgba(224, 49, 39,0.15)' }}>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="field-required text-xs font-bold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.lineAImmediate')}</label><input type="text" required value={form.immediateCause} onChange={e => setForm({ ...form, immediateCause: e.target.value })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }} placeholder={t('deaths.lineAImmediatePlaceholder')} /></div>
                    <ICD11Select value={form.immediateICD11} onChange={v => setForm({ ...form, immediateICD11: v })} label={t('deaths.icd11LineA')} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs font-bold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.lineBDueTo')}</label><input type="text" value={form.antecedentCause1} onChange={e => setForm({ ...form, antecedentCause1: e.target.value })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }} /></div>
                    <ICD11Select value={form.antecedentICD11_1} onChange={v => setForm({ ...form, antecedentICD11_1: v })} label={t('deaths.icd11LineB')} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs font-bold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.lineCDueTo')}</label><input type="text" value={form.antecedentCause2} onChange={e => setForm({ ...form, antecedentCause2: e.target.value })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }} /></div>
                    <ICD11Select value={form.antecedentICD11_2} onChange={v => setForm({ ...form, antecedentICD11_2: v })} label={t('deaths.icd11LineC')} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs font-bold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.lineDUnderlying')}</label><input type="text" value={form.underlyingCause} onChange={e => setForm({ ...form, underlyingCause: e.target.value })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }} /></div>
                    <ICD11Select value={form.underlyingICD11} onChange={v => setForm({ ...form, underlyingICD11: v })} label={t('deaths.icd11LineD')} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs font-bold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.contributingConditions')}</label><input type="text" value={form.contributingConditions} onChange={e => setForm({ ...form, contributingConditions: e.target.value })} className="w-full p-2 rounded-lg text-sm outline-none" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }} /></div>
                    <ICD11Select value={form.contributingICD11} onChange={v => setForm({ ...form, contributingICD11: v })} label={t('deaths.icd11Contributing')} />
                  </div>
                </div>

                <div className="flex items-center gap-6 pt-2">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.maternalDeath} onChange={e => setForm({ ...form, maternalDeath: e.target.checked })} /> {t('deaths.maternalDeathCheckbox')}</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.pregnancyRelated} onChange={e => setForm({ ...form, pregnancyRelated: e.target.checked })} /> {t('deaths.pregnancyRelated')}</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.deathNotified} onChange={e => setForm({ ...form, deathNotified: e.target.checked })} /> {t('deaths.deathNotified')}</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.deathRegistered} onChange={e => setForm({ ...form, deathRegistered: e.target.checked })} /> {t('deaths.deathRegistered')}</label>
                </div>
              </div>
              <div className="flex justify-end gap-3 p-4 border-t" style={{ borderColor: 'var(--border-light)' }}>
                <button onClick={() => setShowForm(false)} className="btn btn-secondary btn-sm">{t('action.cancel')}</button>
                <button onClick={handleSubmit} className="btn btn-primary btn-sm" style={{ opacity: !form.deceasedFirstName.trim() || !form.deceasedSurname.trim() || !form.dateOfDeath || !form.immediateCause.trim() ? 0.5 : 1 }}>{t('deaths.registerDeath')}</button>
              </div>
            </div>
          </Modal>
        )}
    </main>
  );
}
