/**
 * `TimeGrid` is the grid react-big-calendar builds its own week and day views
 * from. It is exported from the package's `lib/` only — the published types
 * stop at the public entry point — so the appointments module's two-day view
 * declares it here rather than reaching for `any` at the call site.
 */
declare module 'react-big-calendar/lib/TimeGrid' {
  import type { ComponentType } from 'react';

  const TimeGrid: ComponentType<Record<string, unknown>>;
  export default TimeGrid;
}
