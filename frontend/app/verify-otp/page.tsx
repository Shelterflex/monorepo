"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifyOtp } from "@/lib/authApi";
import { handleAuthRedirect } from "@/lib/auth";

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const returnTo = searchParams.get("returnTo");

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await verifyOtp(email, otp);
      
      // Use handleAuthRedirect to handle returnTo or default to role-based dashboard
      if (returnTo) {
        handleAuthRedirect(returnTo);
      } else {
        // Fallback to role-based dashboard routing
        const roleRoutes: Record<string, string> = {
          tenant: "/dashboard/tenant",
          landlord: "/dashboard/landlord",
          agent: "/dashboard/agent",
        };
        router.push(roleRoutes[res.user.role] ?? "/dashboard/tenant");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-muted flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block font-mono text-3xl font-black">
            SHELTER<span className="text-primary">FLEX</span>
          </Link>
          <p className="mt-2 text-muted-foreground">
            Enter the OTP sent to <strong>{email}</strong>
          </p>
        </div>

        <div className="border-3 border-foreground bg-card p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
          <h1 className="mb-6 font-mono text-2xl font-black">Verify OTP</h1>

          {error && (
            <div className="mb-4 border-2 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="otp"
                className="mb-2 block font-mono text-sm font-bold"
              >
                One-Time Password
              </label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                className="border-3 border-foreground py-6 text-center text-2xl tracking-[0.5em] shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                required
                disabled={loading}
                maxLength={6}
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <ArrowRight className="ml-2 h-5 w-5" />
              )}
              {loading ? "Verifying..." : "Verify & Sign In"}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground text-sm">
              Didn&apos;t receive it?{" "}
              <Link
                href={`/login`}
                className="font-bold text-primary hover:underline"
              >
                Try again
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense>
      <VerifyOtpForm />
    </Suspense>
  );
}