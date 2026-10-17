'use client';

/**
 * One section of a clinical note: its heading, its action row, and its body.
 *
 * Narrative sections get a textarea plus Text Shortcut. Derived sections
 * (vitals, medications, allergies, and the three history sections) render a
 * snapshot of the chart as it stood when the note was written, with a refresh
 * control — a note records what the clinician saw, so it must not silently
 * change when the chart later does. The history sections additionally take
 * free text under the snapshot, for what belongs to this visit alone.
 *
 * Every section additionally offers the actions that belong to it (see
 * section-actions.ts): Assessment cites problems, Plan raises orders,
 * Medications reaches the medication list. The section reports which action was
 * pressed; the editor owns what happens next.
 */

import {
  Pill, FlaskConical, Syringe, Heart, RefreshCw, X,
  ClipboardList, Plus, AlertTriangle, Activity, Send, Calendar, Archive,
} from '@/components/icons/lucide';
import ShortcutSearchInput from './shortcuts/ShortcutSearchInput';
import { useShortcutSearch } from './shortcuts/useShortcutSearch';
import AssessmentSection from './assessment/AssessmentSection';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { sectionLabel } from '@/lib/clinical-notes/note-labels';
import { getSectionDef, type NoteSectionId } from '@/lib/clinical-notes/note-catalog';
import { actionsForSection, type NoteSectionActionId } from '@/lib/clinical-notes/section-actions';
import { stripTemplateMarkers } from '@/lib/clinical-notes/section-templates';
import { applyShortcut } from '@/lib/clinical-notes/text-shortcut-service';
import type { NoteSectionContent } from '@/lib/clinical-notes/types';

/** Icons live here, not in the catalog — the catalog stays React-free. */
const ACTION_ICONS: Record<NoteSectionActionId, typeof Pill> = {
  include_problems: ClipboardList,
  review_medications: Pill,
  prescribe: Plus,
  manage_allergies: AlertTriangle,
  update_history: Archive,
  record_vitals: Activity,
  order_lab: FlaskConical,
  order_vaccine: Syringe,
  patient_education: Heart,
  refer: Send,
  schedule_followup: Calendar,
};

interface NoteSectionCardProps {
  sectionId: NoteSectionId;
  content: NoteSectionContent | undefined;
  readOnly: boolean;
  userId: string;
  orgId?: string;
  active: boolean;
  onFocus: () => void;
  onChange: (patch: Partial<NoteSectionContent>) => void;
  /** Re-read the chart for a derived section. */
  onRefreshDerived?: (sectionId: NoteSectionId) => void;
  /** Open the full working view behind a derived section (Medications popup). */
  onOpenDerived?: (sectionId: NoteSectionId) => void;
  /** Run one of the section's actions. Omitted while the note is locked. */
  onAction?: (actionId: NoteSectionActionId) => void;
  /** Remove an optional section the clinician added. */
  onRemove?: () => void;
  removable?: boolean;
  /** Signed-in role, so an action that navigates is only offered when its
   *  destination is reachable — see `actionsForSection`. */
  role?: string;
  /**
   * Where a derived section's chart read stands. Only passed while the note is
   * a draft. 'loading' and 'error' replace the "none recorded" wording: an
   * empty box before the read has finished (or after it failed) must never
   * look like a confirmed empty chart — e.g. a patient with a severe allergy.
   * 'ready' means the read finished and the empty text is a real finding.
   */
  chartStatus?: 'loading' | 'error' | 'ready';
}

