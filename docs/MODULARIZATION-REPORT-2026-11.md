# Modularization report: functions and styles (2026-11-05)

**Question:** how can the platform's functions and styles be rewritten so that every file is modular and a human can understand it?

**Method:**
- A read-only sweep of `platform/src` (1,291 source files, about 291k lines) and `website/`.
- Four parallel reviews: styles, UI components, the data/service layer, and repo structure and tooling.
- I re-checked the key claims by hand. Items marked **(verified)** were re-measured directly.
- No code was changed.

**Builds on:**
- [ADR 0003 — domain modules](adr/0003-domain-modules.md)
- [TECH-DEBT-IMPLEMENTATION-PLAN-2026-09](TECH-DEBT-IMPLEMENTATION-PLAN-2026-09.md)

This report does not replace either. It supplies the per-file standards those two leave open, and the order to apply them in.

---

## 1. Summary

The codebase does not need a rewrite. Its good patterns already exist, but they are applied in perhaps a fifth of the code. The rest grew one feature at a time into a small number of very large files.

| Layer | What is wrong | The fix that pays most |
|---|---|---|
| **Styles** | `globals.css` is 36,648 lines, 93% of which is feature rules appended in build order. Many rules exist only to undo earlier rules. There are 2,278 `!important` in total. No `@layer` or `@import`. Roughly 15–24% of the file looks unused. | Make `globals.css` an ordered **manifest** that imports small files grouped by namespace: tokens, then base, then kit, then features, then passes. Delete dead rules first. Prevent regrowth with a ratchet test. |
| **UI components** | About 12 files run a whole screen in one function. For example, `EhrClinicalDashboard` is about 1,850 lines in one component, the front-desk page about 2,090 in one function, and `PatientDetailPage` has 56 `useState`. The same logic is copied across the two dashboard engines. | Split in a fixed order: **pure rules first** (they can be tested), then hooks, then `parts/`. One folder per feature, following the existing `order-basket/` folder. |
| **Services** | 95 services hand-write the same read/write/audit/sync steps. Pure rules are mixed with I/O. Hidden coupling through 156 lazy cross-service imports. | One `defineRepository()` primitive, plus a `rules.ts` / `repository.ts` / `service.ts` split per domain, applied as each domain moves under ADR 0003. |
| **Structure and tooling** | `lib/` holds 110 flat files. Only 2 of 107 API routes are thin. No size or complexity lint rules. 61% of files have a header comment, and 1 of 13 modules has a README. | Size ratchet in ESLint, a route-adapter template, a file-header and module-README template, and corrected onboarding docs. |

**The rule that makes this safe:** extract first, change behaviour later. Each step moves code without changing what it does and proves that with a test. Each behaviour change (for example, adding tenant scope to the 18 updates that have none) gets its own commit.

---

## 2. Things found along the way that are real defects (fix regardless)

These are small, cheap, and independent of the refactor.

1. **The i18n check cannot see about 670 keys (verified).**
   - The `ENTRY` regex at `platform/scripts/check-i18n.mjs:19` only matches entries where both the key and the value are in single quotes.
   - It parses **11,824 of 12,496** `en` keys. Entries such as `'scribe.subtitle': "Capture → draft → …"` (`en.ts:4`) are invisible to the parity and placeholder checks.
   - Fix: load the maps by importing them (via `tsx`), not with a regex.
   - Also add `src/modules` to the untranslated-text scan. `MessagingDock` and ScribePanel now live there, and the scan never looks at that folder.
2. **`typedoc.json:10` lists `src/lib/db-types-feedback.ts`, which does not exist (verified).** `skipErrorChecking` hides the error. The typedoc entry points also cover `lib/services` but not `src/modules`.
3. **Module privacy has a leak.**
   - `PRIVATE_MODULE_DIRS` in `eslint.config.mjs:34` leaves out `api/` and root-level module files.
   - So `lib/db-types.ts` can import `@/modules/communication/issue-rules` without any lint error.
   - Fix: replace the deny-list with an allow-list regex (§6.3).
4. **18 of 19 `update*(id, data)` service functions take no `DataScope`.** Example: `problem-service.ts:81`, verified. On the device, only the server validator stops a cross-tenant write. This change alters behaviour, so ship it as its own commit per domain.
5. **A third global CSS trap that AGENTS.md doesn't mention.** `*:not(.tm-elevated){box-shadow:none!important; …}` at `globals.css:983` (verified) removes every shadow on the site. That is why every shadow elsewhere needs `!important`. Add it to the "Styling" traps in AGENTS.md.
6. **Dead or stale files.**
   - `components/ehr/EhrModuleMenu.module.css` has no importer (verified).
   - The `data/mock.ts:7` header points to `@/lib/clinical-types`, which doesn't exist.
   - An orphaned JSDoc block in `front-desk/page.tsx` (~80–105) describes a function that now lives in `lib/appointment-workflow.ts:11`.
   - `tailwind.config.ts` declares `fontFamily.sans: 'DM Sans'`, but the fonts actually loaded are Barlow and IBM Plex.
