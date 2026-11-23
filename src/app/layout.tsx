import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { ToastContainer } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Coachgenie — The operating system for modern institutes",
    template: "%s · Coachgenie",
  },
  description:
    "Multi-tenant school, college and coaching management SaaS with roles, subscriptions, billing and AI modules — managed end-to-end from one platform console.",
  applicationName: "Coachgenie",
  keywords: [
    "school management software",
    "institute ERP",
    "multi-tenant SaaS",
    "student information system",
    "school fees software",
    "AI for schools",
  ],
  authors: [{ name: "Coachgenie" }],
  openGraph: {
    title: "Coachgenie — The operating system for modern institutes",
    description:
      "One platform for institutes, roles, parents, students, subscriptions and AI workflows.",
    type: "website",
  },
  robots: { index: true, follow: true },
  icons: { icon: "/coachgenie-logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#070a13" },
  ],
};

const themeScript = `(function(){try{var t=localStorage.getItem('kl-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t&&d)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <Script id="theme-script" strategy="beforeInteractive">
          {themeScript}
        </Script>
      </head>
      <body>
        <ToastContainer />
        {children}
      </body>
    </html>
  );
}
