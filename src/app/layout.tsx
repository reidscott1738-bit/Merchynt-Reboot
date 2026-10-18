import type { Metadata } from "next";
import "./globals.css";
import { env } from "@/server/env";

export const metadata: Metadata = {
  title: { default: env().APP_NAME, template: `%s · ${env().APP_NAME}` },
  description: "AI-assisted local SEO and marketing for local businesses and agencies.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
