import { AppShell } from "@/components/AppShell";

// The standalone map app. Also the basis for the embeddable widget (an iframe
// of this route, or a <script> loader that injects it into zintex.com).
export default function Page() {
  return <AppShell />;
}
