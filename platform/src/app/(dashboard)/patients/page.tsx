'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { patientFullName, patientDisplayName, patientAgeLabel, patientAge } from '@/lib/patient-utils';
import EhrPageTitle from '@/components/ehr/EhrPageTitle';
import PatientAvatar from '@/components/patients/PatientAvatar';
import { ScanLine, Hash, X, ArrowRight, Download, UserPlus, Search } from '@/components/icons/lucide';
import { usePatients } from '@/lib/hooks/usePatients';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { locationLabel, states } from '@/lib/data/south-sudan-reference';
import dynamic from 'next/dynamic';
// Lazy-loaded: html5-qrcode is heavy and only needed when the scanner opens,
// so it stays out of the patients-route bundle until used.
const QRScanner = dynamic(() => import('@/components/QRScanner'), { ssr: false });
import { formatMoney } from '@/lib/format-utils';
import FingerprintIdentifyModal from '@/components/FingerprintIdentifyModal';
import { isFingerprintEnabled } from '@/lib/services/fingerprint-service';
import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';
import { EhrSearchFilter } from '@/components/ehr/EhrListHeader';
import { stopsClickPropagation } from '@/lib/a11y';
import { useDataScope } from '@/lib/hooks/useDataScope';
import Modal from '@/components/Modal';
import { hasUnsyncedWrite } from '@/lib/sync/offline-metadata';

// Pagination cap — capped to keep DOM-node count manageable on low-end devices.
// Each row produces ~20 DOM nodes; 100 rows ≈ 2k nodes which renders smoothly.
// At 10k+ patients we render in pages instead of dumping the whole list.
const PAGE_SIZE = 100;

