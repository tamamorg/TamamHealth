'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Modal from '@/components/Modal';
import {
  User, Calendar, FileText, FlaskConical, Syringe,
  Pill, Scan,
  ChevronRight, Search, AlertTriangle,
  MessageSquare, Activity,
  X, LogOut, Send,
  Wallet,
  CheckCircle2,
  UserCircle,
} from '@/components/icons/lucide';
import type { PatientDoc, AppointmentDoc, LabResultDoc, MedicalRecordDoc, PrescriptionDoc, ImmunizationDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatClockTime , formatRxSig } from '@/lib/format-utils';
import Select from '@/components/Select';
import { readPatientPortalSession, clearPatientPortalSession, patientPortalFetch } from '@/lib/patient-portal-session';
import { PatientLogin } from '@/components/patient-portal/PatientLogin';
import { ProfileTab } from '@/components/patient-portal/ProfileTab';
import { BillingTab } from '@/components/patient-portal/BillingTab';
import { Empty, dateParts, shortDate, type ChipTone } from '@/components/patient-portal/shared';
import { todayIso } from '@/lib/date-utils';
import { dismissBackdrop } from '@/lib/a11y';

type Tab = 'overview' | 'appointments' | 'records' | 'lab' | 'prescriptions' | 'radiology' | 'immunizations' | 'messages' | 'chat' | 'billing' | 'profile';

/* ═════════════════════════════════════════
   PATIENT PORTAL (authenticated)
   ═════════════════════════════════════════ */
export default function PatientPortalPage() {
  const { t } = useTranslation();
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [checking, setChecking] = useState(true);

  // Check for existing session. A `?demo=<id>` deep link from the staff login
  // picker names a specific patient — if the stored session belongs to someone
  // else, drop it so PatientLogin's auto-login can switch accounts; otherwise
  // clicking a second demo patient would silently keep the first one's session.
  useEffect(() => {
    const session = readPatientPortalSession();
    const demoId = new URLSearchParams(window.location.search).get('demo');
    if (session && demoId && session.patient?._id !== demoId) {
      clearPatientPortalSession();
    } else if (session) {
      setPatient(session.patient);
    }
    setChecking(false);
  }, []);

  const handleLogout = useCallback(() => {
    clearPatientPortalSession();
    setPatient(null);
  }, []);

  if (checking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('status.loading')}</p>
      </div>
    );
  }

  if (!patient) {
    return <PatientLogin onLogin={setPatient} />;
  }

  return <PatientDashboard patient={patient} onLogout={handleLogout} />;
}

/* ═════════════════════════════════════════
   PATIENT DASHBOARD
   ═════════════════════════════════════════ */

