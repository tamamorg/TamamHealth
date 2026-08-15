"use client";

/* Login screen — ported 1:1, including the design's demo behaviour: the
   submit flips to the role's success line rather than authenticating
   (platform accounts are provisioned per facility; this website carries no
   session). Role tabs deep-link as /login?role=staff|patient|ministry;
   arriving through such a link locks the picker to that one portal, with
   "Change" as the way back to the three-way choice. */

import Link from "next/link";
import { useState } from "react";
import Corners from "@/components/Corners";
import { ROLES, STAFF_USERS, type LoginRole } from "@/lib/site-data";

const INTRO: Record<LoginRole["key"], string> = {
  staff: "Enter the username and password issued by your facility administrator.",
  patient: "Sign in with your geocode ID or phone number to open your own records.",
  ministry: "Sign in with your official ministry email to open the national dashboard.",
};

export default function LoginClient({ initialRole, initialLocked }: { initialRole: LoginRole["key"]; initialLocked: boolean }) {
  const [role, setRole] = useState<LoginRole["key"]>(initialRole);
  const [locked, setLocked] = useState(initialLocked);
  const [pwShown, setPwShown] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [roleQuery, setRoleQuery] = useState("");
  const [roleListOpen, setRoleListOpen] = useState(false);
  const login = ROLES.find((r) => r.key === role)!;

  const q = roleQuery.trim().toLowerCase();
  const roleMatches = q ? STAFF_USERS.filter((u) => `${u.name} ${u.scope}`.toLowerCase().includes(q)) : STAFF_USERS;

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
            <p style={{ margin: 0, fontSize: 15, color: "var(--color-neutral-700)" }}>{INTRO[role]}</p>
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
            <div style={{ display: "flex", border: "1px solid var(--color-divider)" }}>
              {ROLES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => { setRole(r.key); setLoggedIn(false); }}
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
          {/* The staff-role combobox is a facility concept — patients sign in
              by geocode/phone and ministry users by official email. */}
          {role === "staff" && (
          <div className="field" style={{ position: "relative" }}>
            <label htmlFor="lg-role">Role</label>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--color-divider)", background: "#FFFFFF" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-neutral-600)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 13, flexShrink: 0 }} aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4.2-4.2"></path></svg>
              <input
                id="lg-role"
                className="input"
                value={roleQuery}
                onChange={(e) => { setRoleQuery(e.target.value); setRoleListOpen(true); }}
                onFocus={() => setRoleListOpen(true)}
                placeholder="Search your role — doctor, nurse, pharmacist…"
                style={{ border: 0, minHeight: 46, background: "transparent" }}
                role="combobox"
                aria-expanded={roleListOpen}
                aria-controls="lg-role-list"
                autoComplete="off"
              />
              {roleQuery && (
                <button type="button" onClick={() => { setRoleQuery(""); setRoleListOpen(true); }} aria-label="Clear role" style={{ appearance: "none", border: 0, background: "none", cursor: "pointer", width: 40, height: 44, color: "var(--color-neutral-600)", fontSize: 17 }}>
                  ×
                </button>
              )}
            </div>
            {roleListOpen && (
              <div id="lg-role-list" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 40, background: "#FFFFFF", border: "1px solid var(--color-divider)", borderTop: 0, maxHeight: 232, overflowY: "auto", boxShadow: "var(--shadow-md)" }}>
                {roleMatches.map((u) => (
                  <button
                    key={u.name}
                    type="button"
                    onClick={() => { setRoleQuery(u.name); setRoleListOpen(false); }}
                    className="tm-rolerow"
                    style={{
                      appearance: "none", border: 0, borderBottom: "1px solid var(--color-divider)",
                      background: u.name === roleQuery ? "var(--color-accent-100)" : "#FFFFFF",
                      cursor: "pointer", width: "100%", textAlign: "left", padding: "11px 14px",
                      display: "flex", flexDirection: "column", gap: 2,
                    }}
                  >
                    <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 15, color: "var(--color-text)" }}>{u.name}</span>
                    <span className="fs125" style={{ color: "var(--color-neutral-600)" }}>{u.scope}</span>
                  </button>
                ))}
                {q && roleMatches.length === 0 && (
                  <span style={{ display: "block", padding: 14, fontSize: 13.5, color: "var(--color-neutral-600)" }}>
                    No role matches that. Ask your facility administrator which role your account carries.
                  </span>
                )}
              </div>
            )}
          </div>
          )}
          <div className="field">
            <label htmlFor="lg-id">{login.idLabel}</label>
            <input id="lg-id" className="input" style={{ minHeight: 46, background: "#FFFFFF" }} placeholder={login.idPlaceholder} />
          </div>
          <div className="field">
            <label htmlFor="lg-pw">Password</label>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--color-divider)", background: "#FFFFFF" }}>
              <input id="lg-pw" className="input" type={pwShown ? "text" : "password"} style={{ border: 0, minHeight: 46, background: "transparent" }} placeholder="••••••••" />
              <button onClick={() => setPwShown((s) => !s)} type="button" aria-label={pwShown ? "Hide password" : "Show password"} style={{ appearance: "none", border: 0, background: "none", cursor: "pointer", width: 44, height: 44, display: "grid", placeItems: "center", color: "#015697" }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="2.6"></circle></svg>
              </button>
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "var(--color-neutral-800)" }}>
            <input type="checkbox" style={{ width: 16, height: 16, accentColor: "#015697" }} />
            Keep me signed in on this device
          </label>
          <button className="btn btn-primary blueprint" onClick={() => { setLoggedIn(true); setRoleListOpen(false); }} style={{ padding: "15px 0", fontSize: 16, color: "#0E2A4A", width: "100%" }}>
            {login.cta}
            <Corners />
          </button>
          {loggedIn && (
            <span style={{ fontSize: 14, lineHeight: 1.55, color: "#0B6E5C", borderLeft: "3px solid #0B6E5C", paddingLeft: 12 }}>{login.success}</span>
          )}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", paddingTop: 4 }}>
            {role !== "patient" && (
              <button type="button" onClick={() => { setRole("patient"); setLoggedIn(false); }} style={{ appearance: "none", border: 0, background: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-body)", fontSize: 14.5, fontWeight: 700, color: "var(--color-accent-700)", textDecoration: "underline", textUnderlineOffset: 3 }}>
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
            <img src="/assets/platform-receptionist.png" alt="The TamamHealth reception dashboard: today's schedule, patient flow and triage queue" style={{ width: "100%", display: "block" }} />
          </div>
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--color-divider)", padding: "22px 32px", display: "flex", justifyContent: "center", gap: 28, fontSize: 13.5, flexWrap: "wrap" }}>
        <Link href="/terms">Terms &amp; Conditions</Link>
        <Link href="/terms">Privacy Policy</Link>
        <Link href="/">Back to tamamhealth.org</Link>
      </div>
    </main>
  );
}
