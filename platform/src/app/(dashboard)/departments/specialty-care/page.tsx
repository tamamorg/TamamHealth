'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Select from '@/components/Select';
import { apiFetch } from '@/lib/api-fetch';
import { usePatients } from '@/lib/hooks/usePatients';
import { useDepartments } from '@/lib/hooks/useDepartments';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useUsers } from '@/lib/hooks/useUsers';
import { useAssets } from '@/lib/hooks/useAssets';
import { patientDisplayName } from '@/lib/patient-utils';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ClipboardList, Plus, Save } from '@/components/icons/lucide';
import EhrPageTitle from '@/components/ehr/EhrPageTitle';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useSpecialtyEpisodes } from '@/lib/hooks/useSpecialtyEpisodes';
import { useSpecialtyPathwayConfigs } from '@/lib/hooks/useSpecialtyPathwayConfigs';
import { SPECIALTY_PATHWAYS, getSpecialtyPathway, validateSpecialtyEpisode } from '@/modules/specialty-care';
import type { SpecialtyCareEpisodeDoc, SpecialtyEpisodeStatus, SpecialtyFieldDefinition, SpecialtyFieldValue, SpecialtyPathwayCode, SpecialtyPathwayConfigDoc } from '@/modules/specialty-care';
import type { RestrictedMentalHealthNote, RestrictedMentalHealthNoteCategory } from '@/modules/specialty-care';
import { useTranslation } from '@/lib/i18n/useTranslation';

const STATUS_LABELS: Record<SpecialtyEpisodeStatus, string> = {
  planned: 'Planned', in_progress: 'In progress', awaiting_review: 'Awaiting review', completed: 'Completed', cancelled: 'Cancelled',
};
type ConfigDraft = { status: SpecialtyPathwayConfigDoc['status']; clinicalOwnerName: string; sopReference: string; reviewDueAt: string };

