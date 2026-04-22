import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solar Land Scout — U.S. Utility-Scale Site Discovery",
  description:
    "Discover high-quality candidate sites for utility-scale solar development across the United States. Macro state ranking and strict site filtering, with Gemini-powered analyst explanations.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#070a10",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg-900 text-ink-50 antialiased">{children}</body>
    </html>
  );
}