export default function PatientsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { patients, loading: patientsLoading } = usePatients();
  const { canRegisterPatients, isMedicalBiller, isCashier } = usePermissions();
  const scope = useDataScope();
  // Billing-desk roles see money (outstanding balance) instead of clinical detail.
  const isBilling = isMedicalBiller || isCashier;
  // Structured filters — a single "Filters" dropdown panel (replaces the old
  // per-column funnels). Text search lives in the platform-wide search bar; this
  // panel narrows by the registry's real dimensions.
  const emptyFilters = { olderThan: '', gender: '', state: '', registeredFrom: '', registeredTo: '', allergies: false, chronic: false, recent: false, assignedMe: false, unassigned: false, outstanding: false, pendingSync: false };
  type Filters = typeof emptyFilters;
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const setF = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters(f => ({ ...f, [k]: v }));
  const activeFilterCount = Object.entries(filters).filter(([, v]) => v !== '' && v !== false).length;
  const clearFilters = () => setFilters(emptyFilters);
  // Deep link: the patient chart's "Patient lists" drawer counts the patients
  // assigned to the signed-in provider and links here with ?assigned=me, so
  // the registry has to land already narrowed to the list that was counted.
  // Read from window (not useSearchParams) and stripped afterwards — the same
  // pattern the appointments page uses for its own deep links, and it keeps
  // this route out of a Suspense boundary.
  const assignedParamRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || assignedParamRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('assigned') !== 'me') return;
    assignedParamRef.current = true;
    setFilters(f => ({ ...f, assignedMe: true }));
    params.delete('assigned');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);
  // Shared input/select styling for the filter panel controls.
  const fieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;

  // Outstanding balance per patient — loaded only for billing-desk roles, so the
  // registry shows a "Balance" column instead of clinical conditions. Aggregated
  // from open bills (same rule the billing dashboard uses) in one pass.
  const [balanceByPatient, setBalanceByPatient] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!isBilling || !scope) {
      setBalanceByPatient(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getAllBills } = await import('@/lib/services/billing-service');
        const bills = await getAllBills(scope);
        const m = new Map<string, number>();
        for (const b of bills) {
          if ((b.balanceDue ?? 0) > 0 && b.status !== 'waived' && b.status !== 'cancelled') {
            m.set(b.patientId, (m.get(b.patientId) || 0) + b.balanceDue);
          }
        }
        if (!cancelled) setBalanceByPatient(m);
      } catch (err) {
        console.error('Failed to load patient balances:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isBilling, scope]);
  const [showFindPatient, setShowFindPatient] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showFingerprintIdentify, setShowFingerprintIdentify] = useState(false);
  const [lookupId, setLookupId] = useState('');
  const [lookupError, setLookupError] = useState('');
  // Inline search bar (inside the table card, separate from the global TopBar search).
  const [localSearch, setLocalSearch] = useState('');
  // Sort order for the patient list.
  const [patientSort] = useState<'recent' | 'oldest' | 'name' | 'age'>('recent');
  // Cap how many rows are rendered at once. "Load more" extends the window
  // by another PAGE_SIZE; switching filter/search resets the window.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const handleLookup = () => {
    const q = lookupId.trim().toLowerCase();
    if (!q) { setLookupError(t('patients.enterHospitalOrGeocode')); return; }
    const match = patients.find(p =>
      p.hospitalNumber?.toLowerCase() === q ||
      p.geocodeId?.toLowerCase() === q ||
      p.nationalId?.toLowerCase() === q ||
      p._id?.toLowerCase() === q
    );
    if (match) {
      setShowFindPatient(false);
      setLookupId('');
      setLookupError('');
      router.push(`/patients/${match._id}`);
    } else {
      setLookupError(t('patients.noPatientWithId', { id: lookupId.trim() }));
    }
  };

  // Clinical predicates — also drive the quick-filter tab counts that replaced
  // the old summary KPI cards.
  const MS30 = 30 * 24 * 60 * 60 * 1000;

  // Memoized so a keystroke in either search box (or any other unrelated
  // re-render) doesn't re-run a full filter pass over the whole registry;
  // `sorted` below is the single place that sorts the result. The clinical
  // predicates live inside the callback (rather than as component-scope
  // consts) purely so they don't count as unstable deps that would defeat
  // the memoization — they're only ever used here.
  const filtered = useMemo(() => {
    const isRecentlyVisited = (p: typeof patients[number]) =>
      !!p.lastConsultedAt && (Date.now() - new Date(p.lastConsultedAt).getTime()) < MS30;
    const hasChronic = (p: typeof patients[number]) =>
      !!(p.chronicConditions?.length && p.chronicConditions[0] !== 'None');
    const hasAllergies = (p: typeof patients[number]) =>
      !!(p.allergies?.length && p.allergies[0] !== 'None known');
    return patients.filter(p => {
      const fullName = `${p.firstName} ${p.middleName || ''} ${p.surname}`.toLowerCase();
      if (localSearch) {
        const ls = localSearch.toLowerCase();
        if (!(fullName.includes(ls) || (p.hospitalNumber || '').toLowerCase().includes(ls) || (p.phone || '').includes(ls))) return false;
      }
      const f = filters;
      if (f.olderThan) {
        const age = patientAge(p);
        if (age == null || age < Number(f.olderThan)) return false;
      }
      if (f.gender && p.gender !== f.gender) return false;
      if (f.state && p.state !== f.state) return false;
      if (f.registeredFrom || f.registeredTo) {
        const reg = p.registeredAt || p.registrationDate;
        if (!reg) return false;
        const d = new Date(reg).getTime();
        if (f.registeredFrom && d < new Date(f.registeredFrom).getTime()) return false;
        if (f.registeredTo && d > new Date(`${f.registeredTo}T23:59:59`).getTime()) return false;
      }
      if (f.allergies && !hasAllergies(p)) return false;
      if (f.chronic && !hasChronic(p)) return false;
      if (f.recent && !isRecentlyVisited(p)) return false;
      if (f.assignedMe && p.assignedDoctor !== currentUser?._id) return false;
      if (f.unassigned && p.assignedDoctor) return false;
      if (f.outstanding && isBilling && !((balanceByPatient.get(p._id) || 0) > 0)) return false;
      if (f.pendingSync && !hasUnsyncedWrite(p)) return false;
      return true;
    });
  }, [patients, filters, localSearch, currentUser?._id, isBilling, balanceByPatient, MS30]);

  // Reset the visible window whenever the filters change — otherwise narrowing
  // would leave a stale "Load more" count.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filters, localSearch, patientSort]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (patientSort === 'name') return arr.sort((a, b) => patientFullName(a).localeCompare(patientFullName(b)));
    if (patientSort === 'age') return arr.sort((a, b) => (patientAge(b) ?? 0) - (patientAge(a) ?? 0));
    if (patientSort === 'oldest') return arr.sort((a, b) => (a.registeredAt || a.registrationDate || '').localeCompare(b.registeredAt || b.registrationDate || ''));
    return arr.sort((a, b) => (b.registeredAt || b.registrationDate || '').localeCompare(a.registeredAt || a.registrationDate || ''));
  }, [filtered, patientSort]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = sorted.length > visibleCount;

  // Registry-wide KPIs for the stat cards (not affected by the table's search).
  const patientKpis = useMemo(() => {
    const now = Date.now();
    let male = 0, female = 0, newThisMonth = 0, unassigned = 0, outstanding = 0, pendingSync = 0;
    for (const p of patients) {
      if (p.gender === 'Male') male++;
      else if (p.gender === 'Female') female++;
      const reg = p.registeredAt || p.registrationDate;
      if (reg && now - new Date(reg).getTime() < MS30) newThisMonth++;
      if (!p.assignedDoctor) unassigned++;
      if ((balanceByPatient.get(p._id) || 0) > 0) outstanding++;
      if (hasUnsyncedWrite(p)) pendingSync++;
    }
    return { total: patients.length, male, female, newThisMonth, unassigned, outstanding, pendingSync };
  }, [patients, balanceByPatient, MS30]);

  // Export the currently filtered/sorted registry to CSV.
  const handleDownloadCsv = () => {
    const header = ['Name', 'Hospital number', 'Gender', 'Age', 'Location', 'Assigned doctor', 'Assigned nurse'];
    const rows = sorted.map(p => [
      patientFullName(p),
      p.hospitalNumber || '',
      p.gender || '',
      patientAgeLabel(p),
      [p.county, p.state].filter(Boolean).join(', '),
      p.assignedDoctorName || '',
      p.assignedNurseName || '',
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'patients.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatRegistryDate = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const facilityNameOf = (p: typeof patients[number]) => {
    const named = p as typeof p & { registrationHospitalName?: string; lastVisitHospitalName?: string };
    return named.registrationHospitalName || named.lastVisitHospitalName || p.registrationHospital || p.lastVisitHospital || 'Facility unknown';
  };

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
            {/* ── Card toolbar ── */}
            <div className="px-4 pt-4 pb-3 flex-shrink-0" data-tour="patients-toolbar" style={{ borderBottom: '1px solid var(--border-light)' }}>
              {/* Title + patient stats (inline, right-aligned — mirrors the wards
                  "Current Admissions" header instead of separate stat cards). */}
              <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
                <EhrPageTitle>{t('nav.patients')}</EhrPageTitle>
                <div className="flex items-center gap-3 flex-wrap justify-end pb-0.5">
                  {[
                    { label: t('patients.statRegistered'), value: patientKpis.total, color: 'var(--text-muted)' },
                    { label: t('patient.male'), value: patientKpis.male, color: 'var(--accent-primary)' },
                    { label: t('patient.female'), value: patientKpis.female, color: 'var(--color-warning-text)' },
                    { label: t('patients.statNewThisMonth'), value: patientKpis.newThisMonth, color: 'var(--color-success-text)' },
                    { label: isBilling ? t('patients.statOutstanding') : t('patients.statUnassigned'), value: isBilling ? patientKpis.outstanding : patientKpis.unassigned, color: 'var(--color-warning-text)' },
                  ].map(s => (
                    <span key={s.label} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                      {s.label} ({s.value.toLocaleString()})
                    </span>
                  ))}
                  {/* Only shown when there is something unpushed to report — a
                      fully-synced registry adds no chip here, same rule the
                      stat chips beside it follow. Clicking narrows the table
                      to exactly those rows via the existing filter panel's
                      own predicate (below), rather than duplicating it. */}
                  {patientKpis.pendingSync > 0 && (
                    <button
                      type="button"
                      onClick={() => setF('pendingSync', !filters.pendingSync)}
                      title={t('sync.pendingSyncFilterHint')}
                      aria-pressed={filters.pendingSync}
                      className="inline-flex items-center gap-1 text-[12px]"
                      style={{ color: 'var(--semantic-warning)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--semantic-warning)' }} />
                      {t('sync.pendingSyncCount', { count: patientKpis.pendingSync })}
                    </button>
                  )}
                </div>
              </div>
              {/* Search + filter row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* One control. The registry used to carry this input beside a
                    filter button that narrowed the same list; the disclosure
                    now lives at the field's trailing edge. The panel is still
                    portalled, because the card's `overflow: hidden` clipped it
                    when it was absolutely positioned in this toolbar. */}
                <EhrSearchFilter
                  value={localSearch}
                  onChange={setLocalSearch}
                  placeholder="Search by name or patient ID…"
                  activeCount={activeFilterCount}
                  onClear={clearFilters}
                  label={t('patients.filtersTitle')}
                  panelWidth={560}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('patients.filterOlderThan')}</span>
                      <div className="relative">
                        <input type="number" min={0} max={120} value={filters.olderThan} onChange={e => setF('olderThan', e.target.value)} placeholder="—" className="w-full text-sm py-2 ps-3 pe-12" style={fieldStyle} />
                        <span className="absolute end-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('patients.filterYears')}</span>
                      </div>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('nurse.colGender')}</span>
                      <Select value={filters.gender} onChange={e => setF('gender', e.target.value)} className="w-full text-sm py-2 px-3" style={fieldStyle}>
                        <option value="">{t('patients.all')}</option>
                        <option value="Male">{t('patient.male')}</option>
                        <option value="Female">{t('patient.female')}</option>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('patient.location')}</span>
                      <Select value={filters.state} onChange={e => setF('state', e.target.value)} searchThreshold={0} className="w-full text-sm py-2 px-3" style={fieldStyle}>
                        <option value="">{t('patients.all')}</option>
                        {states.map(s => <option key={s} value={s}>{locationLabel(s)}</option>)}
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('patients.filterRegisteredFrom')}</span>
                      <input type="date" value={filters.registeredFrom} onChange={e => setF('registeredFrom', e.target.value)} className="w-full text-sm py-2 px-3" style={fieldStyle} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('patients.filterRegisteredTo')}</span>
                      <input type="date" value={filters.registeredTo} onChange={e => setF('registeredTo', e.target.value)} className="w-full text-sm py-2 px-3" style={fieldStyle} />
                    </label>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold block mb-2" style={{ color: 'var(--text-secondary)' }}>{t('patients.filterShowWith')}</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
                      {([
                        ['allergies', t('patients.kpiAllergiesFlagged')],
                        ['chronic', t('patient.chronicConditions')],
                        ['recent', t('patients.kpiVisitedLast30d')],
                        ['assignedMe', t('patients.assignedMe')],
                        ['unassigned', t('patients.assignedUnassigned')],
                        ['pendingSync', t('sync.docPendingLabel')],
                        ...(isBilling ? [['outstanding', t('patients.filterOutstanding')] as const] : []),
                      ] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text-primary)' }}>
                          <input type="checkbox" checked={filters[key]} onChange={e => setF(key, e.target.checked)} className="w-4 h-4 rounded" style={{ accentColor: 'var(--accent-primary)' }} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                </EhrSearchFilter>
                {/* Hospital-number/geocode/national-ID lookup plus QR and
                    fingerprint identify — the modal existed but had no way to
                    open it (KAN-118): `showFindPatient` was never set true
                    anywhere in this file. */}
                <button
                  type="button"
                  onClick={() => setShowFindPatient(true)}
                  aria-label={t('boma.findPatient')}
                  title={t('boma.findPatient')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    height: 38, padding: '0 14px',
                    borderRadius: 999, background: 'var(--bg-card-solid)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border-light)',
                    fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                    cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  <Search className="w-4 h-4" />
                  {t('boma.findPatient')}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  aria-label="Download"
                  title="Download"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 38, height: 38, padding: 0,
                    borderRadius: 999, background: 'var(--bg-card-solid)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border-light)',
                    cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  <Download className="w-4 h-4" />
                </button>
                {/* Registration is the one thing a reader of this list starts
                    rather than finds, so it sits at the end of the toolbar as
                    the only filled control. A link, not a button — the desk
                    often wants it in a second tab alongside the registry.
                    Gated on the same capability the front desk uses. */}
                {canRegisterPatients && (
                  <Link
                    href="/patients/new"
                    data-tour="patients-register"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      height: 38, padding: '0 16px',
                      borderRadius: 999, background: 'var(--accent-primary)', color: 'var(--color-white)',
                      border: '1px solid var(--accent-primary)',
                      fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                      textDecoration: 'none', cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    <UserPlus className="w-4 h-4" />
                    {t('patients.registerShort')}
                  </Link>
                )}
              </div>
            </div>
            {/* Same compact card-row list as the appointments page — identical
                grid template, spacing, and type scale. Five columns:
                Patient / Registered / Care team / Location / Status. */}
            <div className="appointment-card-surface patients-list-surface">
              <div className="appointment-card-flow">
                    {/* The column head is the registry's frame, not a label
                        for the rows that happen to be loaded: it stays put
                        when a search matches nothing, so the list never
                        collapses into a bare message. */}
                    <div className="appointment-card-head" aria-hidden="true">
                    <span>Patient</span>
                    <span>Registered</span>
                    <span>Care team</span>
                    <span>Location</span>
                    <span>Status</span>
                    </div>
                    {patientsLoading && (
                      <div className="appointment-card-empty">Loading patients…</div>
                    )}
                    {!patientsLoading && visible.length === 0 && (
                      <div className="appointment-card-empty">
                        {t('patients.patientsFound', { count: 0 })}
                      </div>
                    )}
                    {!patientsLoading && visible.map(patient => (
                    <div
                      key={patient._id}
                      className="ehr-appointment-row appointment-card-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/patients/${patient._id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/patients/${patient._id}`); } }}
                    >
                      <div className="ehr-appointment-identity">
                        <PatientAvatar patient={patient} size={40} />
                        <div className="ehr-appointment-main appointment-card-patient">
                          <Link href={`/patients/${patient._id}`} {...stopsClickPropagation}>{patientDisplayName(patient)}</Link>
                          <p>{patient.hospitalNumber || 'No hospital number'} · {patientAgeLabel(patient)} · {patient.gender || 'Not recorded'}</p>
                        </div>
                      </div>

                      <div className="ehr-appointment-time">
                        <strong>{formatRegistryDate(patient.registeredAt || patient.registrationDate)}</strong>
                        <span>{patient.lastConsultedAt ? `Last visit ${formatRegistryDate(patient.lastConsultedAt)}` : 'No recent visit'}</span>
                      </div>

                      <div className="appointment-card-provider">
                        <strong>{patient.assignedDoctorName || 'Doctor unassigned'}</strong>
                        <span>{patient.assignedNurseName || 'Nurse unassigned'}</span>
                      </div>

                      <div className="appointment-card-provider">
                        <strong>{[patient.county, patient.state].filter(Boolean).join(', ') || 'Location unknown'}</strong>
                        <span>{facilityNameOf(patient)}</span>
                      </div>

                      <div className="appointment-card-status">
                        <span className={`appointment-status-pill ${patient.isActive ? 'status-confirmed' : 'status-no-show'}`}>
                          {patient.isActive ? 'Active' : 'Archived'}
                        </span>
                        <small>
                          {isBilling
                            ? ((balanceByPatient.get(patient._id) || 0) > 0 ? formatMoney(balanceByPatient.get(patient._id) || 0) : t('billing.paidInFull'))
                            : patient.assignedDoctor ? 'Assigned' : 'Needs care team'}
                        </small>
                      </div>
                    </div>
                    ))}
              </div>
            </div>
            {hasMore && (
              <div className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0" style={{ borderColor: 'var(--border-light)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('patients.showingOf', { shown: visible.length.toLocaleString(), total: filtered.length.toLocaleString() })}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                >
                  {t('patients.loadMore')}
                </button>
              </div>
            )}
          </div>
      </main>

      {/* Find Patient Modal — Hospital ID lookup + QR scan */}
      {showFindPatient && !showQRScanner && !showFingerprintIdentify && (
        <Modal
          onClose={() => { setShowFindPatient(false); setLookupId(''); setLookupError(''); }}
          width={448}
          labelledBy="find-patient-title"
        >
          <div className="modal-panel w-full overflow-hidden" style={{ background: 'var(--card-bg, var(--bg-card))' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
              <h3 id="find-patient-title" className="text-sm font-semibold">{t('boma.findPatient')}</h3>
              <button onClick={() => { setShowFindPatient(false); setLookupId(''); setLookupError(''); }} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/10 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Hospital ID / Geocode ID Lookup */}
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {t('patients.enterLookupId')}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Hash className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      value={lookupId}
                      onChange={(e) => { setLookupId(e.target.value); setLookupError(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                      placeholder={t('patients.lookupPlaceholder')}
                      className="ps-9 w-full"
                      autoFocus
                      style={{ background: 'var(--overlay-subtle)' }}
                    />
                  </div>
                  <button onClick={handleLookup} className="btn btn-primary btn-sm px-4">
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
                {lookupError && (
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-danger-text)' }}>{lookupError}</p>
                )}
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
                <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{t('patients.or')}</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
              </div>

              {/* QR Code Scan Option */}
              <button
                onClick={() => setShowQRScanner(true)}
                className="w-full flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-[var(--accent-light)]"
                style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'transparent' }}>
                  <ScanLine className="w-5 h-5" style={{ color: 'var(--tamamhealth-blue)' }} />
                </div>
                <div className="text-start">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('patients.scanQrCode')}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('patients.scanQrDesc')}</p>
                </div>
                <ArrowRight className="w-4 h-4 ms-auto" style={{ color: 'var(--text-muted)' }} />
              </button>

              {/* Fingerprint identification (feature-flagged, needs local bridge) */}
              {isFingerprintEnabled() && (
                <button
                  onClick={() => setShowFingerprintIdentify(true)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-[var(--accent-light)]"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}
                >
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'transparent' }}>
                    <ScanLine className="w-5 h-5" style={{ color: 'var(--tamamhealth-blue)' }} />
                  </div>
                  <div className="text-start">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('fingerprint.identifyTitle')}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('fingerprint.identifyOptionDesc')}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 ms-auto" style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {showFingerprintIdentify && (
        <FingerprintIdentifyModal
          onSelect={(patientId) => {
            setShowFingerprintIdentify(false);
            setShowFindPatient(false);
            router.push(`/patients/${patientId}`);
          }}
          onClose={() => setShowFingerprintIdentify(false)}
        />
      )}

      {showQRScanner && (
        <QRScanner
          onScan={(data) => {
            setShowQRScanner(false);
            setShowFindPatient(false);
            router.push(`/patients/${data.id}`);
          }}
          onClose={() => setShowQRScanner(false)}
        />
      )}

    </>
  );
}
