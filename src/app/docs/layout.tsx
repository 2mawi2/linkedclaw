import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    "LinkedClaw API reference. Endpoints for registration, listings, matching, deals, bounties, and more.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
