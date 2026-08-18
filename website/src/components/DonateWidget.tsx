"use client";

/* Donate: tier picker + "Your gift" card. Same Web3Forms deviation as the
   contact form — the design's send only flipped state; a pledge here actually
   emails the team, who reply with payment details (as the card promises). */

import { useState } from "react";
import Corners from "@/components/Corners";
import { DONATION_TIERS as DONATION_TIERS_EN, WEB3FORMS_ACCESS_KEY } from "@/lib/site-data";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function DonateWidget() {
  const { t, content } = useLanguage();
  const DONATION_TIERS = content(DONATION_TIERS_EN);
  const [tier, setTier] = useState(1);
  const [freq, setFreq] = useState<"one-time" | "monthly">("one-time");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const activeTier = DONATION_TIERS[tier];
  // One template per case rather than a suffix glued on: Arabic does not put
  // "a month" after the amount, and a concatenated fragment cannot move.
  const summary = freq === "monthly"
    ? t("{{amount}} a month", { amount: activeTier.amount })
    : t("{{amount}} once", { amount: activeTier.amount });

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "sending" || state === "sent") return;
    const form = e.currentTarget;
    const data = new FormData(form);
    setState("sending");
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: `TamamHealth donation pledge — ${summary}`,
          from_name: "tamamhealth.org donate form",
          name: data.get("name"),
          email: data.get("email"),
          clinic: data.get("clinic"),
          tier: `${activeTier.amount} — ${activeTier.label}`,
          frequency: freq,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success !== false) {
        setState("sent");
        form.reset();
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  };

  return (
    <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 56, alignItems: "start" }}>
      <div>
        <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: "0 0 8px" }}>{t("Choose what your gift buys")}</h2>
        <p style={{ margin: "0 0 28px", fontSize: 15.5, lineHeight: 1.65, color: "var(--color-neutral-800)", maxWidth: 620 }}>
          {t("Each tier is a real line item in the pilot budget, not a suggested band. Pick one and we will tell you which facility it landed in.")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {DONATION_TIERS.map((x, i) => (
            <button
              key={x.amount}
              onClick={() => setTier(i)}
              className="blueprint tm-tier"
              aria-pressed={i === tier}
              style={{
                appearance: "none", cursor: "pointer", textAlign: "start", font: "inherit",
                padding: "20px 24px",
                background: i === tier ? "rgba(1,86,151,0.08)" : "transparent",
                border: `${i === tier ? "2px" : "1px"} solid ${i === tier ? x.accent : "var(--color-divider)"}`,
                display: "grid", gridTemplateColumns: "132px 1fr", gap: 24, alignItems: "center",
              }}
            >
              <Corners />
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(24px, 2.6vw, 32px)", lineHeight: 1, color: x.accent }}>{x.amount}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18 }}>{x.label}</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--color-neutral-700)" }}>{x.note}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit} className="blueprint" style={{ background: "var(--color-surface)", padding: "30px 32px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
        <Corners />
        <h3 style={{ fontSize: 26, margin: 0 }}>{t("Your gift")}</h3>
        <div style={{ display: "flex", border: "1px solid var(--color-divider)" }}>
          {(["one-time", "monthly"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFreq(f)}
              aria-pressed={freq === f}
              style={{
                appearance: "none", cursor: "pointer", flex: 1,
                fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 15, padding: "11px 0", border: 0,
                background: freq === f ? "#015697" : "transparent",
                color: freq === f ? "#FFFFFF" : "var(--color-neutral-800)",
              }}
            >
              {f === "one-time" ? t("One-time") : t("Monthly")}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "14px 0", borderTop: "1px solid var(--color-divider)", borderBottom: "1px solid var(--color-divider)" }}>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(24px, 3.4vw, 38px)", lineHeight: 1, color: "#015697" }}>{summary}</span>
        </div>
        <span style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{activeTier.note}</span>
        <div className="field">
          <label htmlFor="dn-name">{t("Name")}</label>
          <input id="dn-name" name="name" required className="input" placeholder={t("Your name")} style={{ background: "#FFFFFF" }} />
        </div>
        <div className="field">
          <label htmlFor="dn-email">{t("Email")}</label>
          <input id="dn-email" name="email" type="email" required className="input" placeholder={t("you@example.com")} style={{ background: "#FFFFFF" }} />
        </div>
        <div className="field">
          <label htmlFor="dn-clinic">{t("Fund a specific clinic (optional)")}</label>
          <input id="dn-clinic" name="clinic" className="input" placeholder={t("Facility or state")} style={{ background: "#FFFFFF" }} />
        </div>
        <button type="submit" disabled={state === "sending" || state === "sent"} className="btn btn-primary blueprint" style={{ padding: "14px 0", fontSize: 15.5, color: "#0E2A4A", width: "100%" }}>
          {state === "sent" ? t("Message sent ✓") : state === "sending" ? t("Sending…") : t("Send message")}
          <Corners />
        </button>
        {state === "error" && (
          <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "#B3261E" }}>
            {t("Something went wrong sending that — please email support.tamam@gmail.com directly.")}
          </span>
        )}
        <span className="fs125" style={{ lineHeight: 1.5, color: "var(--color-neutral-600)" }}>
          {t("Gifts are handled by the founding team at Tufts University. We reply within two working days with payment details and the facility your gift is assigned to.")}
        </span>
      </form>
    </div>
  );
}
