import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admissions CRM",
  description: "Evidence-based lead attribution CRM for JEE/NEET coaching",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2f5bd3" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
