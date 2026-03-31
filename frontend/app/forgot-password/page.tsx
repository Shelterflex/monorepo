"use client"

import React, { useState } from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault()
    // Handle password reset request
    setIsSubmitted(true)
  }

  return (
    <main className="min-h-screen bg-muted flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block font-mono text-3xl font-black">
            SHELTER<span className="text-primary">FLEX</span>
          </Link>
          <p className="mt-2 text-muted-foreground">Reset your password</p>
        </div>

        <div className="border-3 border-foreground bg-card p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
          {isSubmitted ? (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center border-3 border-foreground bg-secondary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <CheckCircle className="h-8 w-8" />
              </div>
              <h1 className="mb-2 font-mono text-2xl font-black">Check Your Email</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                We have sent a password reset link to <strong className="text-foreground">{email}</strong>.
                Please check your inbox and follow the instructions.
              </p>
              <p className="text-xs text-muted-foreground mb-6">
                Did not receive the email? Check your spam folder or{" "}
                <button
                  onClick={() => setIsSubmitted(false)}
                  className="font-bold text-primary hover:underline"
                >
                  try again
                </button>
              </p>
            </div>
          ) : (
            <>
              <h1 className="mb-2 font-mono text-2xl font-black">Forgot Password?</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                No worries! Enter your email address and we will send you a link to reset your password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="email" className="mb-2 block font-mono text-sm font-bold">Email Address</label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    className="border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  Send Reset Link
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 text-center">
            <Link 
              href="/login" 
              className="inline-flex items-center gap-2 font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Sign In
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>
            Remember your password?{" "}
            <Link href="/login" className="font-bold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
