/**
 * Turn a note's Social History narrative into summary rows.
 *
 * `CareCoordinationModal` offers the clinician a table of Problems and a table
 * of Social History to attach to an outgoing summary. Problems were loaded
 * from `problem-service`; social history was initialised to `[]` in the editor
 * and never filled by anything. Because the modal guards its block with
 * `socialHistory.length > 0`, the section simply never appeared — a referral
 * sent from this platform could not carry social history at all, and nothing
 * on the screen said so.
 *
 * The note already holds the content: `social_history` is a narrative section
 * the clinician typed. What the modal needs is a two-column shape, so this
 * splits it.
 *
 * ## Why label/detail and not the whole line
 *
 * Social history is written as labelled facts — "Tobacco: never smoker",
 * "Alcohol: occasional", "Occupation: cattle herder". The modal's columns are
 * "Comments" and "Description" and the clinician ticks rows individually, so
 * one fact per row is what makes the picker usable. A line with no colon is
 * kept whole in the description rather than being split at some guessed
 * boundary — a free-text sentence is one fact, not two.
 *
 * Nothing here interprets the content. It is the clinician's own words, split
 * on the punctuation they used.
 */

import type { ClinicalNoteDoc } from './types';
import type { SummarySocialHistory } from '@/components/clinical-notes/CareCoordinationModal';

/**
 * Template blocks are written into section text with delimiters. They are
 * structure, not content, and must not become rows.
 */
const TEMPLATE_DELIMITER = /^[[\]{}<>=–—-]+$/;

/** The longest a "Tobacco:" style label can be before it is really a sentence. */
const MAX_LABEL_LENGTH = 40;

export function socialHistoryRows(note: Pick<ClinicalNoteDoc, 'sections'> | null | undefined): SummarySocialHistory[] {
  const text = note?.sections.find(s => s.sectionId === 'social_history')?.text ?? '';
  if (!text.trim()) return [];

  const rows: SummarySocialHistory[] = [];
  for (const raw of text.split('\n')) {
    // Leading bullets and dashes are list formatting, not part of the fact.
    const line = raw.trim().replace(/^[-•*•]\s*/, '').trim();
    if (!line || TEMPLATE_DELIMITER.test(line)) continue;

    const colon = line.indexOf(':');
    // A colon far into the line is punctuation inside a sentence, not a label.
    if (colon > 0 && colon <= MAX_LABEL_LENGTH) {
      const label = line.slice(0, colon).trim();
      const detail = line.slice(colon + 1).trim();
      // "Tobacco:" with nothing after it is a heading the clinician left
      // blank. Carrying it into a referral says nothing and takes a row.
      if (detail) {
        rows.push({ comment: label, description: detail });
        continue;
      }
      continue;
    }
    rows.push({ comment: '', description: line });
  }
  return rows;
}
