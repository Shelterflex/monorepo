"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, Check, Wallet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StellarWalletConnect } from "@/components/wallet/StellarWalletConnect";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useRouter } from "next/navigation";
import { requestOtp } from "@/lib/authApi";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { accountSignupSchema, type AccountSignupFormValues } from "@/lib/formSchemas";
import { parseFormError } from "@/lib/formErrors";
import { startUserRegistration, trackRegistrationStep, completeUserRegistration } from "@/lib/analytics-init";

const SIGNUP_FIELDS: Array<keyof AccountSignupFormValues> = [
  "fullName",
  "email",
  "phone",
  "password",
  "terms",
];

export default function SignupPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [userType, setUserType] = useState<"tenant" | "landlord">("tenant");

  const {
    register,
    handleSubmit,
    watch,
    setError,
    setFocus,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<AccountSignupFormValues>({
    resolver: zodResolver(accountSignupSchema) as any,
    mode: "onBlur",
    reValidateMode: "onBlur",
    shouldFocusError: true,
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      password: "",
      terms: false as any,
    },
  });

  const password = watch("password", "");

  const onSubmit = async (data: AccountSignupFormValues) => {
    startUserRegistration("anonymous");
    trackRegistrationStep("anonymous", "submit_signup");
    if (isSubmitting) return;

    clearErrors("root");

    try {
      await requestOtp(data.email);
      completeUserRegistration("anonymous", { role: userType });
      router.push(`/verify-otp?email=${encodeURIComponent(data.email)}`);
    } catch (error) {
      const { message, fieldErrors } = parseFormError(error, "Registration failed");
      const firstField = Object.keys(fieldErrors).find((field) => SIGNUP_FIELDS.includes(field as keyof AccountSignupFormValues));

      if (firstField) {
        const key = firstField as keyof AccountSignupFormValues;
        setError(key, { type: "server", message: fieldErrors[firstField] });
        if (key !== "terms") {
          setFocus(key);
        }
      }

      if (!firstField) {
        setError("root.serverError", { type: "server", message });
      }
    }
  };

  const handleUserTypeKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setUserType((prev) => (prev === "tenant" ? "landlord" : "tenant"));
  };

  return (
    <main className="min-h-screen bg-muted flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block font-mono text-3xl font-black">
            SHELTER<span className="text-primary">FLEX</span>
          </Link>
          <p className="mt-2 text-muted-foreground">Create your account to get started.</p>
        </div>

        <div className="border-3 border-foreground bg-card p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
          <h1 className="mb-6 font-mono text-2xl font-black">Sign Up</h1>

          <Tabs defaultValue="email" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="email" className="font-mono">
                Email
              </TabsTrigger>
              <TabsTrigger value="wallet" className="font-mono">
                <Wallet className="h-4 w-4 mr-2" />
                Stellar
              </TabsTrigger>
            </TabsList>

            <TabsContent value="wallet" className="space-y-4">
              <Suspense fallback={<div className="text-center py-8">Loading...</div>}>
                <StellarWalletConnect />
              </Suspense>
            </TabsContent>

            <TabsContent value="email" className="space-y-5">
              <fieldset className="mb-6">
                <legend className="mb-2 block font-mono text-sm font-bold">I am a</legend>
                <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Account type" onKeyDown={handleUserTypeKeyDown}>
                  <button
                    type="button"
                    onClick={() => setUserType("tenant")}
                    role="radio"
                    aria-checked={userType === "tenant"}
                    disabled={isSubmitting}
                    className={`border-3 border-foreground p-4 font-mono font-bold transition-all ${
                      userType === "tenant"
                        ? "bg-primary text-primary-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        : "bg-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                    } disabled:opacity-60`}
                  >
                    Tenant
                  </button>
                  <button
                    type="button"
                    onClick={() => setUserType("landlord")}
                    role="radio"
                    aria-checked={userType === "landlord"}
                    disabled={isSubmitting}
                    className={`border-3 border-foreground p-4 font-mono font-bold transition-all ${
                      userType === "landlord"
                        ? "bg-primary text-primary-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        : "bg-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                    } disabled:opacity-60`}
                  >
                    Landlord
                  </button>
                </div>
              </fieldset>

              <div className="mb-6">
                <p className="text-xs text-muted-foreground mb-2">Or earn money reporting vacant apartments:</p>
                <Link href="/whistleblower/signup">
                  <Button
                    disabled={isSubmitting}
                    className="w-full border-3 border-foreground bg-secondary px-4 py-3 font-mono font-bold transition-all shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  >
                    Become a Whistleblower
                  </Button>
                </Link>
              </div>

              {errors.root?.serverError?.message && (
                <div role="alert" className="border-2 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive">
                  {errors.root.serverError.message}
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
                <div className="space-y-2">
                  <label htmlFor="full-name" className="block font-mono text-sm font-bold">
                    Full Name
                  </label>
                  <Input
                    id="full-name"
                    type="text"
                    {...register("fullName", { onChange: () => clearErrors(["fullName", "root.serverError" as any]) })}
                    placeholder="Enter your full name"
                    aria-invalid={Boolean(errors.fullName)}
                    aria-describedby={errors.fullName ? "signup-full-name-error" : undefined}
                    disabled={isSubmitting}
                    className={`border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${
                      errors.fullName ? "border-destructive" : ""
                    }`}
                  />
                  {errors.fullName?.message && (
                    <p id="signup-full-name-error" role="alert" className="text-xs font-bold text-destructive">
                      {errors.fullName.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="email" className="block font-mono text-sm font-bold">
                    Email Address
                  </label>
                  <Input
                    id="email"
                    type="email"
                    {...register("email", { onChange: () => clearErrors(["email", "root.serverError" as any]) })}
                    placeholder="you@email.com"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "signup-email-error" : undefined}
                    disabled={isSubmitting}
                    className={`border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${
                      errors.email ? "border-destructive" : ""
                    }`}
                  />
                  {errors.email?.message && (
                    <p id="signup-email-error" role="alert" className="text-xs font-bold text-destructive">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="phone" className="block font-mono text-sm font-bold">
                    Phone Number
                  </label>
                  <Input
                    id="phone"
                    type="tel"
                    {...register("phone", { onChange: () => clearErrors(["phone", "root.serverError" as any]) })}
                    placeholder="08X XXX XXXX"
                    aria-invalid={Boolean(errors.phone)}
                    aria-describedby={errors.phone ? "signup-phone-error" : undefined}
                    disabled={isSubmitting}
                    className={`border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${
                      errors.phone ? "border-destructive" : ""
                    }`}
                  />
                  {errors.phone?.message && (
                    <p id="signup-phone-error" role="alert" className="text-xs font-bold text-destructive">
                      {errors.phone.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="block font-mono text-sm font-bold">
                    Password
                  </label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      {...register("password", { onChange: () => clearErrors(["password", "root.serverError" as any]) })}
                      placeholder="Create a password"
                      aria-invalid={Boolean(errors.password)}
                      aria-describedby={errors.password ? "signup-password-error" : undefined}
                      disabled={isSubmitting}
                      className={`border-3 border-foreground py-6 pr-12 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${
                        errors.password ? "border-destructive" : ""
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      disabled={isSubmitting}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {errors.password?.message && (
                    <p id="signup-password-error" role="alert" className="text-xs font-bold text-destructive">
                      {errors.password.message}
                    </p>
                  )}
                  <div className="mt-2 space-y-1">
                    {[
                      {
                        label: "At least 8 characters",
                        valid: password.length >= 8,
                      },
                      {
                        label: "Contains a number",
                        valid: /\d/.test(password),
                      },
                    ].map((rule) => (
                      <div key={rule.label} className="flex items-center gap-2 text-xs">
                        <div
                          className={`h-4 w-4 border-2 border-foreground flex items-center justify-center ${rule.valid ? "bg-secondary" : "bg-background"}`}
                        >
                          {rule.valid && <Check className="h-3 w-3" />}
                        </div>
                        <span className={rule.valid ? "text-foreground" : "text-muted-foreground"}>{rule.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 space-y-1">
                  <label className="flex items-start gap-3 cursor-pointer" htmlFor="signup-terms">
                    <input
                      id="signup-terms"
                      type="checkbox"
                      {...register("terms", { onChange: () => clearErrors(["terms", "root.serverError" as any]) })}
                      aria-invalid={Boolean(errors.terms)}
                      aria-describedby={errors.terms ? "signup-terms-error" : undefined}
                      disabled={isSubmitting}
                      className={`mt-1 h-5 w-5 border-2 border-foreground accent-primary ${
                        errors.terms ? "border-destructive" : ""
                      }`}
                    />
                    <span className="text-sm text-muted-foreground">
                      I agree to the{" "}
                      <Link
                        href="/terms-of-service"
                        className="font-bold border-b-2 border-foreground hover:text-primary"
                      >
                        Terms of Service
                      </Link>{" "}
                      and{" "}
                      <Link
                        href="/privacy-policy"
                        className="font-bold border-b-2 border-foreground hover:text-primary"
                      >
                        Privacy Policy
                      </Link>
                    </span>
                  </label>
                  {errors.terms?.message && (
                    <p id="signup-terms-error" role="alert" className="text-xs font-bold text-destructive">
                      {errors.terms.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full border-3 border-foreground px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${
                    userType === "tenant" ? "bg-primary" : "bg-secondary"
                  } disabled:opacity-60`}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    <>
                      Create Account
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-bold text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
