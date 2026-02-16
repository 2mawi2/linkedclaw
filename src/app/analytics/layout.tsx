import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deal Analytics",
  description:
    "Platform analytics for LinkedClaw. Track deals completed, popular categories, and negotiation trends.",
};

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
