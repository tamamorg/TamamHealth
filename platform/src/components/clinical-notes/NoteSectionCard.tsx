'use client';

/**
 * One section of a clinical note: its heading, its action row, and its body.
 *
 * Narrative sections get a textarea plus Text Shortcut. Derived sections
 * (vitals, medications, allergies) render a snapshot of the chart as it stood
 * when the note was written, with a refresh control — a note records what the
 * clinician saw, so it must not silently change when the chart later does.
 *
 * Every section additionally offers the actions that belong to it (see
 * section-actions.ts): Assessment cites problems, Plan raises orders,
 * Medications reaches the medication list. The section reports which action was
 * pressed; the editor owns what happens next.
 */

import {
  Pill, FlaskConical, Syringe, Heart, RefreshCw, X,
  ClipboardList, Plus, AlertTriangle, Activity, Send, Calendar,
} from '@/components/icons/lucide';
import ShortcutSearchInput from './shortcuts/ShortcutSearchInput';
import ShortcutResults from './shortcuts/ShortcutResults';
import { useShortcutSearch } from './shortcuts/useShortcutSearch';
import AssessmentSection from './assessment/AssessmentSection';
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
}

export default function NoteSectionCard({
  sectionId, content, readOnly, userId, orgId, active,
  onFocus, onChange, onRefreshDerived, onOpenDerived, onAction, onRemove, removable, role,
}: NoteSectionCardProps) {
  const def = getSectionDef(sectionId);
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
    return (
      <section
        className={`cn-section${active ? ' is-active' : ''}`}
        id={`cn-section-${sectionId}`}
        onFocus={onFocus}
      >
        <div className="cn-section-head">
          <h3 className="cn-section-name">{def.label}</h3>
          {!readOnly && (
            <div className="cn-section-tools">
              {actionButtons}
              {onRefreshDerived && (
                <button
                  type="button"
                  className="cn-tool"
                  onClick={() => onRefreshDerived(sectionId)}
                  title={`Re-read ${def.label.toLowerCase()} from the chart`}
                >
                  <RefreshCw size={13} /> Refresh
                </button>
              )}
            </div>
          )}
        </div>
        {onOpenDerived ? (
          // The whole snapshot is the door into the working view — clicking a
          // medication line opens the Medications popup, not a text cursor.
          <div
            className={`cn-derived cn-derived-clickable${content?.snapshot ? '' : ' cn-derived-empty'}`}
            role="button"
            tabIndex={0}
            title={`Open ${def.label.toLowerCase()}`}
            onClick={() => onOpenDerived(sectionId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDerived(sectionId); }
            }}
          >
            {snapshotRows || `No ${def.label.toLowerCase()} recorded for this patient.`}
          </div>
        ) : (
          <div className={`cn-derived${content?.snapshot ? '' : ' cn-derived-empty'}`}>
            {snapshotRows || `No ${def.label.toLowerCase()} recorded for this patient.`}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className={`cn-section${active ? ' is-active' : ''}`}
      id={`cn-section-${sectionId}`}
    >
      <div className="cn-section-head">
        <h3 className="cn-section-name">{def.label}</h3>

        {!readOnly && (
          <div className="cn-section-tools">
            {actionButtons}

            <ShortcutSearchInput search={shortcuts} />

            {removable && onRemove && (
              <button
                type="button"
                className="cn-tool"
                onClick={onRemove}
                title={`Remove the ${def.label} section`}
                aria-label={`Remove the ${def.label} section`}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* In flow, between the heading and the body — the list never covers the
          note underneath it. */}
      {!readOnly && <ShortcutResults search={shortcuts} />}

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
            <span className="cn-derived-empty">Not documented.</span>
          )}
        </div>
      ) : (
        <textarea
          className="cn-textarea"
          value={text}
          placeholder={def.placeholder}
          onFocus={onFocus}
          onChange={e => onChange({ text: e.target.value })}
          aria-label={def.label}
        />
      )}
    </section>
  );
}
