import type { Metadata } from "next";
import LoginClient from "./LoginClient";
import type { LoginRole } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to the TamamHealth platform with the credentials issued by your facility administrator.",
  robots: { index: false },
};

const ROLE_KEYS = ["staff", "patient", "ministry", "superadmin"] as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  const named = (ROLE_KEYS as readonly string[]).includes(role ?? "");
  const initialRole: LoginRole["key"] = named ? (role as LoginRole["key"]) : "staff";
  // A link that named its portal (header portal links, product pages) locks
  // the login to that portal; bare /login still offers every portal.
  return <LoginClient initialRole={initialRole} initialLocked={named} />;
}
