"use client";

import React, { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestOtp } from "@/lib/authApi";
import { StellarWalletConnect } from "@/components/wallet/StellarWalletConnect";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginFormValues } from "@/lib/formSchemas";
import { parseFormError } from "@/lib/formErrors";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: "onBlur",
    reValidateMode: "onBlur",
    shouldFocusError: true,
  });

  const onSubmit = async (data: LoginFormValues) => {
    if (isSubmitting) return;

    clearErrors("root");
    try {
      await requestOtp(data.email);

      const verifyOtpUrl = returnTo
        ? `/verify-otp?email=${encodeURIComponent(data.email)}&returnTo=${encodeURIComponent(returnTo)}`
        : `/verify-otp?email=${encodeURIComponent(data.email)}`;

      router.push(verifyOtpUrl);
    } catch (error) {
      const { message, fieldErrors } = parseFormError(error, "Something went wrong");
      const firstField = Object.keys(fieldErrors)[0];

      if (firstField === "email") {
        setError("email", { type: "server", message: fieldErrors.email });
        setFocus("email");
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
          <p className="mt-2 text-muted-foreground">Choose your sign-in method</p>
        </div>

        <div className="border-3 border-foreground bg-card p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
          <h1 className="mb-6 font-mono text-2xl font-black">Sign In</h1>

          <Tabs defaultValue="email" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="email" className="font-mono">
                Email
              </TabsTrigger>
              <TabsTrigger value="wallet" className="font-mono">
                <Wallet className="w-4 h-4 mr-1" />
                Stellar Wallet
              </TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="space-y-4">
              {errors.root?.serverError?.message && (
                <div
                  role="alert"
                  className="border-2 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive"
                >
                  {errors.root.serverError.message}
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
                <div className="space-y-2">
                  <label htmlFor="email" className="block font-mono text-sm font-bold">
                    Email Address
                  </label>
                  <Input
                    id="email"
                    type="email"
                    {...register("email", {
                      onChange: () => clearErrors(["email", "root.serverError" as any]),
                    })}
                    placeholder="you@email.com"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "login-email-error" : undefined}
                    className={`border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${
                      errors.email ? "border-destructive" : ""
                    }`}
                    disabled={isSubmitting}
                  />
                  {errors.email?.message && (
                    <p id="login-email-error" role="alert" className="text-xs font-bold text-destructive">
                      {errors.email.message}
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
                  {isSubmitting ? "Sending OTP..." : "Continue"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="wallet">
              <StellarWalletConnect />
            </TabsContent>
          </Tabs>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-bold text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>
            By signing in, you agree to our{" "}
            <Link href="/terms-of-service" className="underline hover:text-foreground">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy-policy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
