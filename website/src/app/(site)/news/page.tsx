import type { Metadata } from "next";
import NewsExplorer from "@/components/NewsExplorer";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "News & updates",
  description:
    "What TamamHealth is building and where the work has landed — starting with second place in the Healthcare & Life Science track at the Tufts New Ventures Competition.",
};

export default async function NewsPage() {
  const { t, content } = await getTranslator();
  return (
    <main>
      {/* Intro band */}
      <section style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "70px 32px 76px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <h1 style={{ fontSize: "clamp(30px, 4.6vw, 50px)", margin: 0, color: "#FFFFFF" }}>{t("News & updates")}</h1>
          <span style={{ width: 100, height: 3, background: "#7FC4EA" }} />
          <p style={{ margin: 0, maxWidth: 680, fontSize: 16.5, lineHeight: 1.7, color: "rgba(255,255,255,0.84)" }}>
            {t("What we have built, where it has been recognised, and where the work is going — on the way to the 10-clinic pilot in Juba and greater South Sudan.")}
          </p>
        </div>
      </section>

      <NewsExplorer />
    </main>
  );
}
