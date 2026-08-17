# Super-Admin Design Plan

> Restyling plan for every super-admin surface, unifying the area under the
> super-admin design language defined in the Claude Design project. Written
> 2026-08-15, after the `/admin` dashboard shipped as the first page in the
> new language. This is a **plan**, not a changelog — pages below are listed
> in build order with what changes on each.

## 1. Sources of truth

Two design files in the Claude Design project define the entire language:

| Design file | Defines | Status |
|---|---|---|
| `Super Admin Dashboard.dc.html` | Card chrome, KPI tiles, tonal chips, KV rows, queue rows, grid lists, chart pills, head-links | **Implemented** as `sadb-*` on `/admin` (2026-08-15) |
| `Super Admin Settings.dc.html` | Two-pane settings shell (grouped icon rail + panel), the five setting-row kinds, status-card grids, danger zone, editor/confirm modals, dirty-state save bar, cross-section search | **Kit implemented** in `sadb-ui.tsx` and applied across the `/admin/*` estate (2026-08-15); the `/settings` surface itself (Phase 6) remains open |

> **Execution status (2026-08-15):** Phases 0–5 are DONE — all 15 `/admin/*`
> pages migrated to `sadb-ui`, legacy control-center/detail CSS (~1,235
> lines) deleted, `window.prompt`/`confirm` eliminated, every rail `?tab=`
> deep-linkable, dirty-state saves on security/config, checks green
> (tsc, eslint, color-tokens + rbac suites, 16-route browser sweep).
> Phase 6 (the `/settings` super-admin surface) is the remaining step.

Every colour in both designs already exists as a token (`--accent-primary`
= the design navy #144972, slate ramp for ink/borders, success-800 /
warning-700 / danger-500·800 for the tonal chips, `--brand-300/400`,
`--tb-blue-50` for the light blues). **Zero new colours are needed** —
`color-tokens.test.ts` polices this.

### The language in one paragraph

White cards, radius 8, 1px `--border-light` border, `0 1px 2px
rgba(14,42,74,0.05)` shadow, on the app canvas. Card titles are Barlow
Condensed 12px uppercase `0.08em`. Status is carried by tonal chips
(green / yellow / red / blue / neutral: tinted fill + tinted border +
text-rung ink, condensed uppercase 10.5px). Rows are hairline-ruled
(`#EDF2F7`), label 13px + sub 11.5px muted, value condensed tabular.
Actions are either the platform `btn btn-primary/secondary` (navy), a
condensed-uppercase head-link ("Billing ›"), or — from the Settings design —
per-row controls: editable-value button with pencil, toggle switch
(38×21, navy when on), or small uppercase outline action button.
Destructive operations live in a red-bordered "danger zone" card with an
"Audited" header and confirm modal. Empty states are honest sentences; the
column-header row stays rendered above them.

## 2. Scope

**In scope (the super-admin governance estate):**

- COMMAND: `/admin` ✅ · `/admin/risk` · `/admin/audit`
- TENANTS: `/admin/organizations` · `/admin/users` · `/admin/support`
- PLATFORM OPERATIONS: `/admin/system` · `/admin/sync` · `/admin/interop` · `/admin/data` · `/admin/conflicts` (non-nav)
- BUSINESS: `/admin/billing` · `/admin/analytics`
- GOVERNANCE: `/admin/security` · `/admin/config` · `/admin/flags`
- Settings surface: `/settings` super-admin variant (personal panels + the six System-administration sections + IT Operations) and the `/it` standalone host

**Out of scope (shared, multi-role surfaces — keep the app-wide look):**

- `/hospitals` and `/reports` serve government, org-admin, HRIO and more,
  and render identically for every role. They stay on the shared
  `card-elevated` + `EhrListHeader` list language. Restyling them would
  fork a shared surface for one role.
- The WORKSPACES nav entries (clinical dashboards) — clinical `ehr-*` design.
- `/admin/control` and `/system-admin` are redirects; leave as-is.

## 3. Phase 0 — the kit (do first)

Promote the dashboard's `sadb-*` CSS + the Settings design's patterns into a
reusable kit so pages 2–17 are assembly, not invention. One new file
`src/components/admin/sadb-ui.tsx` + CSS additions in the existing `sadb-*`
block of `globals.css`.

**Components (dashboard design, extract from `/admin/page.tsx`):**

