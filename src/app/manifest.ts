import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Knowletive — Institute OS",
    short_name: "Knowletive",
    description:
      "Multi-tenant institute management: students, parents, staff, attendance, fees, subscriptions and AI.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
