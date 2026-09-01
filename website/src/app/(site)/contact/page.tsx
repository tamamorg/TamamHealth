import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import { getTranslator } from "@/lib/i18n/server";
import { CONTACT_POINTS } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "Get in touch",
  description: "Facility, NGO, funder, or just curious: tell us what you're building or how you want to help. We answer every message.",
};

function Check() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7CC7FF" strokeWidth="1.5" strokeLinecap="square" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" />
      <path d="M7.5 12.2l3.1 3.1L16.8 9" />
    </svg>
  );
}

export default async function ContactPage() {
  const { t, content } = await getTranslator();
  return (
    <main>
      {/* The form sits inside the hero rather than below it: the page has one
          job, so the ask and the reasons for it share a screen. */}
      <section id="contact" style={{ background: "#113055", color: "#FFFFFF", padding: "76px 32px 84px" }}>
        <div className="tm-contact-hero" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 72, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 30, paddingTop: 12 }}>
            <h1 style={{ fontSize: "clamp(34px, 5.4vw, 62px)", lineHeight: 1.04, margin: 0, color: "#FFFFFF", textWrap: "pretty" }}>
              {t("Get in touch")}
            </h1>
            <p style={{ margin: 0, maxWidth: 560, fontSize: 17.5, lineHeight: 1.6, color: "rgba(255,255,255,0.82)" }}>
              {t("Facility, NGO, funder, or just curious: tell us what you’re building or how you want to help. We answer every message.")}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 6 }}>
              {CONTACT_POINTS.map((point) => (
                <div key={point} style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <Check />
                  <span style={{ fontSize: 16.5, lineHeight: 1.5, color: "rgba(255,255,255,0.9)" }}>{t(point)}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, paddingTop: 22, borderTop: "1px solid rgba(255,255,255,0.22)" }}>
              <span style={{ fontSize: 11.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "#7CC7FF" }}>{t("Who answers")}</span>
              <p style={{ margin: 0, maxWidth: 540, fontSize: 15.5, lineHeight: 1.6, color: "rgba(255,255,255,0.78)" }}>
                {t("The founding team, within two working days. If you would rather see it before you write, ask for a demo and we will walk a full patient day end to end.")}
              </p>
            </div>
          </div>

          <ContactForm />
        </div>
      </section>
    </main>
  );
}
