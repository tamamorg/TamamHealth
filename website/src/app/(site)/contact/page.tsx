import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description: "Facility, NGO, funder, or just curious — tell us what you're building or how you want to help. We answer every message.",
};

export default function ContactPage() {
  return (
    <main>
      <section id="contact" style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "74px 32px 46px" }}>
        <div className="tm-contact-hero" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 64, alignItems: "end" }}>
          <div>
            <h1 style={{ fontSize: "clamp(31px, 5.2vw, 56px)", margin: "0 0 16px", color: "#FFFFFF" }}>The problem is enormous. The fix is buildable.</h1>
            <p style={{ margin: 0, maxWidth: 620, fontSize: 16.5, lineHeight: 1.7, color: "rgba(255,255,255,0.82)" }}>
              Facility, NGO, funder, or just curious — tell us what you&rsquo;re building or how you want to help. We answer every message.
            </p>
            <span className="tm-rule-sm" style={{ display: "block", width: 300, maxWidth: "60vw", height: 3, background: "#7FC4EA", marginTop: 26 }} />
          </div>
        </div>
      </section>
      <section style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "0 32px 92px" }}>
        {/* The design left-aligns the 860px form under the heading; the outer
            1320 container keeps it on the same gutter as the hero at every
            viewport width. */}
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div className="tm-contact-body" style={{ maxWidth: 860 }}>
            <ContactForm />
          </div>
        </div>
      </section>
    </main>
  );
}
