# Overlay and navigation system

_Reference pass against the Tebra clinical-note screens (Medications, Create
Order, Include Problems, Prescribe Medications), September 2026._

This document records what the reference does differently, what was changed in
Tamam in response, and why. The code is the source of truth; this is the
rationale.

## 1. Audit — reference vs. Tamam before this pass

| Area | Reference (Tebra) | Tamam before | Gap |
| --- | --- | --- | --- |
| Dialog width | Clinical workspaces run 1000–1700px, two panes (list + context) | Mode was 440–480px; 31 callers on the 600 default; only the three clinical-note dialogs were wide | Most forms were narrower than their content |
| Dialog head | Plain black title on white, close at the trailing edge | A structural `:has()` rule painted a solid brand band on any `div:first-child` it recognised; 58 hand-rolled heads, opt-out by class | Heavy, inconsistent, and a fragile selector |
| Dialog foot | Actions in a bar, primary at the trailing edge, secondary as outlined | Every dialog rolled its own row at its own padding and order | No shared shape |
| Sections | Collapsible titled cards inside long forms (Drug Info / Pharmacy Info / Patient Cost) | None | Long forms were flat |
| Context pane | Side panel with tabs (Warnings / Uses), consent card | Only `cn-meds` had a right pane | Not reusable |
| Segmented choice | Filled segment with a check (Labs / Imaging, Yes / No) | `cn-segmented` pill, `FilterTabs` with inline colour and a dead shadow | No check, no keyboard model |
| Info banner | Blue band with an uppercase action and dismiss | None shared; `ConnectivityNotice` is a toast-like slide | No inline banner primitive |
| Menus | — | Four implementations: rail (full keyboard), visit More (partial), row actions (mouse only), account (mouse only) | Inconsistent behaviour and styling |
| Tooltips | — | `title` attributes: OS-styled, hover only, never on focus or touch | Icon-only rail was unlabeled for keyboard users |
| Elevation | Menus and dialogs cast shadows | `*, *::before, *::after { box-shadow: none !important }` discarded every declared shadow, including the toast's coloured edge | Every floating surface read as a flat rectangle |
| Motion | Menus and dialogs settle in | `* { animation: none !important }` (spinners excepted) | Popups popped |
| Tokens | — | Colour, type and radius tokenised; no spacing, z-index, motion, elevation or dialog-size tokens; ten hard-coded z-indexes and eight hard-coded shadow rgba()s | Overlays could not move together |
| Confirmations | — | `useConfirm` existed; nine `window.confirm` call sites remained | Browser alert in a clinic |
| Empty / loading | Inline "You have no previous labs" | `EmptyState` with a hard-coded gradient; `.skeleton` whose shimmer was killed | Not token-driven; skeleton static |

## 2. Prioritised improvements (what shipped, in order of impact)

1. **Token layer** — spacing, radius ladder, elevation, z-index ladder, motion
   durations and curves, dialog sizes and gutters, control heights, interaction
   states, overlay surfaces. Light and dark. `globals.css` under "OVERLAY &
   INTERACTION SYSTEM".
2. **Elevation restored for floating surfaces** — the flat baseline now exempts
   `.tm-elevated`. Cards stay flat; dialogs, menus, popovers, tooltips and
   toasts read the `--shadow-*` tokens.
3. **Functional motion** — the animation kill exempts `.tm-motion`. Dialogs,
   drawers, menus, tooltips, toasts and skeletons animate on the tokens;
   `prefers-reduced-motion` zeroes the tokens, so nothing needs its own media
   query.
4. **Dialog kit** (`components/overlay/Dialog.tsx`) — `DialogFrame`,
   `DialogHeader`, `DialogBody`, `DialogFooter`, `DialogSection`,
   `DialogSplit/Main/Aside`. `Modal` gained `size` presets and `describedBy`.
5. **One menu** (`components/overlay/Menu.tsx`) with the full keyboard model
   and a `useMenuKeyboard` hook. `RowActionsMenu` is now built on it; the rail's
   module directory and account menu use the hook.
6. **Tooltip** (`components/overlay/Tooltip.tsx`) on every icon-only rail
   control, replacing `title`.
7. **Confirm dialog** on the kit, with `warning` tone and `typeToConfirm`;
   eight `window.confirm` sites migrated (front-desk close-out, settings reset,
   handoff reversal, three triage exits, problem-list removal, onboarding skip).
8. **Toast** — `info` and `warning` tones, optional title, leave animation,
   `role="alert"` only for error/warning, a coloured edge that actually renders.
9. **Segmented control, inline banner, form field, skeleton, empty state** —
   small primitives, all token-driven, all keyboard-complete.
10. **Reference dialogs restyled** — Medications, Prescribe, Include Problems,
    Allergies take the plain head, kit gutters, a footer bar and the segmented
    control's new voice.
11. **Navigation polish** — account menu identity block (name / role /
    facility), Escape everywhere, pressed states on rail buttons, a larger Back
    target with a hover well, one elevation and radius across the rail's panels.

Not done, and worth doing next: migrating the remaining hand-rolled dialog
heads to `DialogHeader` (the structural band rule can be deleted once the last
one moves); `ClinicalNoteEditor`'s clear-note `window.confirm` (file was under
concurrent edit); replacing the ~10 remaining `title` tooltips outside the
rail; a `useUnsavedChanges` that asks through `useConfirm` instead of
`window.confirm` (its test pins the browser dialog).

## 3. Design decisions

