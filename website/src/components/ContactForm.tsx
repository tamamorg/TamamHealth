"use client";

/* Contact form on the navy ground. Deviation from the design source (same
   deviation the previous site revision made): the design's send button only
   flipped local state, so real submissions go through Web3Forms instead —
   browser-side by design, the access key only routes mail. */

import { useState } from "react";
import Corners from "@/components/Corners";
import { WEB3FORMS_ACCESS_KEY } from "@/lib/site-data";

const SUBJECTS = ["Book a demo", "Deploy Tamam in a facility", "Fund the pilot", "Partner or integrate", "Something else"];

const darkField: React.CSSProperties = { background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.3)", color: "#FFFFFF" };
const darkLabel: React.CSSProperties = { color: "rgba(255,255,255,0.8)" };

export default function ContactForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

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
          subject: `TamamHealth website — ${data.get("topic") || "Contact"}`,
          from_name: "tamamhealth.org contact form",
          name: data.get("name"),
          email: data.get("email"),
          organisation: data.get("organisation"),
          topic: data.get("topic"),
          message: data.get("message"),
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
    <form onSubmit={onSubmit} className="blueprint" style={{ borderColor: "rgba(255,255,255,0.28)", padding: 34, display: "flex", flexDirection: "column", gap: 20 }}>
      <Corners light />
      <span className="fs115" style={{ letterSpacing: "0.16em", textTransform: "uppercase", color: "#7FC4EA" }}>Send us a message</span>
      <div className="tm-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="field">
          <label style={darkLabel} htmlFor="ct-name">Full name</label>
          <input id="ct-name" name="name" required className="input input-dark" placeholder="Your name" style={darkField} />
        </div>
        <div className="field">
          <label style={darkLabel} htmlFor="ct-email">Email</label>
          <input id="ct-email" name="email" type="email" required className="input input-dark" placeholder="you@example.com" style={darkField} />
        </div>
      </div>
      <div className="field">
        <label style={darkLabel} htmlFor="ct-org">Organisation (optional)</label>
        <input id="ct-org" name="organisation" className="input input-dark" placeholder="Clinic, hospital, NGO or ministry" style={darkField} />
      </div>
      <div className="field">
        <label style={darkLabel} htmlFor="ct-topic">What is this about?</label>
        <select id="ct-topic" name="topic" className="input input-dark" style={darkField} defaultValue={SUBJECTS[0]}>
          {SUBJECTS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label style={darkLabel} htmlFor="ct-msg">Message</label>
        <textarea id="ct-msg" name="message" required rows={4} className="input input-dark" placeholder="What you're building, or how you'd like to help." style={darkField} />
      </div>
      <button type="submit" disabled={state === "sending" || state === "sent"} className="btn btn-primary blueprint" style={{ alignSelf: "flex-start", padding: "14px 30px", fontSize: 15.5, color: "#FFFFFF" }}>
        {state === "sent" ? "Message sent ✓" : state === "sending" ? "Sending…" : "Send message"}
        <Corners />
      </button>
      {state === "error" && (
        <span style={{ fontSize: 14, lineHeight: 1.5, color: "#FFB4A8" }}>
          Something went wrong sending that — please email support.tamam@gmail.com directly.
        </span>
      )}
    </form>
  );
}
