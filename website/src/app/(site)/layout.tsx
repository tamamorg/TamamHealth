/* Every page except /login shares the fixed header + footer ("showChrome"
   in the design). The login screen carries its own minimal chrome. */

import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "var(--font-body)", color: "var(--color-text)", background: "#FFFFFF", minHeight: "100vh", overflowX: "clip" }}>
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