export default function NoteSectionCard({
  sectionId, content, readOnly, userId, orgId, active,
  onFocus, onChange, onRefreshDerived, onOpenDerived, onAction, onRemove, removable, role, chartStatus,
}: NoteSectionCardProps) {
  const { t } = useTranslation();
  const def = getSectionDef(sectionId);
  const label = sectionLabel(t, sectionId);
  const text = content?.text ?? '';

  // Hooks run before the early return: a section id the catalog no longer
  // knows must not change how many hooks this component calls.
  const shortcuts = useShortcutSearch({
    userId,
    orgId,
    sectionId,
    onPick: s => onChange({ text: applyShortcut(text, s.body) }),
  });

  if (!def) return null;

  const actions = actionsForSection(sectionId, role);

  const actionButtons = !readOnly && onAction && actions.length > 0
    ? actions.map((action, index) => {
        const Icon = ACTION_ICONS[action.id];
        return (
          <button
            key={action.id}
            type="button"
            // The section's lead action carries the tinted emphasis, per the
            // design — Review meds, Include problems, Prescribe, ….
            className={`cn-tool${index === 0 ? ' cn-tool-primary' : ''}`}
            onClick={() => onAction(action.id)}
            title={action.description}
          >
            <Icon size={13} /> {action.label}
          </button>
        );
      })
    : null;

  // Derived sections render the snapshot rather than an editable body. The
  // snapshot is line-per-entry text; each line becomes a row on a soft
  // hairline so the list reads like the design's medication/allergy rows.
  const snapshotRows = content?.snapshot
    ? content.snapshot.split('\n').filter(line => line.trim()).map((line, i) => (
        <div key={i} className="cn-derived-row">{line}</div>
      ))
    : null;

  if (def.kind === 'derived') {
    const narrative = stripTemplateMarkers(text).trim();
    // What to say when the chart had nothing for this section. A locked note
    // says only that nothing was documented: it may predate the section
    // reading the chart at all, and "no family history recorded" would then be
    // a finding nobody made. And where the clinician's own text is the whole
    // content, the snapshot block steps aside rather than contradict it.
    const loadingChart = chartStatus === 'loading' && !content?.snapshot;
    const emptyCopy = loadingChart
      ? t('noteEditor.loadingChart')
      : readOnly && def.narrative
        ? t('noteEditor.notDocumented')
        : t('noteEditor.noneRecorded', { section: label.toLowerCase() });
    const refreshing = chartStatus === 'loading' && Boolean(content?.snapshot);
    const chartError = chartStatus === 'error' ? (
      <div
        className="cn-derived cn-derived-error"
        role="alert"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: 'var(--color-danger-text, var(--color-danger))' }}
      >
        <span>{t('noteEditor.chartLoadFailed', { section: label.toLowerCase() })}</span>
        {onRefreshDerived && (
          <button type="button" className="cn-tool" onClick={() => onRefreshDerived(sectionId)}>
            <RefreshCw size={13} /> {t('noteEditor.retry')}
          </button>
        )}
      </div>
    ) : null;
    // A failed read shows its error instead of an empty-looking box; a stored
    // snapshot stays visible under the error.
    const showSnapshotBlock = (Boolean(snapshotRows) || !(def.narrative && (narrative || !readOnly)))
      && !(chartStatus === 'error' && !snapshotRows);
    const snapshotBlock = !showSnapshotBlock ? null : onOpenDerived ? (
      // The whole snapshot is the door into the working view — clicking a
      // medication line opens the Medications popup, not a text cursor.
      <div
        className={`cn-derived cn-derived-clickable${content?.snapshot ? '' : ' cn-derived-empty'}`}
        role="button"
        tabIndex={0}
        title={t('noteEditor.openSection', { section: label.toLowerCase() })}
        onClick={() => onOpenDerived(sectionId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDerived(sectionId); }
        }}
      >
        {snapshotRows || emptyCopy}
      </div>
    ) : (
      <div className={`cn-derived${content?.snapshot ? '' : ' cn-derived-empty'}`} aria-busy={loadingChart || undefined}>
        {snapshotRows || emptyCopy}
      </div>
    );

    return (
      // onFocus notes which section the caret is in — it reports focus rather
      // than accepting activation, so there is nothing here to key-activate.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <section
        className={`cn-section${active ? ' is-active' : ''}`}
        id={`cn-section-${sectionId}`}
        onFocus={onFocus}
      >
        <div className="cn-section-head">
          <h3 className="cn-section-name">{label}</h3>
          {!readOnly && (
            <div className="cn-section-tools">
              {actionButtons}
              {def.narrative && <ShortcutSearchInput search={shortcuts} />}
              {onRefreshDerived && (
                <button
                  type="button"
                  className="cn-tool"
                  onClick={() => onRefreshDerived(sectionId)}
                  disabled={chartStatus === 'loading'}
                  title={t('noteEditor.refreshTitle', { section: label.toLowerCase() })}
                >
                  <RefreshCw size={13} /> {refreshing ? t('noteEditor.refreshing') : t('noteEditor.refresh')}
                </button>
              )}
            </div>
          )}
        </div>
        {chartError}
        {snapshotBlock}
        {def.narrative && (readOnly ? (
          narrative ? <div className="cn-derived cn-derived-narrative">{narrative}</div> : null
        ) : (
          <textarea
            className="cn-textarea cn-textarea--under-snapshot"
            value={text}
            // No snapshot can mean the chart is empty or that it has not been
            // read (offline, a failed load) — so this says what to do, not what
            // the patient's history is.
            placeholder={content?.snapshot ? def.placeholder : t('noteEditor.historyPlaceholder')}
            onChange={e => onChange({ text: e.target.value })}
            aria-label={t('noteEditor.visitNotes', { section: label })}
          />
        ))}
      </section>
    );
  }

  return (
    <section
      className={`cn-section${active ? ' is-active' : ''}`}
      id={`cn-section-${sectionId}`}
    >
      <div className="cn-section-head">
        <h3 className="cn-section-name">{label}</h3>

        {!readOnly && (
          <div className="cn-section-tools">
            {actionButtons}

            <ShortcutSearchInput search={shortcuts} />

            {removable && onRemove && (
              <button
                type="button"
                className="cn-tool"
                onClick={onRemove}
                title={t('noteEditor.removeSection', { section: label })}
                aria-label={t('noteEditor.removeSection', { section: label })}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Assessment leads with the problems included from the popup, rendered
          as diagnosis lines. The textarea below stays the narrative. */}
      {sectionId === 'assessment' && (
        <AssessmentSection
          diagnoses={content?.diagnoses || []}
          readOnly={readOnly}
          onChangeDiagnoses={diagnoses => onChange({ diagnoses })}
        />
      )}

      {readOnly ? (
        <div className="cn-derived">
          {stripTemplateMarkers(text).trim() || (
            <span className="cn-derived-empty">{t('noteEditor.notDocumented')}</span>
          )}
        </div>
      ) : (
        <textarea
          className="cn-textarea"
          value={text}
          placeholder={def.placeholder}
          onFocus={onFocus}
          onChange={e => onChange({ text: e.target.value })}
          aria-label={label}
        />
      )}
    </section>
  );
}
