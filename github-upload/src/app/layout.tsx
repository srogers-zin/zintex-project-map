import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zintex Project Map",
  description:
    "Explore completed Zintex remodeling projects near you — photos, services, and reviews across our service area.",
};

// Disable native page pinch-zoom so a pinch gesture that lands on the
// header, sidebar, or footer doesn't zoom the whole page in/out. The map
// itself (MapLibre) handles its own pinch-to-zoom independently of this —
// it listens directly to touch gestures on the map canvas, so it keeps
// working normally even with page-level zoom turned off.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
