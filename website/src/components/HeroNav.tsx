"use client";

/** The mobile carousel control the design repeats under every desktop
 *  stepper pair: ‹ [dash per item, active in navy] ›. Hidden on desktop
 *  (base display:none), shown ≤760px via .tm-hero-nav in globals.css. */
export default function HeroNav({
  items,
  active,
  onPick,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  center,
  style,
}: {
  items: { key: string; label: string }[];
  active: number;
  onPick: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  /** Optional centre text replacing the dashes (footprint counter). */
  center?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  // Progress fill: solid up to and including the active item; the rest of the
  // track shows through as grey dashes behind it.
  const fillPct = items.length ? ((active + 1) / items.length) * 100 : 0;
  return (
    <section
      className="tm-hero-nav"
      // No surface block behind the bar — it sits on the page ground. 44px
      // rounded chevron boxes (soft on the left, brand orange on the right)
      // bracket a progress track, matching the design reference in the tamam
      // palette. `center` (the footprint counter) still replaces the track.
      style={{ display: "none", background: "transparent", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 0, ...style }}
    >
      <button
        type="button"
        onClick={onPrev}
        aria-label={prevLabel}
        style={{ width: 44, height: 44, flexShrink: 0, border: 0, background: "#C9F4FF", color: "#015697", cursor: "pointer", fontSize: 22, lineHeight: 1, display: "grid", placeItems: "center" }}
      >
        ‹
      </button>
      {center ? (
        center
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 4px" }}>
          <div style={{ position: "relative", width: "100%", height: 5 }}>
            {/* Remaining items — grey dashes across the whole track. */}
            <div
              aria-hidden="true"
              style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(90deg, var(--color-neutral-300) 0 18px, transparent 18px 30px)" }}
            />
            {/* Progress — one solid deep-blue bar up to the active item. */}
            <div
              aria-hidden="true"
              style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${fillPct}%`, background: "#015697", transition: "width 0.25s ease" }}
            />
            {/* Invisible per-item hit targets — keep tap-to-jump and the
                labelled buttons for assistive tech, over the visual track. */}
            <div style={{ position: "absolute", inset: 0, display: "flex" }}>
              {items.map((it, i) => (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => onPick(i)}
                  aria-label={it.label}
                  aria-current={i === active ? "true" : undefined}
                  style={{ flex: 1, minWidth: 0, height: "100%", padding: 0, border: 0, background: "transparent", cursor: "pointer" }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onNext}
        aria-label={nextLabel}
        style={{ width: 44, height: 44, flexShrink: 0, border: 0, background: "#015697", color: "#FFFFFF", cursor: "pointer", fontSize: 22, lineHeight: 1, display: "grid", placeItems: "center" }}
      >
        ›
      </button>
    </section>
  );
}
