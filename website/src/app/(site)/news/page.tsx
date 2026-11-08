import type { Metadata } from "next";
import NewsExplorer from "@/components/NewsExplorer";
import SubscribeBand from "@/components/SubscribeBand";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "News & updates",
  description:
    "News and announcements from TamamHealth, including platform testing at Iteru Medical Center, fiscal sponsorship by Elimisha Kakuma, incorporation in Massachusetts, and the Tufts New Ventures Competition.",
};

export default async function NewsPage() {
  const { t, content } = await getTranslator();
  return (
    <main>
      {/* Intro band */}
      <section style={{ background: "#113055", color: "#FFFFFF", padding: "70px 32px 76px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <h1 style={{ fontSize: "clamp(30px, 4.6vw, 50px)", margin: 0, color: "#FFFFFF" }}>{t("News & updates")}</h1>
          <span style={{ width: 100, height: 3, background: "#7CC7FF" }} />
          <p style={{ margin: 0, maxWidth: 680, fontSize: 16.5, lineHeight: 1.7, color: "rgba(255,255,255,0.84)" }}>
            {t("Announcements on the development of TamamHealth, its recognition and its progress towards the 10-clinic pilot in Juba and greater South Sudan.")}
          </p>
        </div>
      </section>

      <NewsExplorer />

      <SubscribeBand />
    </main>
  );
}