function FieldEditor({ definition, value, onChange, disabled, selectText, referenceOptions = [] }: {
  definition: SpecialtyFieldDefinition;
  value?: SpecialtyFieldValue;
  onChange: (value: SpecialtyFieldValue) => void;
  disabled: boolean;
  selectText: string;
  referenceOptions?: readonly { value: string; label: string }[];
}) {
  const { t } = useTranslation();
  const id = useId();
  const notApplicable = definition.allowNotApplicable && value === 'not_applicable';
  const help = definition.help || t(`field.help.${definition.kind}`);
  const label = <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{definition.label}{definition.unit ? ` (${definition.unit})` : ''}{definition.requiredToComplete ? ' *' : ''}</span>;
  const common = { id, disabled: disabled || Boolean(notApplicable), 'aria-label': definition.label, 'aria-describedby': `${id}-help`, 'aria-required': definition.requiredToComplete };
  let control;
  if (definition.kind === 'boolean') {
    control = <input {...common} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />;
  } else if (definition.kind === 'select') {
    control = <Select {...common} className="form-input" value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)}><option value="">{selectText}</option>{definition.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>;
  } else if (definition.kind === 'multi_select') {
    const selected = Array.isArray(value) ? value : [];
    control = <div className="flex flex-wrap gap-2">{definition.options?.map(option => <label key={option.value} className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs"><input type="checkbox" disabled={disabled} checked={selected.includes(option.value)} onChange={event => {
      const exclusive = definition.exclusiveOptions ?? [];
      onChange(!event.target.checked ? selected.filter(item => item !== option.value) : exclusive.includes(option.value) ? [option.value] : [...selected.filter(item => !exclusive.includes(item)), option.value]);
    }} />{option.label}</label>)}</div>;
  } else if (definition.kind === 'long_text') {
    control = <textarea {...common} className="form-input min-h-24" value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} />;
  } else {
    control = <input {...common} className="form-input" type={definition.kind === 'datetime' ? 'datetime-local' : definition.kind} min={definition.min} max={definition.max} step={definition.step} value={notApplicable ? '' : typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={event => onChange(definition.kind === 'number' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value)} />;
  }
  const suggestions = referenceOptions.length ? referenceOptions : definition.suggestions?.map(item => ({ value: item, label: item })) ?? [];
  return <fieldset className="grid gap-1">
    <legend>{label}</legend>
    {suggestions.length > 0 && <Select aria-label={`${definition.label} — ${t('field.suggestions')}`} className="form-input" disabled={disabled || Boolean(notApplicable)} value="" onChange={event => { if (event.target.value) onChange(definition.kind === 'long_text' && typeof value === 'string' && value.trim() ? `${value}; ${event.target.value}` : event.target.value); }}><option value="">{t('field.suggestions')}</option>{suggestions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>}
    {control}
    {definition.allowNotApplicable && <label className="flex gap-2"><input type="checkbox" disabled={disabled} checked={Boolean(notApplicable)} onChange={event => onChange(event.target.checked ? 'not_applicable' : '')} />{t('field.notApplicable')}</label>}
    <small id={`${id}-help`} style={{ color: 'var(--text-muted)' }}>{help}</small>
  </fieldset>;
}

export default function SpecialtyCarePage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { patients } = usePatients();
  const { departments } = useDepartments(scope?.hospitalId);
  const { appointments } = useAppointments();
  const { users } = useUsers();
  const { assets } = useAssets();
  const [appointmentId, setAppointmentId] = useState('');
  const selectedEpisodeId = useRef<string | null>(null);
  const [pathwayCode, setPathwayCode] = useState<SpecialtyPathwayCode>('haemodialysis');
  const { episodes, loading, error, reload } = useSpecialtyEpisodes(pathwayCode);
  const { configs, reload: reloadConfigs } = useSpecialtyPathwayConfigs();
  const [active, setActive] = useState<SpecialtyCareEpisodeDoc | null>(null);
  const [values, setValues] = useState<Record<string, SpecialtyFieldValue>>({});
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [restrictedNotes, setRestrictedNotes] = useState<RestrictedMentalHealthNote[]>([]);
  const [restrictedNarrative, setRestrictedNarrative] = useState('');
  const [restrictedCategory, setRestrictedCategory] = useState<RestrictedMentalHealthNoteCategory>('assessment');
  const [configDrafts, setConfigDrafts] = useState<Partial<Record<SpecialtyPathwayCode, ConfigDraft>>>({});
  const pathway = getSpecialtyPathway(pathwayCode);
  const sections = useMemo(() => [...new Set(pathway.fields.map((item) => item.section))], [pathway]);
  const finalized = active?.status === 'completed' || active?.status === 'cancelled';
  const canAuthorRestrictedNote = currentUser?.specialtyCode === 'psychiatry' || currentUser?.role === 'super_admin' || currentUser?.role === 'medical_superintendent';
  const canConfigure = ['super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager'].includes(currentUser?.role || '');
  const currentConfig = configs.find((item) => item.pathway === pathwayCode && item.hospitalId === scope?.hospitalId);
  const pathwayEnabled = currentConfig?.status === 'pilot' || currentConfig?.status === 'active';
  const configDraft = configDrafts[pathwayCode] ?? { status: currentConfig?.status ?? 'draft', clinicalOwnerName: currentConfig?.clinicalOwnerName ?? '', sopReference: currentConfig?.sopReference ?? '', reviewDueAt: currentConfig?.reviewDueAt?.slice(0, 10) ?? '' };

  useEffect(() => {
    if (pathwayCode !== 'mental_health' || !active || !canAuthorRestrictedNote) return;
    const controller = new AbortController();
    const episodeId = active._id;
    void fetch(`/api/restricted-mental-health-notes?patientId=${encodeURIComponent(active.patientId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { notes?: RestrictedMentalHealthNote[]; error?: string };
        if (!response.ok) throw new Error(body.error || 'Restricted notes could not be loaded');
        if (!controller.signal.aborted && selectedEpisodeId.current === episodeId) setRestrictedNotes(body.notes ?? []);
      })
      .catch((cause) => { if (!controller.signal.aborted && selectedEpisodeId.current === episodeId) setMessage(cause instanceof Error ? cause.message : 'Restricted notes could not be loaded'); });
    return () => controller.abort();
  }, [active, canAuthorRestrictedNote, pathwayCode]);

  const choosePathway = (code: SpecialtyPathwayCode) => {
    selectedEpisodeId.current = null; setRestrictedNarrative(''); setRestrictedCategory('assessment'); setPatientId(''); setPatientName(''); setAppointmentId('');
    setPathwayCode(code); setActive(null); setValues({}); setRestrictedNotes([]); setMessage(null);
  };
  const openEpisode = (episode: SpecialtyCareEpisodeDoc) => {
    selectedEpisodeId.current = episode._id; setRestrictedNarrative(''); setRestrictedCategory('assessment');
    setActive(episode); setValues(episode.values); setPatientId(episode.patientId); setPatientName(episode.patientName); setRestrictedNotes([]); setMessage(null);
  };
  const create = async () => {
    if (!scope?.orgId || !scope.hospitalId || !currentUser) { setMessage('A facility and organization context is required.'); return; }
    setSaving(true); setMessage(null);
    try {
      const { createSpecialtyEpisode } = await import('@/modules/specialty-care/services/specialty-care-service');
      const appointment = appointments.find(item => item._id === appointmentId && item.patientId === patientId);
      const department = departments.find(item => item.isActive && pathway.departmentCodes.includes(item.code));
      const created = await createSpecialtyEpisode({ pathway: pathwayCode, patientId, patientName, departmentId: department?._id, appointmentId: appointment?._id, hospitalId: scope.hospitalId, facilityName: currentUser.hospitalName, orgId: scope.orgId, responsibleClinicianId: currentUser._id, responsibleClinicianName: currentUser.name, scope, actor: { id: currentUser._id, name: currentUser.name } });
      selectedEpisodeId.current = created._id;
      setActive(created); setValues(created.values); await reload(); setMessage('Episode created.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The episode could not be created.'); }
    finally { setSaving(false); }
  };
  const save = async (status?: SpecialtyEpisodeStatus) => {
    if (!active || !scope || !currentUser) return;
    setSaving(true); setMessage(null);
    try {
      const { updateSpecialtyEpisode } = await import('@/modules/specialty-care/services/specialty-care-service');
      const updated = await updateSpecialtyEpisode({ id: active._id, scope, values, status, actor: { id: currentUser._id, name: currentUser.name } });
      setActive(updated); setValues(updated.values); await reload(); setMessage(status === 'completed' ? 'Episode completed.' : 'Changes saved.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Changes could not be saved.'); }
    finally { setSaving(false); }
  };
  const addRestrictedNote = async () => {
    if (!active || !restrictedNarrative.trim()) return;
    const episodeId = active._id;
    setSaving(true); setMessage(null);
    try {
      const response = await apiFetch('/api/restricted-mental-health-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId: active.patientId, patientName: active.patientName, episodeId: active._id, category: restrictedCategory, narrative: restrictedNarrative }) });
      const body = await response.json() as { note?: RestrictedMentalHealthNote; error?: string };
      if (!response.ok || !body.note) throw new Error(body.error || 'Restricted note could not be created');
      if (selectedEpisodeId.current === episodeId) { setRestrictedNotes((current) => [body.note!, ...current]); setRestrictedNarrative(''); setMessage('Encrypted restricted note saved.'); }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Restricted note could not be created'); }
    finally { setSaving(false); }
  };
  const setConfigField = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => setConfigDrafts((current) => ({ ...current, [pathwayCode]: { ...configDraft, [key]: value } }));
  const saveConfig = async () => {
    if (!scope?.orgId || !scope.hospitalId || !currentUser) return;
    setSaving(true); setMessage(null);
    try {
      const { configureSpecialtyPathway } = await import('@/modules/specialty-care/services/specialty-care-service');
      await configureSpecialtyPathway({ pathway: pathwayCode, hospitalId: scope.hospitalId, facilityName: currentUser.hospitalName, orgId: scope.orgId, ...configDraft, scope, actor: { id: currentUser._id, name: currentUser.name } });
      await reloadConfigs(); setMessage(t('specialtyCare.configSaved'));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : t('specialtyCare.configError')); }
    finally { setSaving(false); }
  };
  const validation = active ? validateSpecialtyEpisode({ ...active, values, status: 'completed' }) : null;

  return <div className="p-4 md:p-6 space-y-5">
    <div><Link href="/departments" className="inline-flex items-center gap-1 text-xs mb-2" style={{ color: 'var(--accent-primary)' }}><ArrowLeft className="w-3.5 h-3.5" /> {t('specialtyCare.departments')}</Link><EhrPageTitle>{t('specialtyCare.title')}</EhrPageTitle><p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{t('specialtyCare.subtitle')}</p></div>

    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div className="rounded-xl border p-3 space-y-1" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>{SPECIALTY_PATHWAYS.map((item) => <button key={item.code} className="w-full rounded-lg px-3 py-2 text-left" style={{ background: item.code === pathwayCode ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)' }} onClick={() => choosePathway(item.code)}><span className="block text-sm font-semibold">{item.name}</span><span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.summary}</span></button>)}</div>
        <div className="rounded-xl border p-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}><h2 className="text-sm font-semibold">{t('specialtyCare.recent')}</h2>{loading ? <p className="text-xs mt-2">{t('specialtyCare.loading')}</p> : error ? <p className="text-xs mt-2" style={{ color: 'var(--color-danger-text)' }}>{error}</p> : episodes.length ? <div className="mt-2 space-y-1">{episodes.map((episode) => <button key={episode._id} className="w-full rounded-lg border p-2 text-left" style={{ borderColor: active?._id === episode._id ? 'var(--accent-primary)' : 'var(--border-color)' }} onClick={() => openEpisode(episode)}><span className="block text-sm font-medium">{episode.patientName}</span><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{STATUS_LABELS[episode.status]}</span></button>)}</div> : <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{t('specialtyCare.empty')}</p>}</div>
      </aside>

      <main className="space-y-4">
        <section className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{pathway.name}</h2><p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{pathway.safetyNote}</p></div><a href={pathway.evidenceUrl} target="_blank" rel="noreferrer" className="text-xs underline shrink-0" style={{ color: 'var(--accent-primary)' }}>{pathway.evidenceLabel}</a></div></section>

        {!pathwayEnabled && <section className="rounded-xl border p-4 text-sm" style={{ background: 'var(--bg-card)', borderColor: 'var(--color-warning-border)' }}>{t('specialtyCare.notActive')}</section>}
        {canConfigure && <section className="rounded-xl border p-4 space-y-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}><div><h2 className="font-semibold">{t('specialtyCare.activation')}</h2><p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('specialtyCare.activationHelp')}</p></div><div className="grid gap-3 md:grid-cols-2"><label className="grid gap-1"><span className="text-xs font-semibold">{t('specialtyCare.status')}</span><select className="form-input" value={configDraft.status} onChange={(event) => setConfigField('status', event.target.value as ConfigDraft['status'])}><option value="draft">{t('specialtyCare.status.draft')}</option><option value="pilot">{t('specialtyCare.status.pilot')}</option><option value="active">{t('specialtyCare.status.active')}</option><option value="paused">{t('specialtyCare.status.paused')}</option></select></label><label className="grid gap-1"><span className="text-xs font-semibold">{t('specialtyCare.owner')}</span><input className="form-input" value={configDraft.clinicalOwnerName} onChange={(event) => setConfigField('clinicalOwnerName', event.target.value)} /></label><label className="grid gap-1"><span className="text-xs font-semibold">{t('specialtyCare.sop')}</span><input className="form-input" value={configDraft.sopReference} onChange={(event) => setConfigField('sopReference', event.target.value)} /></label><label className="grid gap-1"><span className="text-xs font-semibold">{t('specialtyCare.reviewDue')}</span><input className="form-input" type="date" value={configDraft.reviewDueAt} onChange={(event) => setConfigField('reviewDueAt', event.target.value)} /></label></div><button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void saveConfig()}><Save className="w-4 h-4" /> {t('specialtyCare.saveConfig')}</button>{currentConfig && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('specialtyCare.version', { version: currentConfig.version })}</p>}</section>}

        {!active ? <section className="rounded-xl border p-4 space-y-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}><h2 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> {t('specialtyCare.start')} {pathway.name.toLowerCase()}</h2><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1"><span className="text-xs font-semibold">{t('specialtyCare.patientId')}</span><select className="form-input" value={patientId} onChange={(event) => { setPatientId(event.target.value); setPatientName(patientDisplayName(patients.find(item => item._id === event.target.value) ?? { firstName: '', surname: '' })); setAppointmentId(''); }}><option value="">{t('specialtyCare.select')}</option>{patients.map(patient => <option key={patient._id} value={patient._id}>{patientDisplayName(patient)} · {patient._id}</option>)}</select></label><label className="grid gap-1"><span className="text-xs font-semibold">{t('specialtyCare.patientName')}</span><input className="form-input" value={patientName} readOnly /></label><label className="grid gap-1"><span className="text-xs font-semibold">{t('specialtyCare.appointment')}</span><select className="form-input" value={appointmentId} onChange={event => setAppointmentId(event.target.value)}><option value="">{t('specialtyCare.select')}</option>{appointments.filter(item => item.patientId === patientId).map(item => <option key={item._id} value={item._id}>{item.appointmentDate} · {item.department}</option>)}</select></label></div><button className="btn btn-primary btn-sm" disabled={saving || !pathwayEnabled || !patientId.trim() || !patientName.trim()} onClick={() => void create()}><Plus className="w-4 h-4" /> {t('specialtyCare.create')}</button></section>
        : <>
          <section className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}><div><h2 className="font-semibold">{active.patientName}</h2><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{active.patientId} · {STATUS_LABELS[active.status]}</p></div><div className="flex flex-wrap gap-2">{active.status === 'planned' && <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void save('in_progress')}>{t('specialtyCare.begin')}</button>}<button className="btn btn-secondary btn-sm" disabled={saving || finalized} onClick={() => void save()}><Save className="w-4 h-4" /> {t('specialtyCare.save')}</button><button className="btn btn-primary btn-sm" disabled={saving || finalized || validation?.valid === false} onClick={() => void save('completed')}><CheckCircle2 className="w-4 h-4" /> {t('specialtyCare.complete')}</button></div></section>
          {sections.map((section) => <section key={section} className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}><h3 className="font-semibold mb-3">{section}</h3><div className="grid gap-4 md:grid-cols-2">{pathway.fields.filter((item) => item.section === section).map((definition) => <FieldEditor key={definition.key} definition={definition} referenceOptions={definition.referenceSource === 'staff' ? users.filter(user => user.hospitalId === scope?.hospitalId).map(user => ({ value: user._id, label: user.name })) : definition.referenceSource === 'assets' ? assets.filter(asset => asset.facilityId === scope?.hospitalId && asset.status === 'operational').map(asset => ({ value: asset._id, label: `${asset.name} · ${asset.assetTag}` })) : []} value={values[definition.key]} disabled={Boolean(finalized)} selectText={t('specialtyCare.select')} onChange={(value) => setValues((current) => ({ ...current, [definition.key]: value }))} />)}</div></section>)}
          {pathwayCode === 'mental_health' && canAuthorRestrictedNote && <section className="rounded-xl border p-4 space-y-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}><div><h3 className="font-semibold">{t('specialtyCare.restrictedTitle')}</h3><p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('specialtyCare.restrictedHelp')}</p></div><div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]"><select className="form-input" value={restrictedCategory} onChange={(event) => setRestrictedCategory(event.target.value as RestrictedMentalHealthNoteCategory)}><option value="assessment">{t('specialtyCare.category.assessment')}</option><option value="therapy">{t('specialtyCare.category.therapy')}</option><option value="safeguarding">{t('specialtyCare.category.safeguarding')}</option><option value="risk">{t('specialtyCare.category.risk')}</option><option value="follow_up">{t('specialtyCare.category.followUp')}</option></select><textarea className="form-input min-h-24" value={restrictedNarrative} onChange={(event) => setRestrictedNarrative(event.target.value)} placeholder={t('specialtyCare.restrictedPlaceholder')} /></div><button className="btn btn-secondary btn-sm" disabled={saving || !restrictedNarrative.trim()} onClick={() => void addRestrictedNote()}><Save className="w-4 h-4" /> {t('specialtyCare.saveRestricted')}</button>{restrictedNotes.length > 0 && <div className="space-y-2">{restrictedNotes.map((note) => <article key={note.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs font-semibold capitalize">{note.category.replaceAll('_', ' ')} · {note.authoredByName}</div><p className="mt-2 whitespace-pre-wrap text-sm">{note.narrative}</p><time className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(note.authoredAt).toLocaleString()}</time></article>)}</div>}</section>}
          {validation && !validation.valid && <section className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--color-warning-border)' }}><h3 className="text-sm font-semibold flex items-center gap-2"><ClipboardList className="w-4 h-4" /> {t('specialtyCare.required')}</h3><ul className="mt-2 list-disc pl-5 text-xs space-y-1">{validation.errors.map((item) => <li key={item}>{item}</li>)}</ul></section>}
        </>}
        {message && <p role="status" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{message}</p>}
      </main>
    </div>
  </div>;
}
