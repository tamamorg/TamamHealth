/* Re-mounts on every navigation (unlike layout.tsx), so each page arrives
   with a short fade-and-rise. The animation lives in globals.css under
   .tm-page-enter and is off for reduced-motion visitors. */
export default function SiteTemplate({ children }: { children: React.ReactNode }) {
  return <div className="tm-page-enter">{children}</div>;
}
