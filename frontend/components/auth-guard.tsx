"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

type AuthState = "checking" | "authed" | "redirecting";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isAuthenticated()) {
        // Preserve the target URL for redirect after authentication
        const returnTo = encodeURIComponent(pathname);
        router.replace(`/verify-otp?returnTo=${returnTo}`);
      } else {
        setAuthState("authed");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [router, pathname]);

  if (authState === "checking" || authState === "redirecting") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin border-4 border-foreground border-t-primary" />
      </div>
    );
  }

  return <>{children}</>;
}