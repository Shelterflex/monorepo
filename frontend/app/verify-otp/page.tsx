"use client";

import React, { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifyOtp } from "@/lib/authApi";
import { handleAuthRedirect } from "@/lib/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { otpSchema, type OtpFormValues } from "@/lib/formSchemas";
import { parseFormError } from "@/lib/formErrors";

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const returnTo = searchParams.get("returnTo");

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<OtpFormValues>({
    resolver: zodResolver(otpSchema),
    mode: "onBlur",
    reValidateMode: "onBlur",
    shouldFocusError: true,
    defaultValues: { otp: "" },
  });

  const onSubmit = async (data: OtpFormValues) => {
    if (isSubmitting) return;

    clearErrors("root");

    try {
      const res = await verifyOtp(email, data.otp);

      if (returnTo) {
        handleAuthRedirect(returnTo);
      } else {
        const roleRoutes: Record<string, string> = {
          tenant: "/dashboard/tenant",
          landlord: "/dashboard/landlord",
        };
        router.push(roleRoutes[res.user.role] ?? "/dashboard/tenant");
      }
    } catch (error) {
      const { message, fieldErrors } = parseFormError(error, "Invalid OTP");
      if (fieldErrors.otp) {
        setError("otp", { type: "server", message: fieldErrors.otp });
        setFocus("otp");
        return;
      }
      setError("root.serverError", { type: "server", message });
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

          {errors.root?.serverError?.message && (
            <div role="alert" className="mb-4 border-2 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive">
              {errors.root.serverError.message}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
            <div>
              <label htmlFor="otp" className="mb-2 block font-mono text-sm font-bold">
                One-Time Password
              </label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                {...register("otp", { onChange: () => clearErrors(["otp", "root.serverError" as any]) })}
                placeholder="123456"
                aria-invalid={Boolean(errors.otp)}
                aria-describedby={errors.otp ? "otp-error" : undefined}
                className={`border-3 border-foreground py-6 text-center text-2xl tracking-[0.5em] shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${
                  errors.otp ? "border-destructive" : ""
                }`}
                disabled={isSubmitting}
                maxLength={6}
              />
              {errors.otp?.message && (
                <p id="otp-error" role="alert" className="mt-2 text-xs font-bold text-destructive">
                  {errors.otp.message}
                </p>
              )}
            </div>

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

          <div className="mt-6 text-center">
            <p className="text-muted-foreground text-sm">
              Didn&apos;t receive it?{" "}
              <Link href="/login" className="font-bold text-primary hover:underline">
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
