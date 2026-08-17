"use client";

/* Login screen — the marketing site holds no session, so signing in here is a
   hand-off: pick the portal, optionally name the account, and continue to the
   real platform (PLATFORM_URL) where auth, the seeded accounts and the
   one-tap demo roster live.

   There is deliberately no password field. This origin cannot verify a
   password, and a box that swallows one would both mislead the person typing
   and train staff to enter facility credentials on the public website.

   Role tabs deep-link as /login?role=staff|patient|ministry|superadmin;
   arriving through such a link locks the picker to that one portal, with
   "Change" as the way back to the full choice. */

import Link from "next/link";
import { useState } from "react";
import Corners from "@/components/Corners";
import { PLATFORM_URL, ROLES, type LoginRole } from "@/lib/site-data";

const INTRO: Record<LoginRole["key"], string> = {
  staff: "Continue to the platform and sign in with the username and password issued by your facility administrator.",
  patient: "Continue to the patient portal to open your own records, prescriptions and results.",
  ministry: "Continue to the platform and sign in with your official ministry email to open the national dashboard.",
  superadmin: "The platform administrator account — organisations, provisioning and governance across every deployment.",
};

export default function LoginClient({ initialRole, initialLocked }: { initialRole: LoginRole["key"]; initialLocked: boolean }) {
  const [role, setRole] = useState<LoginRole["key"]>(initialRole);
  const [locked, setLocked] = useState(initialLocked);
  const [identifier, setIdentifier] = useState("");
  const [handingOff, setHandingOff] = useState(false);
  const login = ROLES.find((r) => r.key === role)!;

  /* Continue on the platform. The username travels as ?u= so the platform's
     form opens prefilled; the password is only ever typed over there. */
  const continueToPlatform = () => {
    setHandingOff(true);
    const id = (identifier.trim() || (role === "superadmin" ? "superadmin" : "")).slice(0, 64);
    const query = login.path === "/login" && id ? `?u=${encodeURIComponent(id)}` : "";
    window.location.assign(`${PLATFORM_URL}${login.path}${query}`);
  };

  return (
    <main className="tm-login-main" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#FFFFFF" }}>
      <div style={{ borderBottom: "1px solid var(--color-divider)", padding: "22px 32px", display: "flex", justifyContent: "center" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-height SVG logo */}
          <img src="/assets/tamam-logo-full.svg" alt="Tamam Healthcare System" style={{ height: 27, width: "auto" }} />
        </Link>
      </div>
      <div className="tm-login-grid" style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, maxWidth: 1320, width: "100%", margin: "0 auto", padding: "48px 32px", alignItems: "start", alignContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <h1 style={{ fontSize: 36, margin: "0 0 4px" }}>Log in</h1>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>{INTRO[role]}</p>
          </div>

          {locked ? (
            <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--color-divider)", background: "#015697" }}>
              <span style={{ flex: 1, textAlign: "center", padding: "11px 4px", fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 14.5, color: "#FFFFFF" }}>
                {login.label}
              </span>
              <button
                type="button"
                onClick={() => setLocked(false)}
                style={{ appearance: "none", border: 0, background: "none", cursor: "pointer", padding: "11px 14px", fontFamily: "var(--font-body)", fontSize: 13, color: "rgba(255,255,255,0.85)", textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                Change
              </button>
            </div>
          ) : (
            <div className="tm-login-tabs" style={{ display: "flex", border: "1px solid var(--color-divider)" }}>
              {ROLES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRole(r.key)}
                  aria-pressed={role === r.key}
                  style={{
                    appearance: "none", cursor: "pointer", flex: 1, border: 0, padding: "11px 4px",
                    fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 14.5,
                    background: role === r.key ? "#015697" : "transparent",
                    color: role === r.key ? "#FFFFFF" : "var(--color-neutral-800)",
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}

          {/* The patient portal carries its own sign-in, so there is nothing
              useful to pass ahead for it. */}
          {login.path === "/login" && (
            <div className="field">
              <label htmlFor="lg-id">{login.idLabel} <span style={{ textTransform: "none", letterSpacing: "normal", color: "var(--color-neutral-600)" }}>(optional)</span></label>
              <input
                id="lg-id"
                className="input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") continueToPlatform(); }}
                style={{ minHeight: 46, background: "#FFFFFF" }}
                placeholder={login.idPlaceholder}
                autoComplete="username"
              />
            </div>
          )}

          <button className="btn btn-primary blueprint" disabled={handingOff} onClick={continueToPlatform} style={{ padding: "15px 0", fontSize: 16, color: "#0E2A4A", width: "100%", opacity: handingOff ? 0.6 : 1 }}>
            {handingOff ? "Opening the platform…" : login.cta}
            <Corners />
          </button>

          <span style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--color-neutral-700)", borderLeft: "3px solid var(--color-accent)", paddingLeft: 12 }}>
            Your password is only ever entered on the platform itself — never on this site. Demo deployments offer
            one-tap accounts there for every role, from the front desk to the platform administrator.
          </span>

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", paddingTop: 4 }}>
            {role !== "patient" && (
              <button type="button" onClick={() => setRole("patient")} style={{ appearance: "none", border: 0, background: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-body)", fontSize: 14.5, fontWeight: 700, color: "var(--color-accent-700)", textDecoration: "underline", textUnderlineOffset: 3 }}>
                Patient portal
              </button>
            )}
            <a href={`mailto:support.tamam@gmail.com?subject=${encodeURIComponent("Trouble signing in")}`} style={{ fontSize: 14.5, fontWeight: 700 }}>Trouble signing in?</a>
          </div>

          <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: 14 }}>
            Works offline: once signed in on a facility device, the record keeps working through power cuts and network gaps and
            syncs when connection returns.
          </span>
        </div>

        <div className="blueprint" style={{ background: "var(--color-surface)", padding: "30px 32px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Corners />
          <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#015697" }}>One record, every level of care</span>
          <h2 style={{ fontSize: 30, margin: 0 }}>Registration, consultation, lab, pharmacy — one patient story</h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>
            Every visit adds to the same record and rolls up into facility dashboards and DHIS2-ready national reports.
          </p>
          <Link href="/products" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, color: "#015697", textDecoration: "none" }}>
            See the products &nbsp;›
          </Link>
          <div className="blueprint" style={{ marginTop: 6, background: "#FFFFFF" }}>
            <Corners />
            {/* eslint-disable-next-line @next/next/no-img-element -- product screenshot, natural ratio */}
            <img src="/assets/platform-doctor.png" alt="The TamamHealth clinical dashboard: a doctor's checked-in patient list with acuity, care team and visit context, alongside outstanding items and patient flow" style={{ width: "100%", display: "block" }} />
          </div>
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--color-divider)", padding: "22px 32px", display: "flex", justifyContent: "center", gap: 28, fontSize: 13.5, flexWrap: "wrap" }}>
        <Link href="/terms">Terms &amp; Conditions</Link>
        <Link href="/terms#patient-data">Privacy Policy</Link>
        <Link href="/">Back to tamamhealth.org</Link>
      </div>
    </main>
  );
}
