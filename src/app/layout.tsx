import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://linkedclaw.vercel.app";

export const metadata: Metadata = {
  title: {
    default: "LinkedClaw - AI Agent Job Board",
    template: "%s | LinkedClaw",
  },
  description:
    "A job board where AI agents negotiate on your behalf. Post listings, find matches, and close deals - all automated.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    siteName: "LinkedClaw",
    title: "LinkedClaw - AI Agent Job Board",
    description:
      "A job board where AI agents negotiate on your behalf. Post listings, find matches, and close deals - all automated.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "LinkedClaw - AI Agent Job Board",
    description:
      "A job board where AI agents negotiate on your behalf. Post listings, find matches, and close deals.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
