'use client';

/**
 * Clinical forms — the chart workspace's form list, in the OpenMRS O3 shape:
 * a search bar over a "Form name (A–Z) / Last completed" table of links.
 *
 * Every note type is a form here (SOAP, H&P, progress, …). Opening one reuses
 * today's draft of that type or starts one, and the note opens in this same
 * workspace as a form, with "Back to clinical forms". The other rows are the
 * app's other clinical record flows (triage, ANC, nutrition, imaging, ward
 * admission). Every one opens here, in the workspace, like a note — the
 * module's own form with this patient fixed — so the chart never leaves the
 * screen. The drawer's expand takes a form full screen.
 *
 * "Last completed" reads the same records the chart's own sections read —
 * signed notes, triage, ANC visits, screenings, admissions — so the date here
 * is always the one the chart shows. Nothing is derived or copied.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search } from '@/components/icons/lucide';
import { NOTE_TYPE_ORDER, type NoteTypeId } from '@/lib/clinical-notes/note-catalog';
import { noteTypeLabel } from '@/lib/clinical-notes/note-labels';
import { useCreateNote } from '@/lib/clinical-notes/useCreateNote';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { patientFullName } from '@/lib/patient-utils';
import { describeError } from '@/lib/user-facing-error';
import { useTriage } from '@/lib/hooks/useTriage';
import { useANC } from '@/lib/hooks/useANC';
import { useNutritionScreenings } from '@/lib/hooks/useNutritionScreenings';
import { useWards } from '@/lib/hooks/useWards';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import { formatDate } from '@/lib/format-utils';
import type { PatientDoc } from '@/lib/db-types';
import { roleFormAllowed } from './role-form-access';
import type { ChartPanelUser } from './types';

interface ClinicalFormItem {
  id: string;
  name: string;
  lastCompleted: string;
  /** The chart workspace form it opens in place (see ROLE_FORM_PANELS). */
  panel: string;
  enabled: boolean;
  /** Shown as the row's tooltip when `enabled` is false. */
  disabledReason?: string;
}

interface ClinicalFormsPanelProps {
  patient: PatientDoc;
  canConsult: boolean;
  currentUser: ChartPanelUser | null | undefined;
  /** Open a note in this workspace as a form (the shell swaps the panel). */
  onOpenNote: (noteId: string, title: string) => void;
  /** Open a workspace form (triage, ANC, nutrition, imaging, ward admission). */
  onOpenForm: (panelId: string) => void;
}