7. **Stale onboarding docs.**
   - `docs/ARCHITECTURE.md` and `docs/DEVELOPER-ONBOARDING.md:58-80` never mention `src/modules`. Onboarding still says "services/ — ALL business logic".
   - ADR 0003's Status line names 4 modules; 13 have landed.
   - ADR 0003 doesn't document the `/edge` surface that eslint already allows.

---

## 3. Styles

### 3.1 What's there

| Metric | Value |
|---|---|
| CSS files / lines | 56 files, 52,390 lines. `globals.css` = 36,648 (70%) |
| `!important` | 1,265 in globals, 1,013 elsewhere. `tablet-desktop.css` has 247 in 798 lines, `management-frame.css` 138 in 644 |
| Selectors redefined later in globals | 841. Of those, 456 are more than 1,000 lines apart |
| Class-prefix namespaces inside globals | 120 (`ehr` alone = 11.8k lines, with 678 `!important`) |
| Raw colours | 364 hex outside the token blocks in globals, 462 in other CSS files (`tamam-chart.css` 180) |
| Literal `font-size` vs tokenised | 1,158 vs 41 |
| Distinct breakpoints | 29 (639/640, 767/768, 1023/1024/1025 …) |
| Inline `style={{` in TSX | **3,400** across 277 files (verified). `mch-analytics/page.tsx` has 187 |
| Classes in globals never referenced in TS/TSX | 684 of 2,243 (30%). About 1,200 rules / about 8.7k lines are fully unreferenced (upper bound) |

**How `globals.css` is laid out today:**

| Lines | Content | Share of file |
|---|---|---|
| 5–971 | Tokens: layout, light, dark | 2.6% |
| 972–2463 | Base: reset, typography, `label`, inputs, `.btn`, tables | 4% |
| everything after | Feature rules, in the order they were built | ~93% |

The structure does not hold in practice:
- `:root` is reopened 5 more times (3019, 3048, 35277, 35948, 36339), and dark mode twice more.
- `.btn` is defined in 23 places.
- `.ehr-center-panel` is defined in 8 places.
- `select` is defined 36 times.
- Late "fix" passes are written to win by source order. Examples: `globals.css:15445`, "Rather than untangle every historical rule, these late-cascading fixes…" (verified); "Dashboard density pass" (17390); "Sharpen pass" (28393); "ONE FORM LOOK" (36320).
- About 210 rules exist only to undo other rules: `none !important`, `unset`/`revert`, and "override/undo" comments.

**Load chain** (`app/layout.tsx:4-9`, verified):
- Load order: globals, then print-typography, tablet-desktop, accent-pass, management-frame. A test enforces this order.
- `@tailwind utilities` sits at line 3, **above** every custom rule. So any custom class beats a Tailwind utility of equal specificity. Today's behaviour depends on this.
- Some component CSS is shared without being labelled as shared:
  - `ehr/chart/panels/start-visit-panel.css` is imported by 12 unrelated components.
  - `lab/order/lab-order.css` is imported by the pharmacy and radiology panels.
  - With per-route CSS chunks, the order of these files changes depending on the route.

### 3.2 Target architecture

`globals.css` remains the single entry and the token source in spirit. It becomes an **ordered list of imports**, and the tokens live in files it imports:

```
src/styles/
  tokens/    palette.css  light.css  dark.css  layout.css  z-index.css   (custom properties only)
  base/      reset.css  flat-baseline.css  typography.css  forms.css  icons.css  tables.css
             ↑ the three global traps (label caps, svg.lucide recolour, shadow killer) each
               isolated in one file with a header explaining why it exists and how to escape it
  kit/       buttons.css  overlay-tm.css  dialogs-o3.css  sliders.css  notifications.css
             list-surface.css  workspace-form.css (was start-visit-panel.css)
  shell/     top-rail.css  mobile-shell.css  dashboard-workspace.css
  features/  appointments.css  chart-facesheet.css  sa.css  sadb.css  rpt.css  pp.css  msgs.css …
  passes/    tablet-band.css  accent-pass.css  management-frame.css  print.css   (explicit, always last)
```

```css
/* src/app/globals.css: the manifest. Order IS the cascade; do not sort. */
@import "tailwindcss/base";
@import "../styles/tokens/palette.css";   /* … all tokens … */
@import "../styles/base/reset.css";       /* … all base … */
@import "tailwindcss/components";
@import "tailwindcss/utilities";          /* stays BEFORE custom classes, as today */
@import "../styles/kit/buttons.css";      /* … kit, shell, features … */
@import "../styles/passes/tablet-band.css"; /* … passes last … */
```

This needs `postcss-import` added as a direct devDependency, placed before `tailwindcss` in `postcss.config.mjs`. That is Tailwind v3's documented setup.

**Don't adopt native `@layer` yet.** Tailwind v3 output is unlayered, and unlayered rules beat every layered rule. Inside layers, `!important` also reverses priority. With 2,278 `!important` that would silently reorder the cascade. For now, use file order as the layer, and revisit with Tailwind v4.

**Rules for every style file:**
- One namespace per file. A component may import a CSS file only if every selector in it is under that component's namespace. Generalise the existing `management-surface.test.ts` to enforce this everywhere.
- Colours only through `var(--token)` outside `tokens/`.
- `!important` only in `base/flat-baseline.css`, `base/icons.css` and `passes/`, each with a `/* why: */` comment.
- No styled-jsx (FOUC trap; still used in `PortalAccessCard.tsx` and `BulkUserImportModal.tsx`).
- No new `[style*=…]` attribute selectors.
- Size budget: 800 lines per file. Feature files may go up to 1,200 while migrating.
- A header on every CSS file:

