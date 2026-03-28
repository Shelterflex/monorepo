"use client";

import React, { useState } from "react";

import Link from "next/link";
import { ArrowRight, Eye, EyeOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignupPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [userType, setUserType] = useState<"tenant" | "landlord">("tenant");
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
  });

  const handleSubmit: React.ComponentProps<'form'>['onSubmit'] = (e) => {
    e.preventDefault();
    // Handle signup
  };

  const updateFormData = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleUserTypeKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    setUserType((prev) => (prev === "tenant" ? "landlord" : "tenant"))
  }

  return (
    <main className="min-h-screen bg-muted flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block font-mono text-3xl font-black">
            SHELTA<span className="text-primary">FLEX</span>
          </Link>
          <p className="mt-2 text-muted-foreground">
            Create your account to get started.
          </p>
        </div>

        <div className="border-3 border-foreground bg-card p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
          <h1 className="mb-6 font-mono text-2xl font-black">Sign Up</h1>

          {/* User Type Selector */}
          <fieldset className="mb-6">
            <legend className="mb-2 block font-mono text-sm font-bold">I am a</legend>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Account type" onKeyDown={handleUserTypeKeyDown}>
              <button
                type="button"
                onClick={() => setUserType("tenant")}
                role="radio"
                aria-checked={userType === "tenant"}
                className={`border-3 border-foreground p-4 font-mono font-bold transition-all ${
                  userType === "tenant"
                    ? "bg-primary text-primary-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    : "bg-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                }`}
              >
                Tenant
              </button>
              <button
                type="button"
                onClick={() => setUserType("landlord")}
                role="radio"
                aria-checked={userType === "landlord"}
                className={`border-3 border-foreground p-4 font-mono font-bold transition-all ${
                  userType === "landlord"
                    ? "bg-primary text-primary-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    : "bg-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                }`}
              >
                Landlord
              </button>
            </div>
          </fieldset>

          {/* Whistleblower Option */}
          <div className="mb-6">
            <p className="text-xs text-muted-foreground mb-2">
              Or earn money reporting vacant apartments:
            </p>
            <Link href="/whistleblower/signup">
              <Button className="w-full border-3 border-foreground bg-secondary px-4 py-3 font-mono font-bold transition-all shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                Become a Whistleblower
              </Button>
            </Link>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="full-name" className="mb-2 block font-mono text-sm font-bold">
                Full Name
              </label>
              <Input
                id="full-name"
                type="text"
                value={formData.fullName}
                onChange={(e) => updateFormData("fullName", e.target.value)}
                placeholder="Enter your full name"
                className="border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                required
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-2 block font-mono text-sm font-bold">
                Email Address
              </label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => updateFormData("email", e.target.value)}
                placeholder="you@email.com"
                className="border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                required
              />
            </div>

            <div>
              <label htmlFor="phone" className="mb-2 block font-mono text-sm font-bold">
                Phone Number
              </label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => updateFormData("phone", e.target.value)}
                placeholder="08X XXX XXXX"
                className="border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block font-mono text-sm font-bold">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => updateFormData("password", e.target.value)}
                  placeholder="Create a password"
                  className="border-3 border-foreground py-6 pr-12 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {[
                  {
                    label: "At least 8 characters",
                    valid: formData.password.length >= 8,
                  },
                  {
                    label: "Contains a number",
                    valid: /\d/.test(formData.password),
                  },
                ].map((rule) => (
                  <div
                    key={rule.label}
                    className="flex items-center gap-2 text-xs"
                  >
                    <div
                      className={`h-4 w-4 border-2 border-foreground flex items-center justify-center ${rule.valid ? "bg-secondary" : "bg-background"}`}
                    >
                      {rule.valid && <Check className="h-3 w-3" />}
                    </div>
                    <span
                      className={
                        rule.valid ? "text-foreground" : "text-muted-foreground"
                      }
                    >
                      {rule.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 border-2 border-foreground accent-primary"
                  required
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
            </div>

            <Button
              type="submit"
              className={`w-full border-3 border-foreground px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${
                userType === "tenant" ? "bg-primary" : "bg-secondary"
              }`}
            >
              Create Account
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-bold text-primary hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
