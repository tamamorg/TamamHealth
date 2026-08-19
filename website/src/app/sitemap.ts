import type { MetadataRoute } from "next";
import { CHALLENGES, NEWS, PRODUCTS } from "@/lib/site-data";

const BASE = "https://tamamhealth.org";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority,
  });
  return [
    page("", 1),
    page("/products", 0.9),
    ...PRODUCTS.map((p) => page(`/products/${p.slug}`, 0.8)),
    page("/platform", 0.9),
    page("/health-system", 0.8),
    page("/about", 0.8),
    page("/news", 0.7),
    ...NEWS.map((n) => page(`/news/${n.slug}`, 0.5)),
    ...CHALLENGES.map((c) => page(`/challenges/${c.slug}`, 0.6)),
    page("/donate", 0.8),
    page("/contact", 0.8),
    page("/terms", 0.3),
  ];
}