**Plain head by default, band by choice.** The reference EHRs and every modern
clinical system put a quiet title over a hairline. The solid band was
Tamam's answer to "which surface is live?" — but the scrim already answers
that. Keeping the band as `tone="brand"` for the provisioning family preserves
their identity without painting every popup.

**Widths are named, not numbered.** Two dialogs holding the same kind of
content should be the same width. `sm` asks a question (440), `md` edits a
record (560), `lg` a form with a list (720), `xl` a two-pane editor (960),
`2xl` a clinical workspace (1180). The `width` number stays for callers that
have a measured reason.

**Shadows for what floats, and nothing else.** The flat clinical look was
right for the page; it was wrong for the things above the page. `tm-elevated`
is an earned class — a component gets it by owning a floating surface.

**Motion only where it carries information.** A dialog settling in says "this
arrived"; a toast fading out says "this is over". Cards, rows and page loads
still do not move. The exemption is a class, the durations are tokens, and the
reduced-motion query zeroes the tokens — so the user's setting always wins.

**One keyboard model.** Every menu opens on click, moves with the arrows,
wraps, skips disabled rows, closes on Escape with focus back on its trigger,
and lets Tab leave. Rather than four components learning this separately, it
is one hook.

**Tooltips describe, labels name.** Icon buttons keep `aria-label` (the name)
and gain a tooltip (`aria-describedby`, only while visible). Screen readers are
not told the same word twice.

**Confirm asks in the product's voice.** A destructive act names the record,
says what cannot be undone, focuses Cancel, and — when the cost is a whole
record — asks for the name to be typed. A browser alert can do none of that
and can be suppressed by the browser after repeated use.

**Sentence-case field captions inside dialogs.** The file's bare `label` rule
uppercases and tracks every caption; that suits a dense table header, not a
column of questions. `tm-field` opts out.

**No new colour.** Every token here is a size, a duration, or a `color-mix` of
the nine palette colours. The palette test still holds.

## 4. Accessibility notes

- Dialogs: `role="dialog"`, `aria-modal`, `aria-labelledby` and now
  `aria-describedby`; focus trap; Escape; focus return; dirty-form guard on
  backdrop click (unchanged).
- Menus: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`;
  `role="menu"/"menuitem"/"menuitemcheckbox"`; `aria-current="page"`; roving
  focus; Escape returns focus.
- Tooltips: `role="tooltip"`, `aria-describedby` only while visible; shown on
  focus; Escape hides; a press hides.
- Segmented control: `role="group"` + `aria-pressed`, one Tab stop, ← → move
  the choice (mirrored in RTL).
- Form field: `aria-describedby` follows what is actually rendered (hint, or
  error when it replaces the hint), `aria-invalid`, `aria-required`, the error
  is `role="alert"`.
- Toast: error/warning are `role="alert"`, the rest `role="status"`; a
  visually-hidden tone prefix ("Error:") precedes the message.
- Skeleton rows: `role="status" aria-busy`; individual skeletons are
  `aria-hidden`.
- Focus rings use `outline` (the baseline discards `box-shadow`), on the
  `--focus-ring` token which promotes one rung in dark mode.
- Touch targets: dialog controls 36px with 44px footers on phones; rail
  buttons 44px; the back link grew to 32px.

## 5. Responsive behaviour

- `--dialog-gutter` drops from 24px to 16px under 640px; every kit surface reads
  it.
- `DialogFooter` wraps under 640px and its buttons stretch to full width at
  44px.
- `DialogSplit` stacks under 900px; the aside takes a top hairline instead of a
  side one.
- Menus clamp to `100vw - 16px` and flip above their trigger when the space
  below cannot hold them.
- Tooltips clamp to the viewport and flip to the top when they would fall off
  the bottom.
- Reference dialogs (`cn-meds`) already collapse to one column under 1000px;
  they now do so on the same gutter tokens.

## 6. Before / after

**Dialog head.** Before: solid brand band applied by a 300-character `:has()`
selector, white title, white close disc; every hand-rolled head guessed its
own padding. After: `DialogHeader` — condensed 20px title in the accent ink,
optional description, optional tinted icon plate, 36px window controls, one
gutter; `tone` chooses plain, brand or a danger/warning edge.

**Dialog foot.** Before: ad-hoc rows, `btn-sm` in some, 999px pills in others.
After: a hairline bar, primary last, optional leading note or tertiary
action; full-width 44px buttons on phones.

**Row actions.** Before: mouse-only pencil menu with inline Tailwind colours
and a shadow that never rendered. After: the shared menu — keyboard-complete,
elevated, tone-aware, grouped.

**Rail menus.** Before: flat rectangles with a hairline (the declared shadows
were discarded), no Escape on the account menu, no identity in it, `title`
tooltips. After: one elevation and radius, entrance motion, arrows/Escape on
every panel, name / role / facility at the top of the account menu, product
tooltips on every icon button.

**Confirmations.** Before: browser `confirm()` in eight clinical places.
After: the shared dialog with a title, a consequence sentence, a tone, and
Cancel focused.

**Toast.** Before: success/error, no titles, snapped in and out, edge colour
never painted. After: four tones, titles, enters and leaves on the motion
tokens, coloured edge as a border.

**Medications / Prescribe / Include Problems / Allergies.** Before: blue band,
18px padding, pill segmented tabs, footer as a plain row. After: plain head on
the kit gutter, a context pane on a faint wash, segmented control with a
filled segment, footer as a bar with the primary trailing.