```css
/* ───────────────────────────────────────────────────────────────
 * <Namespace> (<prefix>-*): <what screen/part this styles>
 * Owner:    components/<…>  (who renders these classes)
 * Position: manifest slot <kit|features|passes>, after <file>
 * Traps:    relies on / escapes <label caps | svg.lucide | shadow killer>
 * Tests:    __tests__/<…>.test.ts
 * ─────────────────────────────────────────────────────────────── */
```

### 3.3 Migration (one PR per step)

0. **Safety net.**
   - Add a `css-budget.test.ts` that freezes the counts per file (`!important`, lines, hex outside tokens, `style={{`). Counts can go down but never up.
   - Add a `readStyles()` helper that concatenates the manifest in order. Point the **6 tests that read `globals.css` by path** at it: color-tokens, dark-theme, daybar, icon-visibility, print-workflows, dashboard-header-actions.
   - Record a baseline: computed-style snapshots and screenshots of about 25 routes across roles, at 1440/1024/768/390 widths, in dark mode and in print.
1. **Delete dead rules**, one namespace at a time. Check first for class names built at runtime (`status-${…}`, `urgency-${…}`) and for library classes (`rbc-*`, `leaflet-*`). The snapshot diff must come out empty.
2. **Move tokens** (lines 5–971 plus the 5 late `:root` blocks) into `tokens/`. These are custom properties only, so the risk is near zero.
3. **Move the clean tail slices**, keeping their position in the manifest: overlay kit, O3 dialogs, sliders, notifications, `sadb`, `rpt`, `sa`. They are already single-namespace, so order doesn't change.
4. **Bring shared component CSS into `kit/`.** This removes the route-dependent ordering risk.
5. **Merge each multiply-defined selector into a single rule**, one namespace per PR, with a snapshot diff each time. This is the riskiest step, because the late passes exist precisely because earlier rules lost.
6. **Sweep inline styles** in the worst offenders: mch-analytics, immunizations, referrals, MessagingDock.
7. **Clean up:** remove styled-jsx, and document the 29 breakpoints as 5.

---

## 4. UI components

### 4.1 What's there

518 `.tsx` files (122k lines) in `components/`, `app/` pages and `lib/hooks`. Of these, 133 are over 300 lines, 61 over 500, and 20 over 800.

| File | Lines | Main function | useState | Notes |
|---|---|---|---|---|
| `components/ehr/EhrClinicalDashboard.tsx` | 2584 | ~1,850 lines | 21 | 17 props. Serves the doctor plus 5 station dashboards. JSX nested 18 deep at line 2296 |
| `app/(dashboard)/dashboard/front-desk/page.tsx` | 2201 | ~2,090 lines | 27 | One `useMemo` is 455 lines (1202–1658) and holds hardcoded English |
| `components/clinical-notes/ClinicalNoteEditor.tsx` | 1986 | ~1,815 lines | 35 | 11 `showX` booleans (202–214, verified) that are really one "which panel is open" value |
| `components/patients/PatientDetailPage.tsx` | 1262 | ~1,160 lines | **56** (verified) | `buildSendPatientMessage(…)` at line 659 takes 19 arguments, 12 of them setters (verified) |
| `components/ehr/EhrCareDashboard.tsx` | 1409 | ~1,040 lines | 10 | JSX nested 20 deep. A second dashboard engine |
| `components/payments/BillingWorkspace.tsx` | 1402 | ~975 lines | 22 | Has a 280-line `PatientBillingDetail` defined inline |
| `components/nurse/triage/useTriageForm.ts` | 1140 | one hook | 39 | A whole screen's controller |

### 4.2 Duplication clusters

1. **Two dashboard engines.** `EhrClinicalDashboard` and `EhrCareDashboard` each re-implement:
   - status lane tabs;
   - the month calendar (while `EhrMiniCalendar` already exists);
   - print wiring;
   - check-in and status sliders;
   - rail dock;
   - row sort.

   They also handle URL state two ways: `useUrlView` in one, raw `history.pushState` in the other.
2. **Status → pill class, three copies with different behaviour:**
   - `EhrCareDashboard.tsx:173`;
   - `EhrClinicalDashboard.tsx:524`, which has no `'ready'`;
   - `EhrClinicalDashboard.tsx:2230`, inline.
3. **Station worklist builders.** Four copies of the `row()`/`push()` closure, the `patientById` map and `clock()`. Two of the `clock()` copies lack the null guard. `new Map(patients.map…)` appears 15 times.
4. **Visit-exit writes** ("left without being seen", return to desk, escalate) are written three times: in the dashboard, the front desk and `useTriageForm`.
5. **Role and status literals.**
   - The four nurse-family roles are hand-listed at 12 sites, and no `isNurseFamilyRole()` helper exists.
   - 61 `role === '…'` comparisons.
   - 607 `status === '…'` literals.
