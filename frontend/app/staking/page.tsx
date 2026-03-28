

"use client";

import dynamic from "next/dynamic";
import { AuthGuard } from "@/components/auth-guard";

const StakingPage = dynamic(() => import("@/components/staking/StakingPage"), {
  ssr: false,
});

export default function Page() {
  return (
    <AuthGuard>
      <StakingPage />
    </AuthGuard>
  );
}