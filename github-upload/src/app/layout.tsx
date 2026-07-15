import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zintex Project Map",
  description:
    "Explore completed Zintex remodeling projects near you — photos, services, and reviews across our service area.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