6. **Data-hook boilerplate.** About 40 hooks repeat the same ~25-line skeleton: data, loading and error state, a scope guard, try/catch, then `t(error)`.

### 4.3 Good patterns to standardise on

- **`components/ehr/chart/panels/order-basket/` is the reference folder.**
  - `basket-types.ts`
  - `sign-orders.ts`: a pure write coordinator, with its own test.
  - `useOrderBasket.ts`: 65 lines.
  - Five presentational parts of 42–260 lines.
  - Its own CSS.
  - A plain-language header in every file.
- **The `assemble*Worklist` pure functions** are tested by 7 suites. This is the right shape for a "rules" layer.
- **Kits with real adoption:** `FormSlider` (86 importers), `Modal` (58), `overlay/Dialog` (47), `ConfirmDialog` (32), `O3Form`, `filters/`, `table/useColumnSort`.
- **`usePouchLiveReload`** is already used by about 49 hooks and components, so Phase 4 of the tech-debt plan is further along than that document says.

### 4.4 Folder convention for a feature

```
components/<area>/<feature-kebab>/
  index.ts               re-exports the component + public types ONLY (never a hook that reaches a service)
  <Feature>.tsx          composition: calls hooks, lays out parts            ≤ 250 lines
  <feature>-types.ts
  <feature>-rules.ts     pure: rows, filters, sort, tone/labels; takes `t`/labels as input; unit-tested
  use<Feature>Data.ts    reads (lib/hooks) + memoised view-model built from rules
  use<Feature>Actions.ts writes + toasts + confirms; OWNS the state its handlers need
  parts/<Part>.tsx       props in, events out; no services, no useAuth
  <feature>.css          one namespace (see §3.2)
```

Route `page.tsx` files stay under 150 lines and render one feature component. Route-private files go in `_parts/`. Today 8 files use the mixed `_Foo.tsx` style instead.

**Where extracted code goes:**

| Extract as… | When |
|---|---|
| **Pure function** (`*-rules.ts`) | Anything computable from inputs alone: rows, columns, counts, tone, labels, sorting. **Always do this first**, because it can be tested without rendering. |
| **Hook** | State and effects that belong together (URL state, autosave, a composer, a live subscription), or 3 or more `useState` used by the same handlers. Never hand setters to a factory function the way `buildSendPatientMessage` does; extract a hook that owns the state instead. |
| **Sub-component** (`parts/`) | A region the UI names (calendar card, worklist row, preview panel), any `.map` body over 30 lines, and every modal. |
| **Shared `lib/`** | Anything already present in 2 or more files: `statusToneClass`, `isNurseFamilyRole`, the station row factory, visit-exit writes. |

**Per-component budgets:**
- At most 8 `useState`; beyond that, use a reducer or a hook.
- No `useMemo` body over 40 lines.
- No IIFE (a function defined and called on the spot) inside JSX.
- JSX nesting depth at most 8.
- No function with more than 6 parameters or any setter parameter.

### 4.5 Split plans for the three worst files

**A. `ClinicalNoteEditor.tsx` → `components/clinical-notes/note-editor/`.** Do this first: it is the most self-contained and already has 4 tests.

| New file | What it holds |
|---|---|
| `note-panel.ts` | A `NotePanel` union type and a `useNotePanel()` hook, replacing the 11 booleans and the OR-ing at ~858 |
| `useNoteDocument.ts` | Load, save, flush, sign, cosign. The autosave and lost-edit effects must move **together**, because they depend on effect order |
| `useNoteChartContext.ts` | Patient, sibling notes, labs, documents, problems, rail status |
| `useNoteWorkspaceNav.ts` | Groups, collapse state, active section |
| `useNoteShortcuts.ts` | Keyboard shortcuts |
| `parts/` | `NoteBanner`, `NoteWorkspaceNav`, `NoteSectionsColumn`, `NoteSidePanels`, `SignConfirm`, `Addendum` |

Also delete the local `withTimeout`, `nameInitials` and `dobWithAge` (lines 90–120) in favour of the existing `lib/write-timeout.ts` and `lib/patient-utils.ts` versions.

**B. `front-desk/page.tsx` → `components/front-desk/desk-board/`** (the folder already holds CheckIn, Checkout and DetailPanel).

| New file | What it holds |
|---|---|
| `desk-queue-rules.ts` | `buildDeskQueue()`, from 428–735 |
| `desk-row-rules.ts` | `buildFrontDeskRows({…, labels})`, from 1202–1658. Its English literals become i18n keys in both `en` and `apd` |
| `desk-metrics.ts` | Counts and metrics, from 1659–1782 |
| `useDeskBoardState.ts` | Date, tabs, URL |
| `useDeskRegistration.ts` | Registration flow |
| `useDeskActions.ts` | Write handlers, from 770–1101 |
| `parts/DeskOverlays.tsx` | Overlays |

`page.tsx` shrinks to `<FrontDeskBoard/>`.

**C. `EhrClinicalDashboard.tsx` → `components/ehr/clinical-dashboard/`.** Keep the old path as a one-line re-export, so the 6 consumers and the tests don't change.

