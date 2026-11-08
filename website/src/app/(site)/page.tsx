import Link from "next/link";
import Image from "next/image";
import Corners from "@/components/Corners";
import { getTranslator } from "@/lib/i18n/server";
import HeroShowcase from "@/components/home/HeroShowcase";
import ProductsBand from "@/components/home/ProductsBand";
import Footprint from "@/components/home/Footprint";
import NewsBand from "@/components/home/NewsBand";

export default async function HomePage() {
  const { t, content } = await getTranslator();
  return (
    <main id="top">
      <HeroShowcase />
      <ProductsBand />
      <Footprint />
      <NewsBand />

      {/* About split */}
      <section style={{ padding: "24px 32px 100px", background: "#FFFFFF" }}>
        <div className="blueprint tm-about-card" style={{ maxWidth: 1320, margin: "0 auto", position: "relative", background: "#113055", borderColor: "rgba(255,255,255,0.22)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, alignItems: "stretch" }}>
          <Corners light />
          <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "60px 56px 62px" }}>
            <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0, color: "#FFFFFF" }}>{t("The problem is enormous. The fix is here.")}</h2>
            <span style={{ width: 100, height: 3, background: "#7CC7FF" }} />
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: "rgba(255,255,255,0.82)" }}>
              {t("We are on a mission to digitize healthcare in South Sudan, with offline-first health records that work wherever care is delivered and with sub-Saharan Africa in view. TamamHealth is a nonprofit organization founded at Tufts University. We welcome inquiries from health facilities, NGOs and funders.")}
            </p>
            <Link href="/about" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18, color: "#7CC7FF", textDecoration: "none" }}>
              {t("Who we are  ›")}
            </Link>
          </div>
          <div className="tm-about-fig" style={{ position: "relative", minHeight: 420 }}>
            <Image
              src="/assets/african-nurse.jpg"
              alt={t("Health worker helping a patient access their records on a phone")}
              fill
              sizes="(max-width: 760px) 100vw, 50vw"
              style={{ objectFit: "cover" }}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
