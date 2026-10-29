'use client';

/**
 * Visit note workspace panel — Tamam-style quick capture: primary/secondary
 * diagnosis search + a free-text note. Diagnosis search reuses the same
 * CodedSearchField + COMMON_ICD11_CODES pairing as ProblemList's "Add
 * problem" flow.
 *
 * Persists into the visit's clinical-notes draft (`ClinicalNoteDoc`), adding to
 * the one already open for this visit rather than forking a second, not the old
 * `PatientNoteDoc`: the diagnoses land structured on the SOAP Assessment
 * section and the paragraph becomes its narrative, so a note captured here
 * shows up in the chart's Notes tab, can be opened in the full editor, and
 * goes through the same sign/addendum lifecycle as every other note. The old
 * data layer made this panel's output invisible to the Notes list — a note
 * the author could not find again.
 *
 * Laid out as O3's visit note (Diagnosis, Note, Image) over the O3 action bar:
 * Discard | Save and close. (A third "Start consultation" button was taken
 * out 2026-10-29 at the user's request; the full encounter is still reached
 * from the chart header.)
 */

import { useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Plus, X } from '@/components/icons/lucide';
import FormNotices from '@/components/overlay/FormNotices';
import './visit-note-panel.css';
import CodedSearchField from '@/components/CodedSearchField';
import { useToast } from '@/components/Toast';
import { toIsoDate } from '@/lib/date-utils';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import type { PatientDoc } from '@/lib/db-types';
import type { ChartPanelUser } from './types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';

interface PickedDx { code: string; title: string; chapter: string }