| New file | What it holds |
|---|---|
| `worklist-types.ts` | Types |
| `worklist-rules.ts` | The ~20 exported pure helpers from 83–705, plus the lane and status-group closures |
| `useClinicalDashboardUrl.ts` | URL state |
| `useClinicalDashboardData.ts` | 768–1270 |
| `useVisitActions.ts` | 1336–1598. Later moves to `lib/clinical-flow/visit-exits.ts`, shared with the front desk |
| `print-appointment.ts` | Printing |
| `parts/` | `CalendarCard` (reuses `EhrMiniCalendar`), `OutstandingRail`, `WorklistRow`, `AppointmentPreviewPanel`, `FindPatientDialog`, `DashboardOverlays`, `DayActivityChart` |

Keep the 17-prop contract stable during the split. Redesign it afterwards: it is really 6 dashboards behind one switchboard.

---

## 5. Services and the data layer

### 5.1 What's there

157 files, 56.5k lines, about 1,450 top-level functions.

| Function length (lines) | Count |
|---|---|
| ≤20 | 959 |
| 21–50 | 362 |
| 51–100 | 98 |
| 101–200 | 22 |
| >200 | 8 |

**Longest functions:**

| Function | File:line | Length (lines) |
|---|---|---|
| `seedDatabaseExclusive` | `lib/db-seed.ts:2031` | 2,205 (complexity 248) |
| `AppProvider` | `lib/context.tsx:57` | 1,165 (`login` alone ≈ 437) |
| `buildValidateDocUpdateFn` | `lib/sync/write-permissions.ts:791` | 442. A stringified CouchDB validator, so it legitimately stays one unit |
| `dispenseMedication` | `dispensing-service.ts:545` | 402 |
| `checkInPatient` | `check-in-service.ts:220` | 279 |
| `generateDHIS2Export` | `dhis2-export-service.ts:161` | 251 |
| `createPrescription` | `prescription-service.ts:675` | 207 |
| `evaluateCheckoutGate` | `checkout-gate-service.ts:138` | 204 |

### 5.2 Repeated boilerplate

| Pattern | How common |
|---|---|
| **Scoped list read:** `findByType` → filter → sort → `filterByScope` | 95 files. 41 of them use `scope ? filterByScope(all, scope) : all`, which returns everything when no scope is passed. 119 optional scopes are still on the ratchet |
| **Write steps:** generate id, set `type`, infer `orgId`, set timestamps, `put`, copy back `_rev`, `logAuditSafe`, `emitSyncEvent` | Each step repeated in 68–85 files. `inferOrgIdFromHospital` is copied verbatim into **7** services (verified) |
| **Conflict handling** | `isConflict`/`isNotFound` defined 3 times. 17 hand-rolled retries on 409 conflicts |
| **Status transitions** | Mostly central (`clinical-flow/encounter-journey.ts`, `order-lifecycles.ts` + `makeGuard`). Private tables remain in `triage-service.ts:133` and `specialty-care-service.ts:22`; a third copy ships in `write-permissions.ts:545` |
| **Hidden coupling** | 156 `await import()` calls from one service into another, to dodge import cycles. `prescription-service` lazily loads 13 modules |
| **Errors** | 175 `throw new Error('prose')`, 63 string codes, 26 typed error classes with no shared base. 34 `catch` blocks swallow the error |

**Pure data and rules mixed into I/O files:**
- `drug-interaction-service.ts` is 82% data: `INTERACTION_DATABASE` runs from line 68 to 1626 (verified). Moved out, the code is about 300 lines.
- `dispenseMedication`'s "1. Validate" step is about 190 lines of pure guards. It could become `planDispense(rx, facts) → Plan | Refusal`.
- `db-types.ts` (3,342 lines, 116 types, 487 importers) is split by `// =====` banners, but the 7 `db-types-*.ts` files are imported separately.

**`lib/context.tsx`:**
- Consumers already get separate slices: `useAuth` (192 files), `useSync`, `useUi`.
- The problem is the provider. One component holds 15 `useState`, the 437-line `login`, and the 257-line boot effect.

### 5.3 Standard service shape

`modules/specialty-care/` is already the working example. Its one flaw is that its transition table sits in the service.

```
modules/<domain>/
  index.ts · client.ts · README.md
  core/types.ts         domain doc types (moved out of db-types.ts)
  core/rules.ts         pure: guards, calculations, transition tables, planners
  core/errors.ts        class <Domain>Error extends DomainError<'CODE_A' | 'CODE_B'>
  services/<x>-repository.ts   defineRepository({...}) config only
  services/<x>-service.ts      orchestration: load facts → rules → repo writes → side effects
```

The shared primitive lives in `lib/persistence/`. It never imports a module and never goes in a barrel.

```ts
export function defineRepository<T extends BaseDoc>(cfg: {
  db: () => PouchDB.Database;          // getDB() encrypting wrapper; never getRawDB
  type: T['type']; idPrefix: string; syncResource: string;
  audit?: { created: string; updated: string; deleted: string };
  live?: (d: T) => boolean;            // e.g. recordStatus !== 'entered_in_error'
  indexFields?: NonPhiKeys<T>[];       // checked against phi-field-catalog.json at definition time
  orgFrom?: 'doc' | 'hospital';        // replaces the 7 inferOrgIdFromHospital copies
}): {
  list(scope: DataScope, where?: Partial<Pick<T, NonPhiKeys<T>>>): Promise<T[]>;  // find → live → filterByScope
  get(id: string, scope: DataScope): Promise<T | null>;
  create(input: NewDoc<T>, actor: Actor, opts?: { id?: string }): Promise<T>;    // id, timestamps, _rev, audit, sync event
  update(id: string, patch: Patch<T>, actor: Actor, opts?: { retryOnConflict?: number }): Promise<T>;
  remove(id: string, actor: Actor): Promise<void>;
};
export const SYSTEM_SCOPE: DataScope & { readonly __system: true };  // explicit authority, never an omitted argument
```

