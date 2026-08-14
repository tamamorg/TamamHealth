import type { Metadata } from "next";
import LoginClient from "./LoginClient";
import type { LoginRole } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to the TamamHealth platform with the credentials issued by your facility administrator.",
  robots: { index: false },
};

const ROLE_KEYS = ["staff", "patient", "ministry"] as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  const initialRole: LoginRole["key"] = (ROLE_KEYS as readonly string[]).includes(role ?? "") ? (role as LoginRole["key"]) : "staff";
  return <LoginClient initialRole={initialRole} />;
}
