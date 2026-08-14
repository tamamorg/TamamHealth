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
  return (
    <section
      className="tm-hero-nav"
      style={{ display: "none", background: "var(--color-surface)", alignItems: "stretch", justifyContent: "space-between", gap: 0, padding: 0, ...style }}
    >
      <button
        type="button"
        onClick={onPrev}
        aria-label={prevLabel}
        style={{ width: 62, height: 58, flexShrink: 0, border: 0, background: "#CCDDEA", color: "#015697", cursor: "pointer", fontSize: 22, lineHeight: 1 }}
      >
        ‹
      </button>
      {center ? (
        center
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "0 18px" }}>
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              onClick={() => onPick(i)}
              aria-label={it.label}
              style={{ flex: 1, height: 44, padding: 0, border: 0, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center" }}
            >
              <span style={{ display: "block", width: "100%", height: 4, background: i === active ? "#015697" : "var(--color-neutral-300)" }} />
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onNext}
        aria-label={nextLabel}
        style={{ width: 62, height: 58, flexShrink: 0, border: 0, background: "#015697", color: "#FFFFFF", cursor: "pointer", fontSize: 22, lineHeight: 1 }}
      >
        ›
      </button>
    </section>
  );
}