Two helpers go with it:
- `transition(repo, id, table, to, actor)`, built on `makeGuard`.
- A `compensatingWrites()` helper, for the hand-written rollbacks in billing, referral, ward, dispensing and prescription.

**Splitting the giant data files:**
- **`db-types.ts`** becomes a type-only barrel over `lib/db-types/{base,patients,clinical,pharmacy,…}.ts`, cut along the existing banners. All 487 importers keep working. Each domain's file moves to `modules/<d>/core/types.ts` when that domain migrates.
- **`db-seed.ts`** splits into a runner (lock, version, markers) plus `seed/fixtures/<domain>.ts` (pure, given a clock) plus ordered `seed/steps/<domain>.ts`. Two hard rules:
  - Seed ids must stay **byte-identical**.
  - **Do not bump `SEED_VERSION`.** This is a refactor, not a data change.
- **`context.tsx`** splits into:
  - `context/auth/login-flow.ts`: plain async `loginOnline`, `loginOffline`, `hydrateSession`, returning a `LoginOutcome` union, so they can be unit-tested.
  - `context/boot.ts`.
  - `useSyncController.ts`.
  - `AuthProvider`, `SyncProvider` and `UiProvider`, composed by a short `AppProvider`.

---

## 6. Repo structure, routes, i18n, tooling

### 6.1 Where the 110 flat `lib/` files belong

| Group | Examples | Target |
|---|---|---|
| Scheduling (10 + `booking/`) | `appointment-*`, `station-time`, `time-juba` | `modules/scheduling` (`time-juba` → `shared/time`) |
| Patient portal (9) | `patient-portal-*` | new `modules/patient-portal` (add it to ADR 0003) |
| Patients (4) | `patient-utils`, `patient-redaction`, `entity-names` … | `modules/patients` |
| Clinical (10) | `chart-*`, `visit-summary`, `care-alert-rules`, `vital-certificates` … | `modules/clinical` |
| Pharmacy / revenue | `pharmacy-*`, `prescription-script`, `ledger-summary`, `payment-method-config` … | `modules/pharmacy`, `modules/revenue` |
| Access policy (8) | `permissions`, `role-routes`, `role-*`, `clinical-roles` … | `modules/identity/policy`, Edge-safe through `edge.ts` because `proxy.ts` needs it |
| Data layer (16) | `db.ts`, `db-types*`, `encrypted-db`, `db-seed`, `phi-field-catalog.json` | `shared/db`. Types and seeds split into their modules |
| Server runtime / UI utilities | `api-*`, `rate-limit`, `secrets` … / `format-utils`, `csv`, `print-*` … | `shared/server`, `shared/ui`, `shared/util` |

**Blocker:** 39 `lib/` files already import `@/modules/*`. So `lib/` can't simply be renamed to `shared/`, because `shared/` must not depend on modules. Domain types have to move into their modules first.

### 6.2 API routes

Of 107 `route.ts` files, only 2 are thin adapters.
- 48 declare their own inline role arrays, 12 call `getDB` directly, and none use schema validation.
- `modules/analytics/api/sync-route.ts` is about 1,240 lines of projection data, with the handler at `:1314`.

The template is two files, with no new framework:

```
src/app/api/<path>/route.ts      export { GET, POST } from '@/modules/<m>/api/<name>-route';
src/modules/<m>/api/<name>-route.ts
  ACCESS lists from '../policy/access'           (no inline role arrays)
  parse<Name>(body) → { ok: true; value } | { ok: false; fields }   pure, in core/, unit-tested
  handler: authorizeJson(req, ACCESS.create) → parse → service.create(value, scopeFromAuth(auth)) → json
  export const POST = withAuditLog(postHandler, { action: '<m>.<verb>' });
  forbidden in route files: getDB, filterByScope, loops over documents
```

Make `api-route-adapters.test.ts` a ratchet. The list of routes that are not yet adapters may only shrink, and every new `route.ts` must be an adapter.

### 6.3 Guard-rails: a size ratchet in ESLint

Today there is no `max-lines`, `max-lines-per-function` or `complexity` rule. Current state:
- 72 files have more than 500 lines of code.
- 235 functions are over 150 lines.
- 215 functions have complexity over 25.

The recommended setup:
- **New files:** the limits apply as errors.
- **Today's offenders:** capped at their current size by a generated baseline, so they can shrink but never grow. This is the same pattern as `UNTRANSLATED_BASELINE`.
- **Warnings:** using errors keeps the existing `--max-warnings 223` ceiling unchanged.

