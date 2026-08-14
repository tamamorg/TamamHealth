import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Corners from "@/components/Corners";
import { PRODUCTS, PRODUCT_DETAIL, productBySlug } from "@/lib/site-data";

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = productBySlug(slug);
  if (!p) return {};
  return { title: `${p.title} (${p.acronym})`, description: PRODUCT_DETAIL[p.acronym]?.intro ?? p.description };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const i = PRODUCTS.findIndex((x) => x.slug === slug);
  if (i === -1) notFound();
  const p = PRODUCTS[i];
  const d = PRODUCT_DETAIL[p.acronym];
  const prev = PRODUCTS[(i + PRODUCTS.length - 1) % PRODUCTS.length];
  const next = PRODUCTS[(i + 1) % PRODUCTS.length];

  return (
    <main>
      <section style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "30px 32px 74px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <Link href="/products" style={{ fontSize: 14, color: "#7FC4EA", textDecoration: "none", letterSpacing: "0.04em" }}>← All products</Link>
          <div className="tm-split" style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 48, alignItems: "center", marginTop: 26 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
              <h1 style={{ fontSize: "clamp(31px, 5vw, 54px)", margin: 0, color: "#FFFFFF" }}>{p.title}</h1>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7FC4EA" }}>{p.tagline}</span>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: "rgba(255,255,255,0.82)", maxWidth: 640 }}>{d.intro}</p>
              <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                <Link href="/contact" className="btn blueprint" style={{ padding: "14px 28px", fontSize: 15.5, whiteSpace: "nowrap", flexShrink: 0, background: "#FFFFFF", borderColor: "#FFFFFF", color: "#015697" }}>
                  Get in touch
                  <Corners />
                </Link>
                <Link href="/login" className="btn blueprint" style={{ padding: "14px 28px", fontSize: 15.5, whiteSpace: "nowrap", flexShrink: 0, background: "transparent", borderColor: "rgba(255,255,255,0.5)", color: "#FFFFFF" }}>
                  Log in
                  <Corners light />
                </Link>
              </div>
            </div>
            <div className="blueprint tm-figure" style={{ position: "relative", height: 320, borderColor: "rgba(255,255,255,0.28)" }}>
              <Corners light />
              {/* eslint-disable-next-line @next/next/no-img-element -- hero figure, sized by CSS */}
              <img src={p.image} alt={p.imageAlt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: "74px 32px 20px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20, paddingBottom: 18, borderBottom: "1px solid var(--color-divider)" }}>
            <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: 0 }}>{d.stepsTitle}</h2>
            <span className="fs125" style={{ letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>How it works</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
            {/* Native <details>, not a JS accordion: the page is server-rendered
                and these need no state. It also means the steps stay findable
                by in-page search and print expanded, which a div-and-useState
                version would break. Closed by default — the numbered titles are
                the summary of the day; the detail is there when wanted. */}
            {d.steps.map((s, k) => (
              <details key={s.t} className="tm-steprow" name="patient-day">
                <summary>
                  <span className="tm-stepnum">{String(k + 1).padStart(2, "0")}</span>
                  <h3>{s.t}</h3>
                  <span className="tm-stepchev" aria-hidden="true">+</span>
                </summary>
                <p>{s.b}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: "60px 32px 20px" }}>
        <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 44, alignItems: "start" }}>
          <div className="blueprint" style={{ padding: "30px 32px 32px", background: "#FFFFFF" }}>
            <Corners />
            <h3 style={{ fontSize: 21, margin: "0 0 6px" }}>{d.lifecycleTitle}</h3>
            <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>
              Statuses are a real state machine, not free text — every transition is stamped and audited.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {d.lifecycle.map((l) => (
                <span key={l} className="tag" style={{ color: "#FFFFFF", background: "#015697", fontFamily: "var(--font-body)" }}>{l}</span>
              ))}
            </div>
            <h3 style={{ fontSize: 21, margin: "30px 0 14px" }}>Who uses it</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {d.roles.map((r) => (
                <span key={r} className="tag tag-outline">{r}</span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, justifyContent: "flex-start", alignSelf: "start" }}>
            {d.safeguards.map((g) => (
              <div key={g.t} className="blueprint tm-guard" style={{ flex: "0 0 auto", padding: "18px 22px" }}>
                <Corners />
                <h4 style={{ fontSize: 17, margin: "0 0 6px" }}>{g.t}</h4>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{g.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: "56px 32px 40px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", margin: "0 0 22px", paddingBottom: 16, borderBottom: "1px solid var(--color-divider)" }}>What&rsquo;s inside</h2>
          <div className="tm-g4" style={{ gap: 14 }}>
            {p.modules.map((m) => (
              <div key={m} style={{ padding: "16px 18px", background: "var(--color-surface)", border: "1px solid var(--color-divider)", fontSize: 14.5, fontWeight: 600 }}>{m}</div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: "20px 32px 92px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, borderTop: "1px solid var(--color-divider)", paddingTop: 26, flexWrap: "wrap" }}>
          <Link href={`/products/${prev.slug}`} style={{ fontSize: 15, color: "#015697", textDecoration: "none" }}>← {prev.title}</Link>
          <Link href="/products" style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-600)", textDecoration: "none" }}>All products</Link>
          <Link href={`/products/${next.slug}`} style={{ fontSize: 15, color: "#015697", textDecoration: "none" }}>{next.title} →</Link>
        </div>
      </section>
    </main>
  );
}