export default function ClinicalFormsPanel({ patient, canConsult, currentUser, onOpenNote, onOpenForm }: ClinicalFormsPanelProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const scope = useDataScope();
  const [search, setSearch] = useState('');
  const { createNote, creating } = useCreateNote(currentUser?._id ? {
    _id: currentUser._id, name: currentUser.name, username: currentUser.username,
    hospitalId: currentUser.hospitalId, hospitalName: currentUser.hospitalName, orgId: currentUser.orgId,
  } : null);
  // The patient's notes, for each note form's "Last completed": the latest
  // signed note of that type — the same records the chart's Notes tab lists.
  const [notes, setNotes] = useState<ClinicalNoteDoc[]>([]);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void import('@/lib/clinical-notes/note-service')
      .then(m => m.listClinicalNotes({ patientId: patient._id, display: 'signed' }, scope))
      .then(rows => { if (!cancelled) setNotes(rows); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [patient._id, scope]);

  const openNoteForm = async (noteType: NoteTypeId) => {
    try {
      const note = await createNote({
        patientId: patient._id,
        patientName: patientFullName(patient),
        mrn: patient.hospitalNumber,
        patientDob: patient.dateOfBirth,
        noteType,
      }, { navigate: false });
      if (note) onOpenNote(note._id, noteTypeLabel(t, noteType));
    } catch (error) {
      showToast(describeError(error, t('clinicalForms.noteNotOpened')), 'error');
    }
  };
  const { triages } = useTriage(patient._id);
  const { visits: ancVisits } = useANC();
  const { screenings } = useNutritionScreenings();
  const { admissions } = useWards();
  const { results: labResults } = useLabResults(patient._id);

  const patientANC = (ancVisits || []).filter(a => a.patientId === patient._id);
  const patientScreenings = (screenings || []).filter(s => s.patientId === patient._id);
  const patientAdmissions = (admissions || []).filter(a => a.patientId === patient._id);
  const patientImaging = (labResults || []).filter(r => isImagingStudy(r));

  // Each row gates on who may write that record — the very rule the chart
  // shell applies before it opens the form (role-form-access), so a row that
  // is enabled always opens. This list only renders for clinical viewers.
  const role = currentUser?.role || '';
  const canTriage = roleFormAllowed('triage-form', role, true);
  const canOpenAnc = roleFormAllowed('anc-visit', role, true);
  const canScreen = roleFormAllowed('nutrition-screening', role, true);
  const canReportImaging = roleFormAllowed('imaging-report', role, true);
  const canAdmit = roleFormAllowed('ward-admission', role, true);

  const forms = useMemo<ClinicalFormItem[]>(() => {
    const lastTriage = triages[0];
    const lastANC = [...patientANC].sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''))[0];
    const lastScreening = [...patientScreenings].sort((a, b) => (b.screeningDate || '').localeCompare(a.screeningDate || ''))[0];
    const lastReport = patientImaging
      .map(r => r.reportedAt || (r.status === 'completed' ? r.completedAt : ''))
      .filter(Boolean)
      .sort()
      .pop();
    const lastAdmission = [...patientAdmissions].sort((a, b) => (b.admissionDate || '').localeCompare(a.admissionDate || ''))[0];

    return [
      {
        id: 'triage',
        name: 'Triage / ETAT Assessment',
        lastCompleted: lastTriage ? formatDate(lastTriage.triagedAt) : 'Never',
        panel: 'triage-form',
        enabled: canTriage,
        disabledReason: 'Requires triage permission',
      },
      {
        id: 'anc',
        name: 'ANC Visit',
        lastCompleted: lastANC ? formatDate(lastANC.visitDate) : 'Never',
        panel: 'anc-visit',
        enabled: canOpenAnc,
        disabledReason: 'Requires antenatal care access',
      },
      {
        id: 'nutrition',
        name: 'Nutrition Screening',
        lastCompleted: lastScreening ? formatDate(lastScreening.screeningDate) : 'Never',
        // Taken in the chart now, not on the nutrition station. This list
        // only renders for clinical viewers, and every one of them may write
        // a screening (the nutrition_screening sync grant).
        panel: 'nutrition-screening',
        enabled: canScreen,
      },
      {
        id: 'imaging-report',
        name: 'Imaging Report',
        lastCompleted: lastReport ? formatDate(lastReport) : 'Never',
        panel: 'imaging-report',
        enabled: canReportImaging,
        disabledReason: 'Requires the radiology module',
      },
      {
        id: 'ward-admission',
        name: 'Ward Admission',
        lastCompleted: lastAdmission ? formatDate(lastAdmission.admissionDate) : 'Never',
        // The panel resolves the open visit, so admitting closes it.
        panel: 'ward-admission',
        enabled: canAdmit,
        disabledReason: 'Requires ward access',
      },
    ];
  }, [triages, patientANC, patientScreenings, patientAdmissions, patientImaging,
      canTriage, canOpenAnc, canScreen, canReportImaging, canAdmit]);

  type Row = { id: string; name: string; lastCompleted: string; enabled: boolean; disabledReason?: string; open: () => void };
  const lastSigned = (type: NoteTypeId) => {
    const signed = notes.filter(n => n.noteType === type)
      .map(n => n.signedAt || n.serviceDate)
      .filter(Boolean)
      .sort()
      .pop();
    return signed ? formatDate(signed) : t('clinicalForms.never');
  };
  const rows: Row[] = [
    ...NOTE_TYPE_ORDER.map(type => ({
      id: `note-${type}`,
      name: noteTypeLabel(t, type),
      lastCompleted: lastSigned(type),
      enabled: canConsult && !creating,
      disabledReason: t('clinicalForms.needsConsult'),
      open: () => void openNoteForm(type),
    })),
    ...forms.map(f => ({
      id: f.id,
      name: f.name,
      lastCompleted: f.lastCompleted,
      enabled: f.enabled,
      disabledReason: f.disabledReason,
      open: () => onOpenForm(f.panel),
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(r => r.name.toLowerCase().includes(query));

  return (
    <div className="tamam-drawer-body omf-forms">
      <label className="omf-forms-search">
        <Search aria-hidden />
        <input
          type="search"
          placeholder={t('clinicalForms.search')}
          aria-label={t('clinicalForms.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </label>
      <table className="omf-forms-table">
        <thead>
          <tr>
            <th scope="col">{t('clinicalForms.formName')}</th>
            <th scope="col">{t('clinicalForms.lastCompleted')}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr><td colSpan={2} className="omf-forms-empty">{t('clinicalForms.noMatch', { query: search })}</td></tr>
          )}
          {filtered.map(row => (
            <tr key={row.id}>
              <td>
                <button
                  type="button"
                  className="omf-forms-link"
                  disabled={!row.enabled}
                  title={row.enabled ? undefined : row.disabledReason}
                  onClick={row.open}
                >
                  {row.name}
                </button>
              </td>
              <td>{row.lastCompleted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