```js
// eslint.config.mjs
import sizeBaseline from './eslint-size-baseline.json' with { type: 'json' };
const SIZE = {
  'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
  'complexity': ['error', 25],
  'max-depth': ['error', 4],
  'max-params': ['error', 5],
};
const sizeRules = [
  { files: ['src/**/*.ts'],  rules: { ...SIZE, 'max-lines-per-function': ['error', { max: 80,  skipBlankLines: true, skipComments: true, IIFEs: true }] } },
  { files: ['src/**/*.tsx'], rules: { ...SIZE, 'max-lines-per-function': ['error', { max: 250, skipBlankLines: true, skipComments: true, IIFEs: true }] } },
  ...Object.entries(sizeBaseline).map(([file, c]) => ({ files: [file], rules: {
    'max-lines': ['error', { max: c.lines, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: c.fn, skipBlankLines: true, skipComments: true, IIFEs: true }],
    'complexity': ['error', c.cx],
  } })),
  { files: ['src/lib/i18n/locales/**', '**/*.generated.ts', 'src/**/*.test.{ts,tsx}', 'src/__tests__/**'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off', 'complexity': 'off' } },
];
// place ...sizeRules BEFORE ...moduleBoundaryRules(); baseline blocks must never set no-restricted-imports
```

**Supporting pieces:**
- A `scripts/` generator writes `eslint-size-baseline.json`, about 300 entries.
- `__tests__/architecture/size-baseline.test.ts` fails if an entry is looser than the file's real value, or if a file is back under the defaults and its entry should be deleted.
- Module boundaries switch to an allow-list regex (ESLint 9.39 supports `regex`). Private becomes the default for `api/`, root files and any new folder:

```js
patterns: names.map(n => ({ regex: `^@/modules/${n}/(?!(client|edge)$|services/[\\w.-]+$).+`, message: … }))
```

**How the budgets were reconciled.** The four reviews proposed slightly different limits; this report picks one set:

| Limit | Value |
|---|---|
| File | 500 lines of code |
| `.ts` function | 80 lines |
| `.tsx` component | 250 lines |
| Complexity | 25 |
| Parameters | 5 |

Exempt: the stringified CouchDB validator and pure data tables.

### 6.4 i18n

There are 12,496 flat keys across 224 prefixes; `ui.` alone has 1,575. The plan:

1. Fix the check first (§2.1).
2. Shard each locale by namespace: `locales/en/<ns>.ts` and `locales/apd/<ns>.ts`. Keep `locales/en.ts` as an aggregator (`export default { ...ui, ...patientPortal, … }`), so the dynamic `import('./locales/${locale}')` and the 15 tests that import locales by path keep working.
3. Have the check require two things: each key's prefix matches its file name, and `en/` and `apd/` contain the same file list.
4. Keep the locales in one place (not inside each module) so translators have one place to work.

### 6.5 Generated and reference data

| Data | Convention |
|---|---|
| Curated reference data (formulary, lab tests, ICD-11, allergens, geo) | `src/shared/reference/`, with a `Source:` / `Reviewed:` header |
| Anything a script writes | `*.generated.ts`, with a `GENERATED by <script>. Do not edit` header (`south-sudan-locations.generated.ts` already does this right), plus `.gitattributes` `*.generated.ts linguist-generated=true` |
| The PHI catalogue | `src/shared/security/phi-field-catalog.json`, kept apart from utilities because it is security-critical |
| Demo and seed data | `src/seed/` or `modules/<m>/seed.ts`, so the name "mock" stops sitting on load-bearing types (25 non-test files import `@/data/mock`) |

This also merges the two data folders, `src/data/` and `src/lib/data/`.

### 6.6 Tests

There are three styles today:
- 564 files under `src/__tests__`;
- 9 co-located test files;
- a nested `components/patient-portal/__tests__/`.

**Pick one rule:**
- A unit test sits next to its code as `foo.test.ts`.
- `src/__tests__/` is only for suites that cross modules: architecture, integration, security, rbac, sync, a11y, and helpers.

Move tests as each domain migrates.

**Watch out for tests that read source files by path.**
- **69 test files** read source by path. Moving code makes their `toContain` checks fail loudly, which is good.
- Their `not.toContain` checks keep passing silently on a file that no longer holds the code.
- Every split PR must re-point these tests at the new files, or replace them with behaviour tests.

### 6.7 Documentation for humans

**File header** (required on new files; a lint-staged script checks it). 61% of files have one today. `modules/identity/index.ts:1-35` is the best existing example.

```ts
/**
 * <One line: what this file is for, in domain words.>
 *
 * Owner: modules/<m>   Surface: server | client | edge | private
 * Used by: <main callers or "route X">
 * Invariants: <tenant scoping / PHI / offline-sync / append-only rules this file enforces>
 * See: <ADR or doc link>
 */
```

Keep comments that explain **why**. Move "this used to… / was removed…" history into commit messages. The big dashboards carry hundreds of lines of it.

**Module README** (`src/modules/<m>/README.md`). Only 1 of 13 modules has one. Extend `module-registry.test.ts` so it fails when a module has no README.

