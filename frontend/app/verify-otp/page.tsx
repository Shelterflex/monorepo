"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifyOtp } from "@/lib/authApi";
import { handleAuthRedirect } from "@/lib/auth";
import { useAppForm } from "@/hooks/useAppForm";
import { FormField } from "@/components/ui/FormField";
import { Form } from "@/components/ui/form";
import { otpSchema, type OtpFormValues } from "@/lib/formSchemas";

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const returnTo = searchParams.get("returnTo");

  const [error, setError] = useState<string | null>(null);

  const form = useAppForm<OtpFormValues>({
    schema: otpSchema,
    defaultValues: { otp: "" },
  });

  const {
    handleSubmit,
    register,
    formState: { isSubmitting },
  } = form;

  const onSubmit = async (values: OtpFormValues) => {
    setError(null);

    try {
      const res = await verifyOtp(email, values.otp);

      if (returnTo) {
        handleAuthRedirect(returnTo);
      } else {
        const roleRoutes: Record<string, string> = {
          tenant: "/dashboard/tenant",
          landlord: "/dashboard/landlord",
          agent: "/dashboard/agent",
        };
        router.push(roleRoutes[res.user.role] ?? "/dashboard/tenant");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid OTP");
    }
  };

  return (
    <main className="min-h-screen bg-muted flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block font-mono text-3xl font-black">
            SHELTA<span className="text-primary">FLEX</span>
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

          <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
              <FormField name="otp" label="One-Time Password">
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  className="border-3 border-foreground py-6 text-center text-2xl tracking-[0.5em] shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                  disabled={isSubmitting}
                  maxLength={6}
                  {...register("otp")}
                />
              </FormField>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <ArrowRight className="ml-2 h-5 w-5" />
                )}
                {isSubmitting ? "Verifying..." : "Verify & Sign In"}
              </Button>
            </form>
          </Form>

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