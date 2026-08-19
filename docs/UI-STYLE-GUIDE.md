# UI Style Guide — the shared clinical-workspace standard

Every sidebar page should look consistent: a shared list/page header, clean `dash-card`
sections with icon headers, tidy KPI numbers, pill chips, and even spacing. The look is
built almost entirely from existing shared classes/components — use them, don't invent
new ones. **Presentation only: never change data fetching, handlers, routes, or
business logic.**

## 1. Page wrapper

The persistent shell — top rail, module nav, `RoleGuard` — is already provided by
`src/app/(dashboard)/layout.tsx` (`<EhrTopRail />` plus a `<MobileAppShell>` swap on
small viewports). Individual pages don't render a top bar themselves; each page's own
top-level element is just:

```tsx
<main className="page-container page-enter"> … </main>
```

`page-container` is the scrollable page body (padding, `overflow-y: auto`); `page-enter`
gives the mount fade/slide-up. This pair is the near-universal outer wrapper — used on
60+ pages. There is no `<TopBar>` component.

## 2. Page header — the shared list header

Replace any ad-hoc `<h1>`/custom header block with `EhrListHeader`
(`@/components/ehr/EhrListHeader`), the pattern extracted from the patients registry so
every module presents the same shape: title (left), stat dot-chips (right), then a
search + actions row. It's imported by 35+ dashboard pages today — the default choice
for a new page:

```tsx
import { EhrListHeader, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';

<EhrListHeader
  title="Blood units"
  stats={[
    { label: 'Units', value: unitStats.total, color: LIST_STAT_COLORS.muted },
    { label: 'Available', value: unitStats.available, color: LIST_STAT_COLORS.blue },
  ]}
  search={{ value: query, onChange: setQuery, placeholder: 'Search…' }}
  actions={<button className="btn btn-primary">…</button>}
/>
```

A handful of pages (e.g. billing) use their own bespoke header markup with a scoped CSS
namespace instead — if a page already does this cleanly and consistently, leave it;
don't force `EhrListHeader` onto it.

## 3. KPI tiles (when a page leads with numbers)

There's no dedicated KPI-tile component — pages that lead with numbers build a row of
`dash-card` tiles from the same primitives used everywhere else:

```tsx
<div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
  <button className="dash-card text-left" style={{ padding: '14px 16px' }}>
    <div className="flex items-center gap-2 mb-2">
      <div className="icon-box-sm">
        <Icon className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
      </div>
      <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Label</span>
    </div>
    <div className="stat-value text-3xl" style={{ color: 'var(--text-primary)', lineHeight: 1, fontWeight: 800 }}>{value}</div>
    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>sub-label</div>
  </button>
  …
</div>
```

Or fold the numbers into `EhrListHeader`'s `stats` prop instead — pick one, not both.
(`kpi-card-title` exists in `globals.css` but is only used on one page today; it's not a
convention to reach for — plain `text-xs font-semibold` labels, as above, are what most
tile rows actually use.)

## 4. Content sections — `dash-card` with an icon header

```tsx
<div className="dash-card overflow-hidden">
  <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
      <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Section title</h3>
    </div>
    {/* optional right link */}
  </div>
  <div className="p-4"> … body … </div>
</div>
```

For tables, set the card body padding to `0`, keep the header row above, and use a
sticky `thead` with `text-[10px] font-semibold uppercase tracking-wider` muted cells
on `var(--bg-card-solid)`.

## 5. Chips / pills (e.g. role counts, status tags)

Never bare text. Use pills:

```tsx
<span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
  style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
  Label · 3
</span>
```

Render them in a `flex flex-wrap gap-2`.

## 6. Tabs

`FilterTabs` (`@/components/filters` or `@/components/FilterTabs`) is the shared
segmented-tab control (`{ tabs: {key,label,count?,icon?,tint?}[], active, onChange }`),
styled active = accent fill, inactive = subtle bg + border. Adoption today is light —
most pages still drive tabs from local `activeTab` state with plain buttons. Prefer
`FilterTabs` for new tabbed pages over another one-off implementation, but don't churn
an existing page's working tab markup just to swap it in.

## 7. Empty states

Use the shared `EmptyState` component (`@/components/EmptyState`, used on 20+ pages)
rather than hand-rolling the centered icon/message block:

```tsx
<EmptyState
  icon={SomeIcon}
  title="No items yet"
  message="One short line of context."
  action={{ label: 'Reset filters', onClick: clear }}   // optional
/>
```

## 8. Spacing & tokens

- Major blocks: `gap-4` / `mb-4`. Tile rows + chips: `gap-2.5` / `gap-2`.
- Colors: only theme tokens `var(--…)` (and the existing accent palette already in use). No new hex.
- Icons: import from `@/components/icons/lucide` (a local shim), never `lucide-react` directly.

## Rules

- Reuse: `EhrListHeader`, `FilterBar`/`FilterTabs`/`SearchInput` (`@/components/filters`),
  `EmptyState`, `Modal`, `PrintListDialog`, `PatientName`, `dash-card`, `card-elevated`,
  `icon-box-sm`, `stat-value`, `data-row`.
- If a page already cleanly uses `EhrListHeader` + `dash-card`/`card-elevated` and looks
  consistent, leave it — don't churn.
- No new dependencies, no logic changes, keep all functionality. Verify with
  `npx tsc --noEmit -p tsconfig.json` (0 errors) on touched files — it's the reliable
  gate; the eslint flat-config is not.
