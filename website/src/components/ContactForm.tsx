"use client";

/* The demo-request form: a white blueprint card on the navy hero, asked in two
   steps — who you are, then where you work — with a progress bar between them.
   Splitting it is the point: four plain details first, so the page opens with
   something anyone can answer, and the setting questions only appear once the
   visitor has committed.

   Deviation from the design source (the same one the previous revision made):
   the design's send button only flips local state, so real submissions go
   through Web3Forms — browser-side by design, the access key only routes mail. */

import { useState } from "react";
import Corners from "@/components/Corners";
import { WEB3FORMS_ACCESS_KEY } from "@/lib/site-data";

const SUBJECTS = ["What is this about?", "Book a demo", "Deploy Tamam in a facility", "Fund the pilot", "Partner or integrate", "Something else"];

/** The Ministry's six tiers, plus the answer for everyone who isn't a facility. */
const LEVELS = [
  "Level of care",
  "Community — Boma Health Initiative",
  "Primary Health Care Unit",
  "Primary Health Care Centre",
  "County or State Hospital",
  "Referral / Tertiary Hospital",
  "Not a facility",
];

const PLACES = ["Where you are", "Juba", "Elsewhere in South Sudan", "Elsewhere in sub-Saharan Africa", "Outside Africa"];

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "15px 16px",
  fontFamily: "var(--font-body)",
  fontSize: 15.5,
  color: "var(--color-text)",
  background: "#FFFFFF",
  border: "1px solid var(--color-neutral-400, #a9b4c0)",
  borderRadius: 0,
  outlineOffset: 2,
};

/** Next and Submit carry the site's primary: amber on navy ink. */
const primaryBtn: React.CSSProperties = {
  appearance: "none",
  cursor: "pointer",
  fontFamily: "var(--font-heading)",
  fontWeight: 600,
  fontSize: 17,
  letterSpacing: "0.02em",
  padding: "16px 0",
  background: "#e8863a",
  border: "1px solid #e8863a",
  color: "#0e2a4a",
};

export default function ContactForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // Step 1's answers have to outlive the step switch: those inputs unmount when
  // step 2 renders, so a bare FormData read at submit time would lose them.
  const [who, setWho] = useState({ name: "", email: "", phone: "", organisation: "" });

  const step1Complete = who.name.trim() !== "" && who.email.trim() !== "" && who.organisation.trim() !== "";

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "sending" || state === "sent") return;
    const data = new FormData(e.currentTarget);
    setState("sending");
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: `TamamHealth website — ${data.get("topic") || "Contact"}`,
          from_name: "tamamhealth.org contact form",
          name: who.name,
          email: who.email,
          phone: who.phone,
          organisation: who.organisation,
          topic: data.get("topic"),
          level: data.get("level"),
          place: data.get("place"),
          message: data.get("message"),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success !== false) setState("sent");
      else setState("error");
    } catch {
      setState("error");
    }
  };

  const stepTitle = step === 2 ? "Almost there" : "Tell us who you are";
  const stepLead =
    step === 2
      ? "A little context on your setting, and we'll come back with something specific rather than generic."
      : "Four details so we know who we're answering, and how to reach you.";

  return (
    <form
      onSubmit={onSubmit}
      className="blueprint"
      style={{ background: "#FFFFFF", color: "var(--color-text)", padding: "40px 40px 42px", display: "flex", flexDirection: "column", gap: 8 }}
    >
      <Corners />
      <h2 style={{ fontSize: "clamp(24px, 2.7vw, 32px)", margin: 0 }}>{stepTitle}</h2>
      <p style={{ margin: "6px 0 0", fontSize: 15.5, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>{stepLead}</p>

      <span style={{ marginTop: 18, fontSize: 11.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>
        Step {step}/2
      </span>
      <div style={{ height: 5, background: "var(--color-neutral-300)", marginTop: 8 }}>
        <span style={{ display: "block", height: "100%", width: step === 2 ? "100%" : "50%", background: "#0e2a4a", transition: "width .2s ease" }} />
      </div>

      {step === 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 26 }}>
          <input
            aria-label="Full name" placeholder="Full name*" className="tm-cfield" style={field}
            value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })}
          />
          <input
            aria-label="Email" type="email" placeholder="Email*" className="tm-cfield" style={field}
            value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })}
          />
          <input
            aria-label="Phone" type="tel" placeholder="Phone" className="tm-cfield" style={field}
            value={who.phone} onChange={(e) => setWho({ ...who, phone: e.target.value })}
          />
          <input
            aria-label="Organisation" placeholder="Organisation — clinic, hospital, NGO or ministry*" className="tm-cfield" style={field}
            value={who.organisation} onChange={(e) => setWho({ ...who, organisation: e.target.value })}
          />
          {/* type="button": step 1 advances the wizard, it never submits. */}
          <button
            type="button" onClick={() => setStep(2)} disabled={!step1Complete} className="blueprint"
            style={{ ...primaryBtn, marginTop: 6, width: "100%", opacity: step1Complete ? 1 : 0.5, cursor: step1Complete ? "pointer" : "not-allowed" }}
          >
            Next
            <Corners />
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 26 }}>
          <select name="topic" aria-label="What is this about?" className="tm-cfield" style={field} defaultValue={SUBJECTS[0]}>
            {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select name="level" aria-label="Level of care" className="tm-cfield" style={field} defaultValue={LEVELS[0]}>
            {LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
          <select name="place" aria-label="Where you are" className="tm-cfield" style={field} defaultValue={PLACES[0]}>
            {PLACES.map((p) => <option key={p}>{p}</option>)}
          </select>
          <textarea
            name="message" aria-label="Message" rows={4} className="tm-cfield"
            placeholder="What you're building, or how you'd like to help."
            style={{ ...field, resize: "vertical" }}
          />
          <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--color-neutral-700)" }}>
            By submitting, you agree that TamamHealth may contact you about this enquiry, as described in our{" "}
            <a href="/terms" style={{ color: "var(--color-accent-700)" }}>Terms &amp; Privacy</a>.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "62px 1fr", gap: 12, marginTop: 6 }}>
            <button
              type="button" onClick={() => { setStep(1); setState("idle"); }} aria-label="Back" className="blueprint"
              style={{ appearance: "none", cursor: "pointer", fontSize: 18, padding: "16px 0", background: "transparent", border: "1px solid var(--color-neutral-400, #a9b4c0)", color: "var(--color-text)" }}
            >
              ←
              <Corners />
            </button>
            <button type="submit" disabled={state === "sending" || state === "sent"} className="blueprint" style={primaryBtn}>
              {state === "sent" ? "Message sent ✓" : state === "sending" ? "Sending…" : "Submit"}
              <Corners />
            </button>
          </div>
          {state === "error" && (
            <span style={{ fontSize: 14, lineHeight: 1.5, color: "#b3251e" }}>
              Something went wrong sending that — please email support.tamam@gmail.com directly.
            </span>
          )}
        </div>
      )}
    </form>
  );
}
