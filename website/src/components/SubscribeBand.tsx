"use client";

/* News sign-up — one email field and a Subscribe button, in the navy band
   that closes /news and every article.

   There is no mailing-list service behind the site, so a sign-up travels the
   same road as the contact and donate forms: browser-side to Web3Forms, which
   mails it to the support inbox (the access key only routes mail; it is
   public by design). The list is kept from that inbox, which is why the
   note under the field says a reply is how you leave it. */

import { useState } from "react";
import Corners from "@/components/Corners";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { WEB3FORMS_ACCESS_KEY } from "@/lib/site-data";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SubscribeBand() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "invalid">("idle");

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "sending" || state === "sent") return;
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setState("invalid");
      return;
    }
    const data = new FormData(e.currentTarget);
    setState("sending");
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        signal: AbortSignal.timeout(20000),
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: "TamamHealth website: news subscription",
          from_name: "tamamhealth.org news sign-up",
          email: address,
          replyto: address,
          botcheck: data.get("botcheck") === "on",
          message: `Add ${address} to the TamamHealth news list.`,
          page: typeof window !== "undefined" ? window.location.pathname : "",
        }),
      });
      const body = await res.json().catch(() => ({}));
      setState(res.ok && body.success === true ? "sent" : "error");
    } catch {
      setState("error");
    }
  };

  const ink = "#FFFFFF";
  const soft = "rgba(255,255,255,0.8)";

  const form =
    state === "sent" ? (
      <div role="status" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 22, color: ink }}>{t("Thank you for subscribing.")}</span>
        <span style={{ fontSize: 15, lineHeight: 1.6, color: soft }}>{t("Updates will be sent to {{email}}.", { email: email.trim() })}</span>
      </div>
    ) : (
      <form onSubmit={onSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input type="checkbox" name="botcheck" tabIndex={-1} aria-hidden="true" style={{ display: "none" }} />
        <div className="tm-subscribe-row" style={{ display: "flex", gap: 10 }}>
          <input
            type="email"
            autoComplete="email"
            aria-label={t("Email address")}
            aria-invalid={state === "invalid"}
            placeholder={t("Email address")}
            className="tm-cfield"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === "invalid" || state === "error") setState("idle");
            }}
            style={{
              flex: 1,
              minWidth: 0,
              boxSizing: "border-box",
              padding: "15px 16px",
              fontFamily: "var(--font-body)",
              fontSize: 15.5,
              color: "var(--color-text)",
              background: "#FFFFFF",
              border: "1px solid rgba(255,255,255,0.4)",
              borderRadius: 0,
              outlineOffset: 2,
            }}
          />
          {/* The site's primary: amber on navy ink, as on the contact form. */}
          <button
            type="submit"
            disabled={state === "sending"}
            style={{
              appearance: "none",
              cursor: state === "sending" ? "wait" : "pointer",
              flexShrink: 0,
              fontFamily: "var(--font-heading)",
              fontWeight: 600,
              fontSize: 17,
              letterSpacing: "0.02em",
              padding: "0 30px",
              minHeight: 52,
              background: "#ff7f00",
              border: "1px solid #ff7f00",
              borderRadius: 0,
              color: "#113055",
            }}
          >
            {state === "sending" ? t("Subscribing…") : t("Subscribe")}
          </button>
        </div>
        <span role="status" aria-live="polite" className="fs125" style={{ lineHeight: 1.55, color: state === "invalid" || state === "error" ? "#FFD08A" : soft }}>
          {state === "invalid"
            ? t("Please enter a valid email address.")
            : state === "error"
              ? t("Your subscription could not be submitted. Please try again or contact support.tamam@gmail.com.")
              : t("We send updates only when there is news to share. To unsubscribe, reply to any message.")}
        </span>
      </form>
    );

  return (
    <section id="subscribe" style={{ background: "#113055", color: "#FFFFFF", padding: "64px 32px 68px" }}>
      <div
        className="blueprint tm-split"
        style={{ position: "relative", maxWidth: 1320, margin: "0 auto", borderColor: "rgba(255,255,255,0.28)", padding: "42px 46px", display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 44, alignItems: "center" }}
      >
        <Corners light />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#7CC7FF", fontWeight: 700 }}>{t("Newsletter")}</span>
          <h2 style={{ margin: 0, fontSize: "clamp(26px, 3.4vw, 38px)", color: "#FFFFFF" }}>{t("Subscribe to TamamHealth news")}</h2>
          <p style={{ margin: 0, maxWidth: 520, fontSize: 16, lineHeight: 1.7, color: "rgba(255,255,255,0.82)" }}>
            {t("Receive announcements on partnerships, platform testing and deployment by email.")}
          </p>
        </div>
        {form}
      </div>
    </section>
  );
}