interface VisitNotePanelProps {
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  canConsult: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export default function VisitNotePanel({ patient, currentUser, canConsult, onClose, onSaved }: VisitNotePanelProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const scope = useDataScope();
  const icdOptions = useMemo(() => COMMON_ICD11_CODES.map(c => ({ code: c.code, name: c.title, meta: c.chapter, keywords: c.keywords })), []);

  const [primarySearch, setPrimarySearch] = useState('');
  const [primaryDx, setPrimaryDx] = useState<PickedDx | null>(null);
  const [secondarySearch, setSecondarySearch] = useState('');
  const [secondaryDx, setSecondaryDx] = useState<PickedDx | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Images picked for this note — persisted to the patient_documents store on
  // save (same flow the radiology queue uses), so they survive the session and
  // show on the chart's documents/attachments views.
  const [images, setImages] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — PouchDB doc budget

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1)); // strip data: prefix
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleImagesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file
    const oversized = files.filter(f => f.size > MAX_IMAGE_BYTES);
    if (oversized.length > 0) {
      showToast(t('msg.fileSNotAttachedFiles', { count: oversized.length }), 'error');
    }
    setImages(prev => [...prev, ...files.filter(f => f.size <= MAX_IMAGE_BYTES)]);
  };

  if (!canConsult) {
    return (
      <div className="tamam-drawer-body">
        <div className="tamam-panel-permission-note">
          <p>You don&apos;t have permission to add visit notes for this patient.</p>
        </div>
      </div>
    );
  }

  const canSave = !!primaryDx || note.trim().length > 0;

  /** Writes the drafted diagnoses/note/images. Returns how many images failed
   *  to attach; throws if the note itself could not be saved. */
  const persistNote = async (): Promise<number> => {
    {
      const now = new Date();
      // Structured, not prose: the dx cards land on the Assessment section the
      // same way the full editor writes them, so reopening this note there
      // shows editable diagnosis cards rather than a paragraph to re-type.
      const diagnoses = [primaryDx, secondaryDx]
        .filter((dx): dx is PickedDx => !!dx)
        .map((dx, i) => ({
          id: `dx-${now.getTime()}-${i}`,
          name: dx.title,
          icd11Code: dx.code,
          addedAt: now.toISOString(),
        }));
      const lines: string[] = [];
      if (note.trim()) lines.push(note.trim());
      if (images.length > 0) lines.push(`Attached images: ${images.map(f => f.name).join(', ')}`);
      const { createClinicalNote, listClinicalNotes, saveNoteSection, updateClinicalNote } =
        await import('@/lib/clinical-notes/note-service');
      const { findReusableDraft } = await import('@/lib/clinical-notes/useCreateNote');
      const { patientFullName } = await import('@/lib/patient-utils');
      const text = lines.join('\n\n');
      const serviceDate = toIsoDate(now);
      const authorId = currentUser?._id || currentUser?.username;

      // Tie the note to the open visit, and add to that visit's draft rather
      // than starting a second "Consultation" beside it.
      let encounterId: string | undefined;
      try {
        const { findOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
        encounterId = (await findOpenEncounterForPatient(patient._id, currentUser?.hospitalId || ''))?._id;
      } catch { /* unlinked note — still worth saving */ }
      // No scope yet means no reuse: never read notes unscoped.
      const existing = scope ? await listClinicalNotes({ patientId: patient._id }, scope) : [];
      const draft = findReusableDraft(existing, { encounterId, noteType: 'soap', serviceDate, authorId });

      if (draft) {
        const prior = draft.sections.find(s => s.sectionId === 'assessment');
        await saveNoteSection(draft._id, 'assessment', {
          text: [prior?.text?.trim(), text].filter(Boolean).join('\n\n'),
          diagnoses: [...(prior?.diagnoses || []), ...diagnoses],
        });
        if (!draft.encounterId && encounterId) await updateClinicalNote(draft._id, { encounterId });
      } else {
        await createClinicalNote({
          patientId: patient._id,
          patientName: patientFullName(patient),
          mrn: patient.hospitalNumber,
          patientDob: patient.dateOfBirth,
          noteType: 'soap',
          serviceDate,
          serviceTime: now.toTimeString().slice(0, 5),
          encounterId,
          sections: [{ sectionId: 'assessment', text, diagnoses }],
          assignedToId: currentUser?._id,
          assignedToName: currentUser?.name,
          authorId,
          authorName: currentUser?.name || 'Care team',
          hospitalId: currentUser?.hospitalId,
          hospitalName: currentUser?.hospitalName,
          orgId: currentUser?.orgId,
        });
      }
      // Persist picked images to the synced patient_documents store (the same
      // place radiology films land) so they outlive this session.
      let imageFailures = 0;
      if (images.length > 0) {
        const { addPatientDocument } = await import('@/lib/services/patient-document-service');
        for (const file of images) {
          try {
            const base64Data = await fileToBase64(file);
            await addPatientDocument({
              patientId: patient._id,
              title: `Visit note image — ${file.name}`,
              category: 'scanned_record',
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              base64Data,
              sizeBytes: file.size,
              note: 'Attached from a visit note',
              uploadedById: currentUser?._id,
              uploadedByName: currentUser?.name,
              hospitalId: currentUser?.hospitalId,
              orgId: currentUser?.orgId,
            });
          } catch {
            imageFailures++;
          }
        }
      }
      return imageFailures;
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    try {
      setSubmitting(true);
      const imageFailures = await persistNote();
      showToast(imageFailures > 0 ? t('msg.visitNoteSavedImageS', { imageFailures }) : t('msg.visitNoteSaved'), imageFailures > 0 ? 'error' : 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('noteEditor.saveFailed')), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="tamam-drawer-body vn-body">
        {/* No "For <patient>" line: this drawer only ever opens over the chart
            of the patient it writes to, and the banner behind it already names
            them. Laid out as O3's visit note: Diagnosis, Note, Image. */}
        <section className="vn-section">
          <h3 className="vn-heading" id="vn-dx-heading">Diagnosis</h3>
          {/* One search, as O3 has it: the first diagnosis picked is the
              primary, the second the secondary. */}
          {!secondaryDx && (
            <CodedSearchField
              label=""
              placeholder="Search for a diagnosis"
              options={icdOptions}
              value={primaryDx ? secondarySearch : primarySearch}
              onChange={primaryDx ? setSecondarySearch : setPrimarySearch}
              onSelect={c => {
                const picked = { code: c.code, title: c.name, chapter: c.meta || '' };
                if (primaryDx) { setSecondaryDx(picked); setSecondarySearch(''); } else { setPrimaryDx(picked); setPrimarySearch(''); }
              }}
              excludeCodes={primaryDx ? [primaryDx.code] : undefined}
            />
          )}
          {(primaryDx || secondaryDx) && (
            <ul className="vn-tags" aria-labelledby="vn-dx-heading">
              {[primaryDx, secondaryDx].map((dx, i) => dx && (
                <li key={dx.code} className="vn-tag">
                  <span className="vn-tag-rank">{i === 0 ? 'Primary' : 'Secondary'}</span>
                  <span className="vn-tag-name">{dx.title} <span>· {dx.code}</span></span>
                  <button
                    type="button"
                    aria-label={`Remove ${dx.title}`}
                    onClick={() => {
                      // Removing the primary promotes the secondary.
                      if (i === 0) { setPrimaryDx(secondaryDx); setSecondaryDx(null); } else setSecondaryDx(null);
                    }}
                  >
                    <X aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="vn-section">
          <label htmlFor="vn-note" className="vn-heading">Note</label>
          <p className="vn-help">Write your notes</p>
          <textarea
            id="vn-note"
            className="vn-textarea"
            placeholder="Write any notes here"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </section>

        <section className="vn-section">
          <h3 className="vn-heading">Image</h3>
          <p className="vn-help">Upload an image or use this device&apos;s camera to capture an image</p>
          {images.length > 0 && (
            <ul className="vn-files">
              {images.map((file, i) => (
                <li key={`${file.name}-${i}`} className="vn-file">
                  <ImageIcon aria-hidden />
                  <span>{file.name} <span className="vn-file-size">· {(file.size / 1024).toFixed(0)} KB</span></span>
                  <button type="button" onClick={() => setImages(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove ${file.name}`}>
                    <X aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleImagesChosen}
          />
          <button type="button" className="vn-add-image" onClick={() => fileInputRef.current?.click()}>
            Add image <Plus aria-hidden />
          </button>
        </section>
      </div>
      <FormNotices />
      <div className="tm-action-bar">
        <button type="button" className="tm-action-bar__btn tm-action-bar__btn--secondary" onClick={onClose} disabled={submitting}>Discard</button>
        <button type="button" className="tm-action-bar__btn tm-action-bar__btn--primary" onClick={handleSave} disabled={!canSave || submitting}>
          {submitting ? 'Saving…' : 'Save and close'}
        </button>
      </div>
    </>
  );
}
