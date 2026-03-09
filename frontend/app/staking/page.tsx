
import StakingPage from "@/components/staking/StakingPage";
import { AuthGuard } from "@/components/auth-guard";

export default function Page() {
  return (
    <AuthGuard>
      <StakingPage />
    </AuthGuard>
  );
}