```
# <Module>: <one-line purpose>
## Owns            databases (tamamhealth_*), doc types, routes (/api/…), pages
## Public surface  index (server) · client · edge · services/<name>, what each is for
## Invariants      scoping rule, PHI fields (catalog keys), sync/conflict policy, roles allowed
## Depends on      other modules' surfaces it imports and why
## Tests           co-located unit tests; cross-module suites in src/__tests__/<…>
## Change recipes  "add a field", "add a route", "add a role"
```

**Other doc work:**
- Update `ARCHITECTURE.md`, `DEVELOPER-ONBOARDING.md` and the ADR 0003 status (§2.7).
- Move about 50 dated audit and plan files out of the top of `docs/` into `docs/audits/`, so the evergreen docs are findable.

### 6.8 website/

It is healthy and self-contained (6.6k lines, no shared code with the platform). Three items:
- The colour palette is copied by hand from the platform: the comment at `website/src/app/globals.css:22` says so. Add a test that compares the 9 tokens.
- `src/lib/site-data.ts` is a 1,413-line content blob that could be split by page.
- There are 0 tests.

---

## 7. Roadmap: the order to do this in

Each item is its own PR: lint, `npm test`, `i18n:check`, and a production build all green, plus a browser pass for UI work.

| Phase | Work | Risk | Behaviour change? |
|---|---|---|---|
| **0. Fix and fence** (≈1 week) | §2 defects 1–3, 5–7. Size baseline + ESLint ratchet. Boundary allow-list. CSS budget test + `readStyles()`. File-header and README templates. Doc corrections | Low | No (except the i18n check, which may surface real missing `apd` keys) |
| **1. Pure extractions** | `INTERACTION_DATABASE` → data file. `db-types.ts` → type-only barrel over per-domain files. Shared `statusToneClass`, `isNurseFamilyRole`, station row factory, `DomainError`/`isConflict`. ClinicalNoteEditor split (§4.5 A) | Low–medium | No |
| **2. CSS, part 1** | Characterisation snapshots → dead-rule deletion → tokens out → tail slices out → shared component CSS into `kit/` | Low–medium | No (snapshot diff must be empty) |
| **3. Primitives** | `defineRepository` + `transition()` + `useScopedCollection` with full tests. Pilot on the small CRUD services (problem, allergy, program, history, procedure). front-desk split (§4.5 B) | Medium | No |
| **4. Domain migrations (ADR 0003)** | scheduling → patient-portal → revenue → pharmacy (`planDispense`) → diagnostics → patients/clinical → maternal-child, public-health, facility-ops. Each one moves its types, rules, repository, service, routes, tests and seed fixtures together, and its lazy-import cycles go through a coordinator. EhrClinicalDashboard split (§4.5 C) lands alongside clinical | Medium–high | No |
| **5. Behaviour fixes, separate commits** | Add `DataScope` to the 18 unscoped updates, one domain at a time. Unify the 3 status-tone variants (decide the `'ready'` default explicitly) | Medium | **Yes**, so each is reviewed on its own |
| **6. CSS, part 2** | Merge multiply-defined selectors (one namespace per PR). Inline-style sweep. Breakpoint tokens | High (cascade) | Visual only, snapshot-diffed |
| **7. Finish** | `context.tsx` split (can run in parallel any time). `db-seed.ts` → runner/fixtures/steps. Locale sharding. `lib/` → `shared/` once a subset has no `@/modules` imports | Medium–high | No |

### Invariants every PR must respect

From AGENTS.md; each of these has broken production before.

- `filterByScope` stays the only tenant barrier and keeps failing closed.
- Never filter a Mango selector on a PHI-catalogued field. The repository should refuse these up front.
- The `write-permissions.ts` content, the push filter and `validate_doc_update` change together. A split is safe only if a byte-for-byte snapshot of the generated validator string is unchanged.
- Seed ids stay deterministic. Do not bump `SEED_VERSION` for a refactor.
- Barrels never re-export a service or a hook that reaches one. `await import()` points at the specific file.
- Client components import `@/modules/<m>/client`, never the server barrel.
- `proxy.ts` imports only Edge-safe files.
- Fix the `patient-assignment-service` → server `user-service` bundle leak before the patients domain migrates.

### How to keep behaviour identical

| What is moving | How to prove nothing changed |
|---|---|
| Pure extractions | Record the current function's outputs over a table of inputs **before** the move, then assert the extracted version matches |
| Repository swap | Golden test against in-memory PouchDB: old and new create/update produce the same document (minus `_rev` and timestamps), the same audit calls and the same `emitSyncEvent` payloads |
| UI splits | Characterisation render tests on fixed fixtures (reuse `__tests__/components/nurse/fixtures.ts`), then a browser pass over doctor, a station, front desk, and note sign-and-close |
| CSS | Computed-style and screenshot diffs at 4 widths, dark mode and print, compared on a **production build**, because CSS chunk order differs from dev |
| Seed | Run it in memory and snapshot the sorted `_id` set plus the normalised documents, before and after |

### Coordination

- Several targets have uncommitted edits on `feat/form-nav-arrows` right now: `globals.css`, `accent-pass.css`, `tamam-chart.css`, `ClinicalNoteEditor.tsx`, `O3Form.tsx`, `o3-form.css`.
- Start each slice from a fresh branch off `main`, after those land.
- Land one domain at a time, so `git mv` churn doesn't collide with parallel branches.
