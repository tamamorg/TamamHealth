import { Minus } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatPhoneDisplay } from '@/lib/field-formats';
import { isNoteLocked } from '@/lib/clinical-notes/note-service';
import { noteTypeLabel, sectionLabel } from '@/lib/clinical-notes/note-labels';
import { stripTemplateMarkers } from '@/lib/clinical-notes/section-templates';
import type { NoteSectionId } from '@/lib/clinical-notes/note-catalog';
import type { PatientDoc, PatientDocumentDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { dobWithAge, nameInitials, docCategoryLabel } from '../helpers';

/**
 * The standalone layout's left rail: patient identity, the patient's other
 * notes, this note's sections (jump + remove), recent labs and documents.
 */
export function NoteSidePanels({
  note, typeDef, patient, siblingNotes, recentLabs, documents, docLabel, onDocLabelChange,
  sectionIds, activeSection, setActiveSection, locked, hasOptionalSections,
  navigateAway, onAddOptional, onRemoveSection,
}: {
  note: ClinicalNoteDoc;
  typeDef: { sections: readonly NoteSectionId[] };
  patient: PatientDoc | null;
  siblingNotes: ClinicalNoteDoc[];
  recentLabs: Array<{ id: string; testName: string; date: string }> | null;
  documents: PatientDocumentDoc[] | null;
  docLabel: string;
  onDocLabelChange: (label: string) => void;
  sectionIds: NoteSectionId[];
  activeSection: NoteSectionId | null;
  setActiveSection: (id: NoteSectionId) => void;
  locked: boolean;
  /** optionalAvailable.length > 0 */
  hasOptionalSections: boolean;
  navigateAway: (href: string) => void;
  onAddOptional: () => void;
  onRemoveSection: (id: NoteSectionId) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <aside className="cn-sidebar">
          {/* Patient identity — a bare block above the cards, per the design:
              photo plate, name, one id line, then the risk/status pills. */}
          <div className="cn-ident">
            {patient?.photoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className="cn-patient-photo" src={patient.photoUrl} alt="" />
              : <span className="cn-patient-photo" aria-hidden>{nameInitials(note.patientName)}</span>}
            <div style={{ minWidth: 0 }}>
              {/* The name is the way into the chart. It goes through
                  navigateAway, not a plain link, so an unsaved section still
                  gets its "you have unsaved changes" confirm first. */}
              <h2 className="cn-ident-name">
                <button
                  type="button"
                  className="cn-ident-name-link"
                  onClick={() => navigateAway(`/patients/${note.patientId}`)}
                  title={t('noteEditor.openChart', { name: note.patientName })}
                >
                  {note.patientName}
                </button>
              </h2>
              <p className="cn-ident-line">
                {[note.mrn, patient?.gender?.[0]?.toUpperCase(), dobWithAge(note.patientDob), patient?.phone ? formatPhoneDisplay(patient.phone) : null]
                  .filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          {/* The patient's other notes, newest first */}
          <div className="cn-sidebar-card">
            <p className="cn-card-head">{t('noteEditor.patientNotes')}</p>
            <div className="cn-card-body cn-card-body-roomy cn-card-body--flush">
              {siblingNotes.length === 0 && (
                <p className="cn-card-empty">{t('noteEditor.noOtherNotes')}</p>
              )}
              {siblingNotes.map(n => (
                <button
                  key={n._id}
                  type="button"
                  className="cn-note-row"
                  title={`${noteTypeLabel(t, n.noteType)} — ${n.serviceDate}`}
                  onClick={() => navigateAway(`/notes/${n._id}`)}
                >
                  <span className="cn-note-row-top">
                    <b>{noteTypeLabel(t, n.noteType)}</b>
                    <small>{new Date(`${n.serviceDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</small>
                  </span>
                  <span className="cn-note-row-meta">
                    {(n.assignedToName || n.authorName || t('noteEditor.unassigned'))}{isNoteLocked(n) ? ` · ${t('noteEditor.statusSigned')}` : n.status === 'awaiting_cosign' ? ` · ${t('noteEditor.statusAwaitingCosign')}` : ` · ${t('noteEditor.statusDraft')}`}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Note sections (jump + remove) */}
          <div className="cn-sidebar-card">
            <p className="cn-card-head">
              {t('noteEditor.noteSections')}
              {!locked && hasOptionalSections && (
                <button type="button" className="cn-card-head-action" onClick={onAddOptional}>
                  {t('noteEditor.addOptional')}
                </button>
              )}
            </p>
            <div className="cn-card-body cn-card-body--flush">
              <nav className="cn-section-nav">
                {sectionIds.map((id) => {
                  const content = note.sections.find(s => s.sectionId === id);
                  const filled = !!(stripTemplateMarkers(content?.text || '').trim() || content?.snapshot);
                  const removable = !locked && !typeDef.sections.includes(id);
                  return (
                    <div key={id} className="cn-section-nav-row">
                      <button
                        type="button"
                        className="cn-section-nav-item"
                        aria-current={activeSection === id}
                        onClick={() => {
                          setActiveSection(id);
                          document.getElementById(`cn-section-${id}`)?.scrollIntoView({
                            behavior: 'smooth', block: 'start',
                          });
                        }}
                      >
                        <span className="tamam-reg-navarrow" aria-hidden>↳</span>
                        <span className="cn-section-nav-label">{sectionLabel(t, id)}</span>
                        {filled && <span className="cn-section-nav-badge">•</span>}
                      </button>
                      {removable && (
                        <button
                          type="button"
                          className="cn-section-nav-remove"
                          aria-label={t('noteEditor.removeSection', { section: sectionLabel(t, id) })}
                          title={t('noteEditor.removeSection', { section: sectionLabel(t, id) })}
                          onClick={() => onRemoveSection(id)}
                        >
                          <Minus size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Most recent resulted labs */}
          <div className="cn-sidebar-card">
            <p className="cn-card-head">{t('noteEditor.labsStudies')}</p>
            <div className="cn-card-body cn-card-body-roomy cn-card-body--flush">
              {recentLabs !== null && recentLabs.length === 0 && (
                <p className="cn-card-empty">{t('noteEditor.noPreviousLabs')}</p>
              )}
              {(recentLabs || []).map(lab => (
                <button
                  key={lab.id}
                  type="button"
                  className="cn-rail-row"
                  onClick={() => navigateAway(`/patients/${note.patientId}?tab=labs&focus=${encodeURIComponent(lab.id)}`)}
                >
                  <span className="cn-rail-row-main">{lab.testName}</span>
                  <span className="cn-rail-row-meta">{lab.date}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Uploaded documents, filterable by label */}
          <div className="cn-sidebar-card">
            <p className="cn-card-head">
              {t('noteEditor.documents')}
              <label className="cn-card-head-filter">
                {t('noteEditor.filterByLabel')}
                <Select
                  value={docLabel}
                  onChange={e => onDocLabelChange(e.target.value)}
                  aria-label={t('noteEditor.filterDocuments')}
                >
                  <option value="all">{t('noteEditor.all')}</option>
                  {[...new Set((documents || []).map(d => d.category))].map(cat => (
                    <option key={cat} value={cat}>{docCategoryLabel(cat)}</option>
                  ))}
                </Select>
              </label>
            </p>
            <div className="cn-card-body cn-card-body-roomy cn-card-body--flush">
              {documents !== null && documents.length === 0 && (
                <p className="cn-card-empty">{t('noteEditor.noDocuments')}</p>
              )}
              {(documents || [])
                .filter(doc => docLabel === 'all' || doc.category === docLabel)
                .slice(0, 8)
                .map(doc => (
                  <button
                    key={doc._id}
                    type="button"
                    className="cn-rail-row cn-rail-row-stacked"
                    title={doc.title}
                    onClick={() => navigateAway(`/patients/${note.patientId}?tab=documents&focus=${encodeURIComponent(doc._id)}`)}
                  >
                    <span className="cn-rail-row-main">
                      {doc.createdAt ? `${new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })} - ` : ''}{doc.title || doc.fileName}
                    </span>
                    <span className="cn-rail-row-sub">{docCategoryLabel(doc.category)}</span>
                  </button>
                ))}
            </div>
          </div>
    </aside>
  );
}
