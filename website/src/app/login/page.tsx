import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { platformHref, type LoginRole } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to the TamamHealth platform with the credentials issued by your facility administrator.",
  robots: { index: false },
};

const ROLE_KEYS = ["staff", "patient", "ministry", "superadmin"] as const;

/**
 * There is one login screen, and it lives on the platform.
 *
 * This route used to render a second one: a hand-off that asked which portal
 * you wanted and, on the staff/ministry/superadmin paths, took a username
 * before forwarding to the platform to ask for it again. Two screens wearing
 * the same word meant the sign-in someone described was ambiguous, and the
 * first one collected an identifier it could not do anything with.
 *
 * So this is now a redirect, not a page. Every link that already points here
 * — the header's portal menu, the footer, the terms page, the product pages,
 * anything printed or bookmarked — keeps working and simply arrives at the
 * real form, with `?role=patient` still resolving to the patient portal
 * rather than the staff login.
 *
 * What has NOT changed is the reason there was never a password box on this
 * origin: the marketing site holds no session and cannot verify one, and a
 * field that swallowed a facility credential here would teach staff to type
 * it into whatever page says "TamamHealth". Removing the form removes that
 * hazard outright rather than relying on the field staying absent.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  const key: LoginRole["key"] = (ROLE_KEYS as readonly string[]).includes(role ?? "")
    ? (role as LoginRole["key"])
    : "staff";
  redirect(platformHref(key));
}
