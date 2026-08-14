import Link from "next/link";
import Corners from "@/components/Corners";
import HeroShowcase from "@/components/home/HeroShowcase";
import ProductsBand from "@/components/home/ProductsBand";
import Footprint from "@/components/home/Footprint";

export default function HomePage() {
  return (
    <main id="top">
      <HeroShowcase />
      <ProductsBand />
      <Footprint />

      {/* About split */}
      <section style={{ padding: "24px 32px 100px", background: "#FFFFFF" }}>
        <div className="blueprint tm-about-card" style={{ maxWidth: 1320, margin: "0 auto", position: "relative", background: "#0E2A4A", borderColor: "rgba(255,255,255,0.22)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, alignItems: "stretch" }}>
          <Corners light />
          <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "60px 56px 62px" }}>
            <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0, color: "#FFFFFF" }}>The problem is enormous. The fix is buildable.</h2>
            <span style={{ width: 100, height: 3, background: "#7FC4EA" }} />
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: "rgba(255,255,255,0.82)" }}>
              Facility, NGO, funder, or just curious — tell us what you&rsquo;re building or how you want to help. Founded at Tufts
              University · starting in South Sudan, built for sub-Saharan Africa.
            </p>
            <Link href="/about" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18, color: "#7FC4EA", textDecoration: "none" }}>
              About Tamam &nbsp;›
            </Link>
          </div>
          <div className="tm-about-fig" style={{ position: "relative", minHeight: 420 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- card figure, sized by CSS */}
            <img src="/assets/african-nurse.jpg" alt="Health worker helping a patient access their records on a phone" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
      </section>
    </main>
  );
}
