import type { ReactNode } from "react";

/**
 * Renders `**…**` in body copy as bold.
 *
 * The marker lives in the sentence, in site-data.ts, rather than as markup at
 * the render site — so whoever edits the copy can see and move the emphasis
 * without touching a component, and one string can be reused on several pages
 * without each of them re-deciding what to stress.
 *
 * Every place that prints a marked string MUST render it through this, or the
 * asterisks show up literally. Today that is: the home hero body, the eight
 * fixes on /platform, and the same fixes on /challenges/[slug].
 */
export function emphasise(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} style={{ fontWeight: 700, color: "var(--color-text)" }}>{part.slice(2, -2)}</strong>
      : part,
  );
}