| Component | From | Notes |
|---|---|---|
| `SadbPage` | `SaPage` | Keep its super_admin guard + `page-container page-enter sadb-scope` + optional actions row |
| `SadbCard` / `CardHead` | dashboard | title + meta + head-link/action slot |
| `SadbChip` | dashboard | 5 tones; also the `SEVERITY_TONE → chip` mapping |
| `SadbKvRow` | dashboard | label + (value \| chip) |
| `SadbQueueRow` | dashboard | chip? + title/sub + when? + chevron?, onClick |
| `SadbKpiTile` | dashboard | button/div variants, delta tones |
| `SadbSearch` | dashboard | `<label>` wrapper (uppercase-trap reset), icon + input |
| `SadbGridList` | dashboard tenant matrix | column-template grid list; **header row always rendered; empty message below it** |

**Components (Settings design, new):**

| Component | Purpose |
|---|---|
| `SadbShell` | Two-pane rail + panel. Grouped icon nav (condensed group titles, count badges, active = `--tb-blue-50` bg + `--brand-800` ink), scrolling panel `max-width: 920px`. **Owns `?tab=` URL state** — replaces all four existing rail implementations |
| `SadbPanelHeader` | Panel title (20px) + note + optional status tag chip |
| `SadbSettingRow` | The five row kinds: `editable` (value button + pencil → editor modal), `readonly` value, `chip`, `toggle` (38×21 switch), `action` (uppercase outline button). Card-group wrapper with tinted head (`--ehr-head` bg, 11.5px title, meta) |
| `SadbStatusCardGrid` | auto-fit minmax(250px,1fr) cards: name + dot-chip + detail + action link (for integrations/endpoints) |
| `SadbDangerZone` | Red-bordered card, "Audited" header, rows with red outline buttons → `SadbConfirmModal` |
| `SadbEditorModal` | Small centered value editor (label, sub, input, Cancel/Apply) |
| `SadbConfirmModal` | Red-top-border confirm for destructive ops. Copy says "written to the audit log" — **do not claim re-authentication until the backend enforces it** (the design's re-auth is a backend follow-up, tracked separately) |
| `SadbSaveBar` | Header dirty-state: "N unsaved changes" + Discard / Save vs "All changes saved" chip |

**Consolidations / deletions in the same phase:**

- Delete `SaStat` (zero call sites) and the orphaned CSS: `.sa-stat*`,
  `.sa-grid`, `.sa-col`, `.sa-risk-list`, `.sa-nav-chip`.
- Delete `SuperAdminControlCenter.tsx` (orphan) — **first** move its
  `DEFAULT_POLICIES` into a shared module that `/admin/security` imports,
  killing the hand-copied duplicate.
- Restyle `SaTable` in place to the design chrome (condensed uppercase
  10.5px headers, `#EDF2F7` row rules, `--color-slate-50` hover) — dense
  matrices (audit, flags) keep tables; list-like surfaces move to
  `SadbGridList`. Rule of thumb: grid list when ≤6 columns and the row is
  one clickable thing; table for dense scrollable data.
- Keep `classifyAuditRisk`, `formatWhen`, `SaSeverity` (move into sadb-ui;
  leave re-exports in sa-ui until the last importer migrates).
- Replace the literal hexes in the old `sa-*` CSS block and the `#fff` in
  the three styled-jsx rails as those pages migrate (the styled-jsx blocks
  are deleted outright by the `SadbShell` moves).

## 4. Page-by-page

Effort: **S** = chrome swap on an already-SaPage page (≤½ day),
**M** = layout rework or modal replacement, **L** = write-flow rework too.

### Phase 1 — COMMAND (pure reads, fastest wins)

| Page | Effort | Plan |
|---|---|---|
| `/admin/risk` | **S** | Already `SaPage` + `SaCard` + `EhrListHeader` + `SaTable`. Swap to `SadbPage`/`SadbCard`, severity pills → `SadbChip`, keep the 6-source derivation untouched. Rows stay click-to-navigate. |
| `/admin/audit` | **M** | Same chrome swap; the in-file `AuditEntryDialog` becomes a design modal (`SadbEditorModal` layout, read-only fields). Replace the imperative `onMouseEnter` hover with the CSS hover class. Keep: 4 filters, CSV export, the outgoing `/admin/users?q=` and `/patients/{id}` links. |

### Phase 2 — TENANTS (the CRUD pages)

| Page | Effort | Plan |
|---|---|---|
| `/admin/organizations` | **L** | Adopt `SadbPage` (it has none). List → `SadbGridList` (mirrors the dashboard's tenant matrix: name+sub, plan, facilities, users, status chip — same anatomy, so the dashboard and registry finally rhyme). The bespoke full-screen modal → design modal chrome (4 sections kept: basic / subscription / branding / flags-as-toggles). `confirm()` on deactivate → `SadbConfirmModal` danger pattern. Add toast on save failure (today: `console.error` only). |
| `/admin/users` | **L** | Largest page. Keep the shared worklist row language for the roster (`appointment-card-*` is the app-wide list surface — don't fork it), but wrap in sadb chrome: KPI strip → `SadbKpiTile` row, filters into the sadb head. The **four** hand-rolled overlay modals (add / credential hand-off / reset password / change role) → design modals; reset & deactivate get the danger confirm. Split the shared `showAddPassword` boolean; unify on `roleLabel()` (drop the duplicate `ROLE_LABELS`). **Must preserve `?q=` and `?new=1`** — `people-nav.test.ts` pins `?new=1`. |
| `/admin/support` | **M** | Third styled-jsx rail → `SadbShell` with `?tab=`. Tenants/users tabs → sadb list chrome; announcements compose form → design form rows; tickets stub stays an honest empty state. |

### Phase 3 — PLATFORM OPERATIONS

| Page | Effort | Plan |
|---|---|---|
| `/admin/system` | **S** | Chrome swap; DB-count table → `SadbGridList`; "System info" → `SadbKvRow` stack. |
| `/admin/sync` | **S/M** | Chrome swap; the three job runners → Settings-design action rows (label + sub + uppercase action button, running state disables the row's button). Keep the three POST endpoints and the `anyRunning` mutex. |
| `/admin/interop` | **M** | The endpoint inventory is the natural home of `SadbStatusCardGrid` (DHIS2 / country node / FHIR / webhooks as status cards — the design drew exactly this for integrations). Push-log + failed-push tables keep restyled `SaTable`; Retry batch stays. Honest "None registered" rows stay. |
| `/admin/data` | **M** | Second styled-jsx rail → `SadbShell` with `?tab=`. Lists → sadb chrome, caps honestly labelled on **both** tabs (completeness silently truncates today). Note in-code: the O(n²) duplicate expansion is a known scale limit — flag, don't fix here. |
| `/admin/conflicts` | **L** | Biggest UX-debt paydown. `admin-conflict-card`s → sadb card-group rows; **`window.prompt` (resolution note) → `SadbEditorModal`; `window.confirm` (dismiss) → `SadbConfirmModal`**. Keep the multi-role guard (this page is deliberately not super_admin-only) and the tablist — tabs become `?tab=`. Retire the `admin-detail-*`/`admin-conflict-*` CSS and the literal-rgba `RISK_STYLES` as part of the move. |

### Phase 4 — BUSINESS

| Page | Effort | Plan |
|---|---|---|
| `/admin/billing` | **M** | `DataTile` strip → `SadbKpiTile` row; table → restyled `SaTable` keeping inline row-edit (it works; restyle inputs, drop the data-URI select chevron for the shared `Select`). Add failure toasts. Decide: local search instead of global-app search binding (it currently leaks the query app-wide). |
| `/admin/analytics` | **M** | Keep Recharts + `ChartCard` internals (chart conventions hold) but sadb card chrome + condensed titles; KPI grids → `SadbKpiTile`. Fix the positional `orgData[i]` join (key by org id) and parallelise the sequential per-org `getStats` loop while touching. The simulated growth chart keeps its demo-mode gate and its "Simulated" label — or is dropped; decide at build time, never show it unlabelled. |

### Phase 5 — GOVERNANCE (the settings-like pages: Settings-design anatomy)

| Page | Effort | Plan |
|---|---|---|
| `/admin/security` | **L** | First styled-jsx rail → `SadbShell`. Toggle/number rows → `SadbSettingRow` (toggle/editable kinds). **Adopt the design's dirty-state model via `SadbSaveBar`** — today every keystroke writes immediately with no error handling; batch to Save/Discard with toasts. Import the consolidated `DEFAULT_POLICIES`. Derive the rail count badges (they're hard-coded literals today). |
| `/admin/config` | **M** | `ehr-set-*` rail → `SadbShell` with `?tab=` (deep links + back-button, missing today). Unify the save model with the save bar (today: two dirty forms + one instant toggle). Add a dirty-guard so a config refresh can't clobber edits. **Resolve dual ownership of `maintenanceMode`: config owns it; flags links here.** |
| `/admin/flags` | **M** | Global toggles → `SadbSettingRow` toggles; the per-tenant × 6-flag matrix keeps a restyled `SaTable` with design toggle switches in cells. Immediate writes stay (a matrix wants instant feedback) but each cell gets rollback-on-failure. Remove the duplicated maintenance toggle (see config). |

### Phase 6 — the Settings surface (the second design file, literally)

| Surface | Effort | Plan |
|---|---|---|
| `/settings` (super-admin variant) | **L** | `Super Admin Settings.dc.html` **is** this page. `RoleSettingsView` already has the right architecture (rail groups, one panel, `?panel=` deep links, panel stack). Restyle `ehr-set-*` rendering to the design: grouped icon rail with count badges, panel header + note, `SadbSettingRow` kinds, editor modal, save-state header. Add the design's **cross-section search** (grouped results with "Open section ›" — the search logic pattern is in the design's script). |
| System-administration sections | **M** | `SystemAdminSections.tsx` (apps / extensions / privileges / patientActions / metadata / properties) maps one-to-one onto the design's "System administration" nav group. Restyle `sysadm-*` rows to `SadbSettingRow`; its editor modal → `SadbEditorModal`. Counts already computed — they feed the rail badges. |
| IT Operations (`/it` + embedded) | **M** | `ItOperationsPanel` rows → Settings-design action rows with status chips ("Run now" pattern is drawn in the design's itops panel). Both hosts (standalone `/it`, Settings embed) get it automatically. |
| Restricted actions panel | **M** | The design's danger panel, populated **only with operations that really exist**: suspend a tenant (routes into the organizations deactivate flow), audit-evidence export. No invented merge tools or export approvals — honesty rule. Grows as real operations land. |

## 5. Invariants (every page, every phase)

1. **Real data only.** No fabricated counts, no decorative controls. If a
   thing isn't measured, the UI says so ("Nothing has reported a backup").
2. **Tokens only.** New CSS reads the ramp in `globals.css`;
   `color-tokens.test.ts` is the gate. The design's hexes all exist already.
3. **Empty lists keep their header row**; the message sits below it.
4. **Every rail/tab gets URL state** (`?tab=` / `?panel=`) — no more
   local-only section state.
5. **No `window.confirm`/`prompt`/`alert`** — design modals, always.
6. **Pinned deep links keep working:** `/admin/users?q=` and `?new=1`
   (test-pinned), `/settings?panel=`, `/hospitals?facility=`,
   audit-dialog outbound links.
7. **Guards unchanged:** `SadbPage` keeps the super_admin guard;
   `/admin/conflicts` keeps its multi-role list.
8. **Write flows never lose data silently:** every mutation gets a toast on
   failure; batched forms get dirty-state Save/Discard.
9. Labels stay honest about caps ("up to 50 of N").

## 6. Order, verification, estimates

Build order = phase order above: kit → COMMAND → TENANTS → PLATFORM OPS →
BUSINESS → GOVERNANCE → Settings. Each phase is a mergeable unit; the area
is allowed to be visually mixed between phases (the dashboard already is).

Per phase: `tsc --noEmit`, eslint on touched files, `jest` (route/token
tests are the only automated coverage — **there are no component tests for
any of these pages**, so browser verification via the `/verify` recipe is
the real gate: log in as `superadmin`, drive each changed page, screenshot,
exercise one write flow per page against the local store).

Rough sizing: Phase 0 ≈ 1–1.5 days; Phases 1+3 ≈ 1.5 days combined;
Phase 2 ≈ 2–2.5 days; Phases 4+5 ≈ 2 days; Phase 6 ≈ 2 days.
**Total ≈ 9–10 focused days.**

## 7. Decisions taken (so nobody re-litigates them mid-build)

- Recharts stays for all charts (chart-conventions rules apply; the
  dashboard already renders the design's chart with it).
- `/admin/users` keeps the shared worklist row surface — the design
  language wraps it; it does not fork it.
- `/hospitals` and `/reports` are explicitly not restyled (shared pages).
- "Re-authenticate & continue" copy is **deferred** until real re-auth
  exists; until then the confirm modal says "written to the audit log".
- `maintenanceMode` gets one owner: `/admin/config`.
- The old `sa-*` CSS block shrinks as pages migrate and is deleted at the
  end of Phase 5 along with `sa-ui.tsx` re-exports.