function PatientDashboard({ patient, onLogout }: { patient: PatientDoc; onLogout: () => void }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [appointments, setAppointments] = useState<AppointmentDoc[]>([]);
  const [labResults, setLabResults] = useState<LabResultDoc[]>([]);
  const [records, setRecords] = useState<MedicalRecordDoc[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionDoc[]>([]);
  const [immunizations, setImmunizations] = useState<ImmunizationDoc[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [sessionToken, setSessionToken] = useState('');

  // Transient confirmation toast (bottom-center, per the design). Only fired
  // after an action actually persisted — never to fake a success.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  // Load patient-specific data
  useEffect(() => {
    const session = readPatientPortalSession();
    if (!session) {
      onLogout();
      return;
    }
    setSessionToken(session.token);
    (async () => {
      try {
        const [apts, labs, recs, rxs, imms] = await Promise.all([
          patientPortalFetch<{ appointments: AppointmentDoc[] }>('/api/patient-portal/appointments', session.token),
          patientPortalFetch<{ results: LabResultDoc[] }>('/api/patient-portal/labs', session.token),
          patientPortalFetch<{ records: MedicalRecordDoc[] }>('/api/patient-portal/records', session.token),
          patientPortalFetch<{ prescriptions: PrescriptionDoc[] }>('/api/patient-portal/prescriptions', session.token),
          patientPortalFetch<{ immunizations: ImmunizationDoc[] }>('/api/patient-portal/immunizations', session.token),
        ]);
        setAppointments(apts.appointments);
        setLabResults(labs.results);
        setRecords(recs.records);
        setPrescriptions(rxs.prescriptions);
        setImmunizations(imms.immunizations);
      } catch (err) { console.error('Failed to load patient data:', err); }
    })();
  }, [onLogout, patient._id]);

  const upcomingApts = useMemo(() => {
    const today = todayIso();
    return appointments.filter(a => a.appointmentDate >= today && a.status !== 'cancelled' && a.status !== 'no_show');
  }, [appointments]);

  // `registrationHospitalName` isn't on the `PatientDoc` type but the seed/
  // registration data carries it alongside the hospital id — fall back to the
  // id itself only if the name was never recorded.
  const patientFacilityName = (patient as { registrationHospitalName?: string }).registrationHospitalName
    || patient.registrationHospital
    || '';

  const [bookingDate, setBookingDate] = useState(() => todayIso());
  const [bookingTime, setBookingTime] = useState<'morning' | 'afternoon' | 'any'>('any');
  const [bookingDepartment, setBookingDepartment] = useState('General / OPD');
  const [bookingReason, setBookingReason] = useState('');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const resetBookingForm = () => {
    setBookingDate(todayIso());
    setBookingTime('any');
    setBookingDepartment('General / OPD');
    setBookingReason('');
    setBookingError(null);
  };

  const handleSubmitBooking = async () => {
    if (bookingSubmitting) return;
    setBookingSubmitting(true);
    setBookingError(null);
    try {
      const session = readPatientPortalSession();
      if (!session) throw new Error('Missing patient session');
      const timeOfDay: Record<typeof bookingTime, string> = { morning: '09:00', afternoon: '14:00', any: '' };
      const { appointment } = await patientPortalFetch<{ appointment: AppointmentDoc }>(
        '/api/patient-portal/appointments',
        session.token,
        {
          method: 'POST',
          body: JSON.stringify({
            patientPhone: patient.phone || '',
            facilityId: patient.registrationHospital || '',
            facilityName: patientFacilityName,
            appointmentDate: bookingDate,
            appointmentTime: timeOfDay[bookingTime],
            department: bookingDepartment,
            reason: bookingReason,
            appointmentType: 'general',
            state: patient.state || '',
          }),
        }
      );
      setAppointments(prev => [...prev, appointment]);
      setShowBooking(false);
      resetBookingForm();
      setToast('Appointment request sent — the facility will confirm it');
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : t('patientPortal.bookingRequestError'));
    } finally {
      setBookingSubmitting(false);
    }
  };

  const [chatDepartment, setChatDepartment] = useState('General / OPD');

  // ── Sidebar navigation, in the design's three groups. Group titles are
  // chrome copy (hardcoded English, like the rail and search placeholder).
  const pendingLabCount = labResults.filter(l => l.status === 'pending').length;
  type NavItem = { key: Tab; label: string; icon: typeof User; count?: number; orange?: boolean };
  const navGroups: { title: string; items: NavItem[] }[] = [
    { title: 'Home', items: [{ key: 'overview', label: t('patientPortal.tabOverview'), icon: Activity }] },
    {
      title: 'My health record',
      items: [
        { key: 'records', label: t('patientPortal.tabMedicalRecords'), icon: FileText, count: records.length },
        { key: 'prescriptions', label: t('patientPortal.tabPrescriptions'), icon: Pill },
        { key: 'lab', label: t('patientPortal.tabLabResults'), icon: FlaskConical, count: pendingLabCount, orange: true },
        { key: 'radiology', label: t('patientPortal.tabRadiology'), icon: Scan },
        { key: 'immunizations', label: t('patientPortal.tabImmunizations'), icon: Syringe },
      ],
    },
    {
      title: 'Care & payments',
      items: [
        { key: 'appointments', label: t('patientPortal.tabAppointments'), icon: Calendar, count: upcomingApts.length },
        { key: 'billing', label: t('patientPortal.tabBilling'), icon: Wallet },
        { key: 'chat', label: t('patientPortal.tabMessages'), icon: MessageSquare },
        { key: 'profile', label: t('patientPortal.tabMyProfile'), icon: UserCircle },
      ],
    },
  ];
  const tabs = navGroups.flatMap(g => g.items);

  type ChatMsg = { id?: string; text: string; from: 'patient' | 'system'; time: string };
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([
    { text: t('patientPortal.chatWelcome', { name: patient.firstName }), from: 'system', time: '09:00' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Load any existing messages on this patient record so the conversation
  // history survives page reloads (rather than only living in component
  // state). Anything authored by `fromDoctorId === 'patient'` is rendered as
  // a patient-side bubble; everything else is a staff/system reply.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = readPatientPortalSession();
        if (!session) return;
        const { messages: docs } = await patientPortalFetch<{ messages: Array<{ _id?: string; body: string; fromDoctorId?: string; sentAt?: string; createdAt?: string }> }>(
          '/api/patient-portal/messages',
          session.token
        );
        if (cancelled) return;
        const formatted: ChatMsg[] = docs
          .slice() // getMessagesByPatient returns newest-first; flip so newest is at the bottom
          .sort((a, b) => (a.sentAt || '').localeCompare(b.sentAt || ''))
          .map(m => ({
            id: m._id,
            text: m.body,
            from: m.fromDoctorId === 'patient' ? 'patient' : 'system',
            time: new Date(m.sentAt || m.createdAt || Date.now())
              .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }));
        if (formatted.length > 0) {
          setChatMessages(formatted);
        }
      } catch (err) {
        // History load is best-effort — fall back to the welcome stub.
        console.error('[patient-portal] load messages failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatSending) return;
    setChatSending(true);
    setChatError(null);
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Optimistically render the patient bubble so the UI feels instant.
    // We tag it with a temporary id so the post-persist replacement is safe.
    const tempId = `pending-${now.getTime()}`;
    setChatMessages(prev => [...prev, { id: tempId, text: trimmed, from: 'patient', time }]);
    setChatInput('');

    try {
      const session = readPatientPortalSession();
      if (!session) throw new Error('Missing patient session');
      const { message: saved } = await patientPortalFetch<{ message: { _id: string; body: string } }>(
        '/api/patient-portal/messages',
        session.token,
        {
          method: 'POST',
          body: JSON.stringify({
            patientPhone: patient.phone || '',
            recipientDepartment: chatDepartment,
            recipientHospitalId: patient.registrationHospital || '',
            recipientHospitalName: patientFacilityName,
            fromHospitalId: patient.registrationHospital || '',
            fromHospitalName: patientFacilityName,
            subject: `Patient message — ${chatDepartment}`,
            body: trimmed,
            sentAt: now.toISOString(),
          }),
        }
      );
      // Replace the optimistic entry with the persisted one (using the real id).
      setChatMessages(prev => prev.map(m => m.id === tempId
        ? { id: saved._id, text: saved.body, from: 'patient', time }
        : m));
    } catch (err) {
      console.error('[patient-portal] send message failed', err);
      // Roll back the optimistic bubble and surface a real error to the user
      // — better to say "we couldn't deliver that" than to fake a success
      // and leave them thinking the doctor saw it.
      setChatMessages(prev => prev.filter(m => m.id !== tempId));
      setChatInput(trimmed);
      setChatError(t('patientPortal.chatSendError'));
    } finally {
      setChatSending(false);
    }
  };

  // ── Header chrome: user menu + portal-wide search ──
  // The search indexes the patient's own data (already loaded for the tabs)
  // and jumps to the tab that holds the match. Chrome copy is hardcoded
  // English to match the staff top rail, which does the same.
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  // Computed inline (not memoized): the source arrays are rebuilt each render
  // anyway, and the scan is over at most a few hundred short strings.
  const searchResults = (() => {
    const q = searchQ.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits: { key: string; tab: Tab; title: string; sub: string }[] = [];
    tabs.forEach(tb => {
      if (tb.label.toLowerCase().includes(q)) hits.push({ key: `tab-${tb.key}`, tab: tb.key, title: tb.label, sub: 'Section' });
    });
    prescriptions.forEach(rx => {
      if (rx.medication?.toLowerCase().includes(q)) hits.push({ key: `rx-${rx._id}`, tab: 'prescriptions', title: rx.medication, sub: `Prescription · ${rx.status}` });
    });
    labResults.forEach(lab => {
      if (lab.testName?.toLowerCase().includes(q)) hits.push({ key: `lab-${lab._id}`, tab: 'lab', title: lab.testName, sub: `Lab result · ${lab.status}` });
    });
    records.forEach(rec => {
      const r = rec as unknown as { visitType?: string; diagnoses?: Array<{ name?: string }> };
      const diag = (r.diagnoses || []).map(d => d.name || '').join(', ');
      if (r.visitType?.toLowerCase().includes(q) || diag.toLowerCase().includes(q)) {
        hits.push({ key: `rec-${rec._id}`, tab: 'records', title: r.visitType || 'Visit', sub: diag || `Visit · ${rec.createdAt?.slice(0, 10)}` });
      }
    });
    appointments.forEach(apt => {
      if (apt.reason?.toLowerCase().includes(q) || apt.providerName?.toLowerCase().includes(q)) {
        hits.push({ key: `apt-${apt._id}`, tab: 'appointments', title: apt.reason || apt.appointmentType, sub: `Appointment · ${apt.appointmentDate}` });
      }
    });
    return hits.slice(0, 8);
  })();

  const initials = `${(patient.firstName || ' ')[0]}${(patient.surname || ' ')[0]}`.toUpperCase();
  const goTab = (tab: Tab) => { setActiveTab(tab); setUserMenuOpen(false); setSearchQ(''); setSearchOpen(false); };

  // Appointment status → design chip tone. Past/terminal states go neutral,
  // confirmed goes green, anything still in flight reads as the blue tone.
  const aptChip = (status: AppointmentDoc['status']): { tone: ChipTone; label: string } => {
    if (status === 'completed') return { tone: 'neutral', label: 'Done' };
    if (status === 'cancelled') return { tone: 'neutral', label: 'Cancelled' };
    if (status === 'no_show') return { tone: 'neutral', label: 'No show' };
    if (status === 'confirmed') return { tone: 'green', label: 'Confirmed' };
    return { tone: 'blue', label: String(status).replace('_', ' ') };
  };

  return (
    <div className="pp-shell">

      {/* ── Top bar — brand · facility · search · patient chip. ── */}
      <header className="pp-top">
        <button type="button" className="pp-top-brand" onClick={() => goTab('overview')} aria-label="Patient portal home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/tamamhealth-logo-full-white.svg" alt="Tamam Healthcare System" />
        </button>
        <span className="pp-top-rule" aria-hidden />
        <span className="pp-top-facility" title={patientFacilityName}>{patientFacilityName}</span>

        <div className="pp-search-wrap">
          <label className="pp-search">
            <Search size={14} />
            <input
              value={searchQ}
              onChange={e => { setSearchQ(e.target.value); setSearchOpen(e.target.value.trim().length >= 2); }}
              onFocus={() => setSearchOpen(searchQ.trim().length >= 2)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
              placeholder="Search your records, results, medications"
              aria-label="Search your records"
              type="search"
            />
            {searchQ && (
              <button type="button" className="pp-search-clear" onClick={() => { setSearchQ(''); setSearchOpen(false); }} aria-label="Clear search">
                <X size={9} strokeWidth={2.4} />
              </button>
            )}
          </label>
          {searchOpen && (
            <div className="pp-pop pp-search-menu">
              {searchResults.length === 0 ? (
                <p>No matches in your records.</p>
              ) : searchResults.map(r => (
                <button key={r.key} type="button" onMouseDown={e => { e.preventDefault(); goTab(r.tab); }}>
                  <strong>{r.title}</strong>
                  <small>{r.sub}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pp-user-wrap">
          <button type="button" className={`pp-user ${userMenuOpen ? 'active' : ''}`}
            onClick={() => setUserMenuOpen(o => !o)}
            aria-expanded={userMenuOpen} aria-haspopup="menu" title={`${patient.firstName} ${patient.surname}`}>
            <span className="pp-user-mark">
              {patient.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={patient.photoUrl} alt="" />
                : initials}
            </span>
            <span className="pp-user-role">Patient</span>
          </button>
          {userMenuOpen && (
            <>
              <div className="pp-scrim" {...dismissBackdrop(() => setUserMenuOpen(false))} />
              <div className="pp-pop pp-user-menu" role="menu">
                <div className="pp-user-menu-id" aria-hidden>
                  <b>{patient.firstName} {patient.surname}</b>
                  <small>{patient.hospitalNumber} · {patientFacilityName}</small>
                </div>
                <button type="button" role="menuitem" className="pp-menu-item" onClick={() => goTab('profile')}>
                  <User size={15} /><span>{t('patientPortal.tabMyProfile')}</span>
                </button>
                <button type="button" role="menuitem" className="pp-menu-item danger" onClick={onLogout}>
                  <LogOut size={15} /><span>{t('patientPortal.signOut')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="pp-body">

        {/* ── Sidebar — three groups per the design; emergencies note pinned
            at the bottom. Collapses to a horizontal strip on small screens. ── */}
        <aside className="pp-side" aria-label="Patient portal sections">
          {navGroups.map(group => (
            <div key={group.title} className="pp-side-group">
              <p className="pp-side-title">{group.title}</p>
              {group.items.map(item => {
                const on = activeTab === item.key;
                return (
                  <button key={item.key} type="button" className={`pp-side-item ${on ? 'active' : ''}`}
                    aria-current={on ? 'page' : undefined} onClick={() => goTab(item.key)}>
                    <item.icon size={15} strokeWidth={1.7} />
                    <span>{item.label}</span>
                    {item.count ? <b className={`pp-side-badge ${item.orange ? 'orange' : ''}`}>{item.count}</b> : null}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="pp-side-foot">
            <p>Emergencies: call 911 or come straight to the facility.</p>
          </div>
        </aside>

        <main className="pp-main">
          <div className="pp-page">

      {/* ═══ Overview ═══ */}
      {activeTab === 'overview' && (() => {
        /* Extract latest vitals from most recent record */
        const sortedRecs = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const latestRec = sortedRecs[0] as unknown as Record<string, unknown> | undefined;
        const vitals = (latestRec?.vitalSigns || {}) as Record<string, string | number>;
        const latestDate = latestRec?.createdAt ? String(latestRec.createdAt).slice(0, 10) : null;
        const latestVisitType = (latestRec?.visitType as string) || t('patientPortal.consultation');

        const activeRx = prescriptions.slice(0, 3);

        /* Recent activity — visits and lab results interleaved, newest first. */
        const activity: { key: string; what: string; when: string }[] = [];
        records.slice(0, 3).forEach(rec => {
          const r = rec as unknown as Record<string, unknown>;
          activity.push({ key: `rec-${rec._id}`, what: `${t('patientPortal.consultation')} — ${(r.visitType as string) || t('patientPortal.generalCheckup')}`, when: rec.createdAt?.slice(0, 10) || '' });
        });
        labResults.slice(0, 3).forEach(lab => {
          activity.push({ key: `lab-${lab._id}`, what: `${lab.status === 'completed' ? 'Lab result released' : 'Lab test ordered'} — ${lab.testName}`, when: (lab.orderedAt || lab.createdAt).slice(0, 10) });
        });
        activity.sort((a, b) => b.when.localeCompare(a.when));

        // Seed/registration data uses 'None' / 'None known' as explicit
        // placeholders — those are the *absence* of an alert, not an alert.
        const realAllergies = (patient.allergies || []).filter(a => a && !/^none\b/i.test(a));
        const realConditions = (patient.chronicConditions || []).filter(c => c && !/^none\b/i.test(c));
        const hasCritical = labResults.some(l => l.critical);

        /* Things to do — only real, actionable items derived from the data
           already loaded; each jumps to the tab where the action lives. */
        const today = todayIso();
        const dueImm = immunizations.find(im => im.nextDueDate && im.nextDueDate >= today);
        const todos: { key: string; label: string; sub: string; icon: typeof User; amber?: boolean; go: () => void }[] = [];
        if (upcomingApts[0]) {
          const next = upcomingApts[0];
          todos.push({ key: 'apt', label: 'Your next visit', sub: `${shortDate(next.appointmentDate)}${next.appointmentTime ? ` · ${formatClockTime(next.appointmentTime)}` : ''} · ${next.department}`, icon: Calendar, go: () => goTab('appointments') });
        }
        if (pendingLabCount > 0) {
          todos.push({ key: 'lab', label: 'Lab results in progress', sub: `${pendingLabCount} pending review`, icon: FlaskConical, amber: true, go: () => goTab('lab') });
        }
        if (dueImm) {
          todos.push({ key: 'imm', label: `Book ${dueImm.vaccine} — ${t('patientPortal.doseNumber', { number: dueImm.doseNumber + 1 })}`, sub: `Due ${shortDate(dueImm.nextDueDate!)}`, icon: Syringe, go: () => goTab('immunizations') });
        }
        if (sortedRecs[0]) {
          todos.push({ key: 'rec', label: 'Read your visit summary', sub: `${latestVisitType} · ${shortDate(latestDate || '')}`, icon: FileText, go: () => goTab('records') });
        }

        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        const todayLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const vitalDefs = [
          { key: 'bloodPressure', label: t('patientPortal.bloodPressure'), unit: 'mmHg' },
          { key: 'heartRate', label: t('patientPortal.heartRate'), unit: 'bpm' },
          { key: 'temperature', label: t('patientPortal.temperature'), unit: '°C' },
          { key: 'weight', label: t('patientPortal.weight'), unit: 'kg' },
          { key: 'respiratoryRate', label: t('patientPortal.respRate'), unit: '/min' },
          { key: 'oxygenSaturation', label: 'SpO₂', unit: '%' },
        ].filter(v => vitals[v.key]);

        return (
        <div>
          <div className="pp-head">
            <div>
              <h1>{greeting}, {patient.firstName}</h1>
              <p className="pp-head-note">{patientFacilityName} · {todayLine}</p>
            </div>
            <div className="pp-head-actions">
              <button type="button" className="pp-btn pp-btn-primary" onClick={() => setShowBooking(true)}>
                <Calendar size={15} strokeWidth={1.8} /> {t('patientPortal.bookAppointment')}
              </button>
              <button type="button" className="pp-btn pp-btn-secondary" onClick={() => goTab('chat')}>
                <MessageSquare size={15} strokeWidth={1.8} /> Message care team
              </button>
            </div>
          </div>

          {/* Things to do */}
          {todos.length > 0 && (
            <div className="pp-card" style={{ marginBottom: 14 }}>
              <div className="pp-card-head">
                <h2>Things to do</h2>
                <small>{todos.length} open</small>
              </div>
              <div className="pp-todos">
                {todos.map(td => (
                  <button key={td.key} type="button" className="pp-todo" onClick={td.go}>
                    <span className={`pp-todo-ic ${td.amber ? 'amber' : ''}`}>
                      <td.icon size={15} strokeWidth={1.8} />
                    </span>
                    <span className="pp-todo-body">
                      <b>{td.label}</b>
                      <small>{td.sub}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Latest vitals */}
          {vitalDefs.length > 0 && (
            <div className="pp-tiles">
              {vitalDefs.map(v => (
                <div key={v.key} className="pp-tile">
                  <p className="pp-tile-label">{v.label}</p>
                  <p className="pp-tile-value">{String(vitals[v.key])} <small>{v.unit}</small></p>
                  {latestDate && <p className="pp-tile-sub">{shortDate(latestDate)} · {latestVisitType}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="pp-grid2">
            {/* Upcoming appointments */}
            <div className="pp-card">
              <div className="pp-card-head">
                <h2>{t('patientPortal.upcomingAppointments')}</h2>
                <button type="button" className="pp-card-link" onClick={() => goTab('appointments')}>All ›</button>
              </div>
              {upcomingApts.length > 0 ? upcomingApts.slice(0, 3).map(apt => {
                const { day, mon } = dateParts(apt.appointmentDate);
                const chip = aptChip(apt.status);
                return (
                  <div key={apt._id} className="pp-row" style={{ padding: '11px 14px' }}>
                    <div className="pp-date-plate">
                      <b>{day}</b>
                      <small>{mon}</small>
                    </div>
                    <div className="pp-row-main">
                      <b style={{ fontSize: 13 }}>{apt.reason || apt.appointmentType}</b>
                      <span style={{ fontSize: 11.5 }}>{apt.appointmentTime ? `${formatClockTime(apt.appointmentTime)} · ` : ''}{apt.providerName ? `${/^dr\.?\s/i.test(apt.providerName) ? apt.providerName : `${t('patientPortal.drPrefix')} ${apt.providerName}`} · ` : ''}{apt.department}</span>
                    </div>
                    <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                  </div>
                );
              }) : (
                <div style={{ padding: '14px', fontSize: 12, color: '#5D728B' }}>
                  {t('patientPortal.noUpcomingAppointments')}
                </div>
              )}
            </div>

            {/* Current medications */}
            <div className="pp-card">
              <div className="pp-card-head"><h2>{t('patient.medications')}</h2></div>
              {activeRx.length > 0 ? activeRx.map(rx => (
                <div key={rx._id} className="pp-row" style={{ padding: '10px 14px' }}>
                  <div className="pp-row-main">
                    <b style={{ fontSize: 13 }}>{rx.medication}</b>
                    <span style={{ fontSize: 11.5 }}>{formatRxSig(rx)}</span>
                  </div>
                  <span style={{ flex: 'none', fontSize: 11, color: 'var(--ehr-muted)', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{rx.status}</span>
                </div>
              )) : (
                <div style={{ padding: '14px', fontSize: 12, color: '#5D728B' }}>{t('patientPortal.noMedications')}</div>
              )}
              <button type="button" className="pp-card-foot" onClick={() => goTab('prescriptions')}>All prescriptions ›</button>
            </div>

            {/* Health alerts */}
            <div className="pp-card">
              <div className="pp-card-head"><h2>{t('patientPortal.healthAlerts')}</h2></div>
              {realAllergies.length === 0 && realConditions.length === 0 && pendingLabCount === 0 && !hasCritical ? (
                <div style={{ padding: '14px', fontSize: 12, color: '#0A6E4A' }}>{t('patientPortal.noHealthAlerts')}</div>
              ) : (
                <>
                  {realAllergies.length > 0 && (
                    <div className="pp-row" style={{ alignItems: 'flex-start', padding: '11px 14px' }}>
                      <i className="pp-dot" style={{ background: '#9E1B14' }} />
                      <div className="pp-row-main">
                        <b style={{ fontSize: 13 }}>{t('patient.allergies')}</b>
                        <span style={{ fontSize: 11.5, lineHeight: 1.45 }}>{realAllergies.join(', ')}</span>
                      </div>
                    </div>
                  )}
                  {realConditions.map((c, i) => (
                    <div key={i} className="pp-row" style={{ alignItems: 'flex-start', padding: '11px 14px' }}>
                      <i className="pp-dot" style={{ background: '#B35900' }} />
                      <div className="pp-row-main">
                        <b style={{ fontSize: 13 }}>{c}</b>
                        <span style={{ fontSize: 11.5 }}>{t('patient.chronicConditions')}</span>
                      </div>
                    </div>
                  ))}
                  {hasCritical && (
                    <div className="pp-row" style={{ alignItems: 'flex-start', padding: '11px 14px' }}>
                      <i className="pp-dot" style={{ background: '#9E1B14' }} />
                      <div className="pp-row-main">
                        <b style={{ fontSize: 13 }}>{t('patientPortal.criticalLabAlert')}</b>
                        <span style={{ fontSize: 11.5 }}>{t('patientPortal.tabLabResults')}</span>
                      </div>
                    </div>
                  )}
                  {pendingLabCount > 0 && (
                    <div className="pp-row" style={{ alignItems: 'flex-start', padding: '11px 14px' }}>
                      <i className="pp-dot" style={{ background: 'var(--accent-primary)' }} />
                      <div className="pp-row-main">
                        <b style={{ fontSize: 13 }}>{t('patientPortal.pendingLabResults', { count: pendingLabCount })}</b>
                        <span style={{ fontSize: 11.5 }}>Results are released after your clinician reviews them.</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Recent activity */}
            <div className="pp-card">
              <div className="pp-card-head"><h2>{t('patientPortal.recentActivity')}</h2></div>
              {activity.length > 0 ? activity.slice(0, 4).map(ac => (
                <div key={ac.key} className="pp-activity-row">
                  <span>{ac.what}</span>
                  <small>{shortDate(ac.when)}</small>
                </div>
              )) : (
                <div style={{ padding: '14px', fontSize: 12, color: '#5D728B' }}>{t('patientPortal.noRecentActivity')}</div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* ═══ Appointments ═══ */}
      {activeTab === 'appointments' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabAppointments')}</h1>
              <p className="pp-head-note">Upcoming and past visits.</p>
            </div>
            <button type="button" className="pp-btn pp-btn-primary" onClick={() => setShowBooking(true)}>{t('patientPortal.bookAppointment')}</button>
          </div>
          {appointments.length === 0 ? (
            <Empty icon={Calendar} text={t('patientPortal.noAppointmentsYet')} action={t('patientPortal.bookAppointment')} onAction={() => setShowBooking(true)} />
          ) : (
            <div className="pp-card">
              {appointments.slice().sort((a, b) => b.appointmentDate.localeCompare(a.appointmentDate)).map(apt => {
                const chip = aptChip(apt.status);
                return (
                  <div key={apt._id} className="pp-row">
                    <div className="pp-row-main">
                      <b>{apt.reason || apt.appointmentType}{apt.providerName ? ` — ${/^dr\.?\s/i.test(apt.providerName) ? apt.providerName : `${t('patientPortal.drPrefix')} ${apt.providerName}`}` : ''}</b>
                      <span>{shortDate(apt.appointmentDate)}{apt.appointmentTime ? ` · ${formatClockTime(apt.appointmentTime)}` : ''} · {apt.department}</span>
                    </div>
                    <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Records ═══ */}
      {activeTab === 'records' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabMedicalRecords')}</h1>
              <p className="pp-head-note">Notes and visit summaries your clinicians have shared with you.</p>
            </div>
          </div>
          {records.length === 0 ? (
            <Empty icon={FileText} text={t('patientPortal.noMedicalRecords')} />
          ) : (
            <div className="pp-card">
              {records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(rec => {
                const r = rec as unknown as Record<string, unknown>;
                const vitalSigns = r.vitalSigns as Record<string, unknown> | undefined;
                const recRx = (r.prescriptions as Array<{ medication: string; dosage: string }> | undefined) || [];
                const open = expandedId === rec._id;
                return (
                  <div key={rec._id} style={{ borderBottom: '1px solid #F1F3F5' }}>
                    <button type="button" className="pp-row-toggle" onClick={() => setExpandedId(open ? null : rec._id)}>
                      <div className="pp-row-main">
                        <b>{(r.visitType as string) || t('patientPortal.consultation')}</b>
                        <span>{shortDate(rec.createdAt?.slice(0, 10) || '')} · {((r.diagnoses as Array<{ name: string }>) || []).map(d => d.name).join(', ') || t('patientPortal.noDiagnosisRecorded')}</span>
                      </div>
                      <span className="pp-row-action" aria-hidden>
                        View <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                      </span>
                    </button>
                    {open && (
                      <div className="pp-row-detail">
                        <div className="pp-row-detail-box" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                          {vitalSigns && (
                            <div>
                              <p className="pp-field-label" style={{ margin: 0 }}>{t('patientPortal.vitalSigns')}</p>
                              {Object.entries(vitalSigns)
                                .filter(([k, v]) => v && k !== 'recordedAt')
                                .map(([k, v]) => (
                                  // camelCase key → spaced lowercase label ("respiratoryRate" → "respiratory rate")
                                  <p key={k} className="pp-field-value">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}: <strong>{String(v)}</strong></p>
                                ))}
                            </div>
                          )}
                          {recRx.filter(rx => rx.medication).length > 0 && (
                            <div>
                              <p className="pp-field-label" style={{ margin: 0 }}>{t('patientPortal.tabPrescriptions')}</p>
                              {recRx.filter(rx => rx.medication).map((rx, i) => (
                                <p key={i} className="pp-field-value">{rx.medication}{rx.dosage ? ` — ${rx.dosage}` : ''}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Lab Results ═══ */}
      {activeTab === 'lab' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabLabResults')}</h1>
              <p className="pp-head-note">Results are released after your clinician reviews them.</p>
            </div>
          </div>
          {labResults.length === 0 ? (
            <Empty icon={FlaskConical} text={t('patientPortal.noLabResults')} />
          ) : (
            <div className="pp-card">
              {labResults.slice().sort((a, b) => (b.orderedAt || b.createdAt).localeCompare(a.orderedAt || a.createdAt)).map(lab => {
                const open = expandedId === lab._id;
                const chip = lab.status === 'pending'
                  ? { tone: 'yellow' as ChipTone, label: 'Pending review' }
                  : lab.status === 'completed'
                    ? (lab.abnormal ? { tone: 'red' as ChipTone, label: t('patientPortal.abnormal') } : { tone: 'green' as ChipTone, label: t('patientPortal.normal') })
                    : { tone: 'neutral' as ChipTone, label: lab.status };
                return (
                  <div key={lab._id} style={{ borderBottom: '1px solid #F1F3F5' }}>
                    <button type="button" className="pp-row-toggle" onClick={() => setExpandedId(open ? null : lab._id)}>
                      <div className="pp-row-main">
                        <b>{lab.testName}</b>
                        <span>{shortDate((lab.orderedAt || lab.createdAt).slice(0, 10))}{lab.specimen ? ` · ${lab.specimen}` : ''}{lab.orderedBy ? ` · ${lab.orderedBy}` : ''}</span>
                      </div>
                      <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                      {lab.status === 'completed' && (
                        <span className="pp-row-action" aria-hidden>
                          View <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                        </span>
                      )}
                    </button>
                    {open && lab.status === 'completed' && (
                      <div className="pp-row-detail">
                        <div className="pp-row-detail-box" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div>
                            <p className="pp-field-label" style={{ margin: 0 }}>{t('patientPortal.result')}</p>
                            <p style={{ margin: '2px 0 0', fontFamily: 'var(--font-condensed)', fontSize: 17, fontWeight: 600, color: lab.abnormal ? '#9E1B14' : '#113055' }}>{lab.result}</p>
                          </div>
                          {lab.referenceRange && (
                            <div style={{ textAlign: 'end' }}>
                              <p className="pp-field-label" style={{ margin: 0 }}>{t('patientPortal.reference')}</p>
                              <p className="pp-field-value">{lab.referenceRange} {lab.unit}</p>
                            </div>
                          )}
                        </div>
                        {lab.critical && (
                          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <AlertTriangle size={12} style={{ color: '#9E1B14' }} />
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#9E1B14' }}>{t('patientPortal.criticalResult')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Prescriptions ═══ */}
      {activeTab === 'prescriptions' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabPrescriptions')}</h1>
              <p className="pp-head-note">What you have been prescribed, and what each is for.</p>
            </div>
          </div>
          {prescriptions.length === 0 ? (
            <Empty icon={Pill} text={t('patientPortal.noPrescriptions')} />
          ) : (
            <div className="pp-card">
              {prescriptions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(rx => (
                <div key={rx._id} className="pp-row">
                  <div className="pp-row-main">
                    <b>{rx.medication}</b>
                    <span>{formatRxSig(rx)}{rx.prescribedBy ? ` · ${t('patientPortal.prescribedBy', { name: rx.prescribedBy })}` : ''}</span>
                  </div>
                  <span className="pp-row-value">{shortDate(rx.createdAt.slice(0, 10))}</span>
                  <span className={`pp-chip pp-chip--${rx.status === 'dispensed' ? 'green' : 'yellow'}`}>{rx.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Radiology & Imaging ═══ */}
      {activeTab === 'radiology' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabRadiology')}</h1>
              {/* Honesty note: these are imaging-related order/report records
                  pulled from lab results — NOT the actual scan images. */}
              <p className="pp-head-note">{t('patientPortal.imagingDisclaimer')}</p>
            </div>
          </div>
          {(() => {
            const imagingTests = labResults.filter(l =>
              /x-ray|xray|mri|ct scan|ultrasound|radiology|imaging|echo|mammogram/i.test(l.testName || '')
            );
            return imagingTests.length > 0 ? (
              <div className="pp-card">
                {imagingTests.map(img => (
                  <div key={img._id} className="pp-row">
                    <div className="pp-row-main">
                      <b>{img.testName}</b>
                      <span>{shortDate((img.orderedAt || img.createdAt).slice(0, 10))}{img.orderedBy ? ` · ${img.orderedBy}` : ''}</span>
                    </div>
                    <span className={`pp-chip pp-chip--${img.status === 'pending' ? 'yellow' : 'green'}`}>{img.status === 'pending' ? 'Pending' : 'Reported'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <Empty icon={Scan} text={t('patientPortal.noImagingResults')} />
                <div className="pp-card" style={{ marginTop: 14 }}>
                  <div className="pp-card-head"><h2>{t('patientPortal.availableImagingServices')}</h2></div>
                  {['X-Ray', 'Ultrasound', 'CT Scan', 'MRI', 'Echocardiogram', 'Mammogram'].map(svc => (
                    <div key={svc} className="pp-row">
                      <div className="pp-row-main">
                        <b>{svc}</b>
                        <span>{t('patientPortal.imagingNotice')}</span>
                      </div>
                      <span className="pp-chip pp-chip--blue">Service</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ═══ Billing & Payments ═══ */}
      {activeTab === 'billing' && <BillingTab patient={patient} sessionToken={sessionToken} />}

      {/* ═══ Immunizations ═══ */}
      {activeTab === 'immunizations' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabImmunizations')}</h1>
              <p className="pp-head-note">{t('patientPortal.immunizationNotice')}</p>
            </div>
          </div>
          {immunizations.length === 0 ? (
            <Empty icon={Syringe} text={t('patientPortal.noImmunizations')} />
          ) : (
            <div className="pp-card">
              {immunizations.slice().sort((a, b) => b.dateGiven.localeCompare(a.dateGiven)).map(imm => {
                const today = todayIso();
                const due = imm.nextDueDate && imm.nextDueDate >= today;
                return (
                  <div key={imm._id} className="pp-row">
                    <div className="pp-row-main">
                      <b>{imm.vaccine} — {t('patientPortal.doseNumber', { number: imm.doseNumber })}</b>
                      <span>{t('patientPortal.siteBatch', { site: imm.site, batch: imm.batchNumber })} · {t('patientPortal.administeredBy', { name: imm.administeredBy, facility: imm.facilityName })}</span>
                    </div>
                    <span className="pp-row-value">{shortDate(imm.dateGiven)}</span>
                    {due ? (
                      <>
                        <span className="pp-chip pp-chip--yellow">{t('patientPortal.nextDue', { date: shortDate(imm.nextDueDate!) })}</span>
                        <button type="button" className="pp-row-action" onClick={() => setShowBooking(true)}>Book</button>
                      </>
                    ) : (
                      <span className="pp-chip pp-chip--green">Given</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Chat / Messages ═══ */}
      {activeTab === 'chat' && (
        <div>
          <div className="pp-head">
            <div>
              <h1>{t('patientPortal.tabMessages')}</h1>
              <p className="pp-head-note">Your care team replies within one working day. For emergencies call 911 or come to the facility.</p>
            </div>
          </div>
          <div className="pp-card pp-chat">
            <div className="pp-card-head">
              <h2>{patientFacilityName}</h2>
              <div style={{ flex: 'none', width: 190 }}>
                <Select value={chatDepartment} onChange={e => setChatDepartment(e.target.value)}
                  aria-label={t('patientPortal.department')}
                  style={{ width: '100%', height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid #ECEEF1', background: '#FFFFFF', color: '#113055', fontSize: 12, fontFamily: 'var(--font-platform)' }}>
                  {['General / OPD', 'Internal Medicine', 'Obstetrics', 'Pediatrics', 'Surgery', 'Laboratory', 'Pharmacy', 'Dental', 'Emergency'].map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="pp-chat-scroll">
              {chatMessages.map((msg, i) => (
                <div key={msg.id || i} className={`pp-bubble-line ${msg.from === 'patient' ? 'me' : ''}`}>
                  <div className="pp-bubble">
                    {msg.text}
                    <small>{msg.time}</small>
                  </div>
                </div>
              ))}
            </div>
            {chatError && (
              <div style={{ padding: '8px 14px', borderTop: '1px solid #F1F3F5', background: 'rgba(158, 27, 20,0.06)', color: '#9E1B14', fontSize: 12 }}>
                {chatError}
              </div>
            )}
            <div className="pp-composer">
              <input
                type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { void handleSendChat(); } }}
                placeholder={t('patientPortal.messagePlaceholder', { department: chatDepartment })}
                disabled={chatSending}
              />
              <button type="button" className="pp-btn pp-btn-primary"
                onClick={() => { void handleSendChat(); }}
                disabled={chatSending || !chatInput.trim()}
                aria-label={t('patientPortal.sendMessage')}>
                <Send size={14} strokeWidth={1.8} /> {t('patientPortal.sendMessage')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ My Profile ═══ */}
      {activeTab === 'profile' && (
        <ProfileTab patient={patient} />
      )}

      {/* Booking Modal */}
      {showBooking && (
        <Modal onClose={() => { setShowBooking(false); resetBookingForm(); }}>
          <div className="modal-panel modal-panel--md">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{t('patientPortal.requestAppointment')}</h3>
              <button onClick={() => { setShowBooking(false); resetBookingForm(); }} style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--overlay-subtle)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}><X size={14} /></button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>{t('patientPortal.bookingNotice')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--accent-light)', border: '1px solid var(--accent-border)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{t('patientPortal.bookingAt', { facility: patientFacilityName })}</span>
              </div>
              <div><label>{t('patientPortal.preferredDate')}</label><input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} min={todayIso()} /></div>
              <div><label>{t('patientPortal.preferredTime')}</label>
                <Select value={bookingTime} onChange={e => setBookingTime(e.target.value as typeof bookingTime)}>
                  <option value="morning">{t('patientPortal.timeMorning')}</option>
                  <option value="afternoon">{t('patientPortal.timeAfternoon')}</option>
                  <option value="any">{t('patientPortal.timeAnyTime')}</option>
                </Select>
              </div>
              <div><label>{t('patientPortal.department')}</label>
                <Select value={bookingDepartment} onChange={e => setBookingDepartment(e.target.value)}>
                  <option>General / OPD</option><option>Obstetrics</option><option>Internal Medicine</option><option>Pediatrics</option><option>Surgery</option><option>Laboratory</option><option>Dental</option>
                </Select>
              </div>
              <div><label>{t('patientPortal.reason')}</label><textarea rows={3} placeholder={t('patientPortal.reasonPlaceholder')} value={bookingReason} onChange={e => setBookingReason(e.target.value)} /></div>
              {bookingError && <p style={{ fontSize: 12, color: 'var(--color-danger-text)' }}>{bookingError}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={() => { setShowBooking(false); resetBookingForm(); }} className="btn btn-secondary" style={{ flex: 1 }} disabled={bookingSubmitting}>{t('action.cancel')}</button>
                <button onClick={handleSubmitBooking} className="btn btn-primary" style={{ flex: 1 }} disabled={bookingSubmitting || !bookingDate || !bookingDepartment}>
                  {bookingSubmitting ? t('status.loading') : t('patientPortal.submitRequest')}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

          </div>
        </main>
      </div>

      {/* Confirmation toast — only after an action actually persisted. */}
      {toast && (
        <div className="pp-toast" role="status">
          <CheckCircle2 size={14} strokeWidth={2.2} />{toast}
        </div>
      )}
    </div>
  );
}
