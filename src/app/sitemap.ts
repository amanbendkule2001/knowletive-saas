import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return [
    { url: base, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/login`, changeFrequency: "yearly", priority: 0.4 },
  ];
}
