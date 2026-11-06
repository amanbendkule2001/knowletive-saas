import type { Metadata, Viewport } from "next";
import { ToastContainer } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Knowletive — The operating system for modern institutes",
    template: "%s · Knowletive",
  },
  description:
    "Multi-tenant school, college and coaching management SaaS with roles, subscriptions, billing and AI modules — managed end-to-end from one platform console.",
  applicationName: "Knowletive",
  keywords: [
    "school management software",
    "institute ERP",
    "multi-tenant SaaS",
    "student information system",
    "school fees software",
    "AI for schools",
  ],
  authors: [{ name: "Knowletive" }],
  openGraph: {
    title: "Knowletive — The operating system for modern institutes",
    description:
      "One platform for institutes, roles, parents, students, subscriptions and AI workflows.",
    type: "website",
  },
  robots: { index: true, follow: true },
  icons: { icon: "/icon.svg" },
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
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ToastContainer />
        {children}
      </body>
    </html>
  );
}
