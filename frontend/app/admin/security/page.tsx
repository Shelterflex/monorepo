import SecurityDashboard from "@/components/security-dashboard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Security Dashboard | ShelterFlex Dashboard",
  description:
    "Real-time security test suite, CSP headers, XSS protection, rate limiting, and CSRF test results.",
};

export default function AdminSecurityPage() {
  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      <SecurityDashboard />
    </div>
  );
}
