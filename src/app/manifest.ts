import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Coachgenie — Institute OS",
    short_name: "Coachgenie",
    description:
      "Multi-tenant institute management: students, parents, staff, attendance, fees, subscriptions and AI.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#4f46e5",
    icons: [
      { src: "/coachgenie-logo.png", sizes: "any", type: "image/png", purpose: "any" },
    ],
  };
}
