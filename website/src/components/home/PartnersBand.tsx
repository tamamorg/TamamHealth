/* "Working with": the organisations TamamHealth works with today, each with
   its role. Partner marks are shown as the partners publish them, on white,
   never recoloured; Tufts is set as text (its marks need permission). */

import Image from "next/image";
import Link from "next/link";
import Corners from "@/components/Corners";
import { getTranslator } from "@/lib/i18n/server";

export default async function PartnersBand() {
  const { t } = await getTranslator();
  const partners = [
    { name: "Iteru Medical Center", role: t("Testing partner, Juba"), href: "/news/iteru-medical-center-testing", logo: { src: "/assets/partners/iteru-medical-center-logo.jpg", alt: t("Iteru Medical Center logo") } },
    { name: "Elimisha Kakuma", role: t("Fiscal sponsor, 501(c)(3)"), href: "/news/elimisha-kakuma-fiscal-sponsor", logo: { src: "/assets/partners/elimisha-kakuma-logo.png", alt: t("Elimisha Kakuma logo, a tree") } },
    { name: "Tufts University", role: t("Founding university"), href: "/news/tufts-new-ventures-competition", logo: null },
  ];
  return (
    <section id="partners" style={{ padding: "60px 32px 64px", background: "#FFFFFF", borderTop: "1px solid var(--color-divider)" }}>
      <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "260px 1fr", gap: 40, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{t("Working with")}</span>
          <h2 style={{ fontSize: "clamp(22px, 2.6vw, 30px)", margin: 0 }}>{t("Partners and supporters")}</h2>
        </div>
        <div className="tm-g3 tm-partners" style={{ gap: 18 }}>
          {partners.map((p) => (
            <Link key={p.name} href={p.href} className="blueprint tm-partner" style={{ position: "relative", display: "flex", alignItems: "center", gap: 18, padding: "16px 20px", background: "#FFFFFF", textDecoration: "none" }}>
              <Corners />
              <span className="tm-partner-mark">
                {p.logo ? (
                  <Image src={p.logo.src} alt={p.logo.alt} fill sizes="72px" style={{ objectFit: "contain" }} />
                ) : (
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 18, lineHeight: 1, color: "#3e8ede", textAlign: "center" }}>Tufts</span>
                )}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, color: "var(--color-text)" }}>{p.name}</span>
                <span style={{ fontSize: 13.5, color: "var(--color-neutral-700)" }}>{p.role}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
