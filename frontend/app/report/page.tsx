"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle, Loader2, AlertCircle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

const REPORT_TYPES = [
  { value: "fake_listing", label: "Fake Listing", description: "Property that doesn't exist or has false details" },
  { value: "fraudulent_landlord", label: "Fraudulent Landlord", description: "Landlord engaging in deceptive practices" },
  { value: "rent_scam", label: "Rent Scam", description: "Scam targeting tenants for advance fees" },
  { value: "other", label: "Other", description: "Any other housing-related fraud" },
];

type Step = "form" | "success";

export default function AnonymousReportPage() {
  const [step, setStep] = useState<Step>("form");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [referenceCode, setReferenceCode] = useState("");

  const [formData, setFormData] = useState({
    reportType: "",
    description: "",
    evidenceUrl: "",
    contactEmail: "",
  });

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    if (!formData.reportType || !formData.description) return;
    if (formData.description.trim().length < 20) {
      setServerError("Description must be at least 20 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, string> = {
        reportType: formData.reportType,
        description: formData.description.trim(),
      };
      if (formData.evidenceUrl.trim()) payload.evidenceUrl = formData.evidenceUrl.trim();
      if (formData.contactEmail.trim()) payload.contactEmail = formData.contactEmail.trim();

      const res = await fetch(`${API_BASE}/api/v1/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json() as { success?: boolean; referenceCode?: string; error?: { message?: string }; message?: string };

      if (!res.ok) {
        const msg =
          data?.error?.message ||
          data?.message ||
          (res.status === 429
            ? "Too many reports from this IP. Please try again later."
            : "Failed to submit report. Please try again.");
        setServerError(msg);
        return;
      }

      setReferenceCode(data.referenceCode || "");
      setStep("success");
    } catch {
      setServerError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main id="main-content" className="min-h-screen bg-background">
      <section className="border-b-3 border-foreground bg-muted py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-mono text-3xl font-black md:text-4xl">
                Report Housing Fraud
              </h1>
              <p className="text-muted-foreground mt-1">
                Anonymous & confidential — no account required
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-12">
        <div className="container mx-auto px-4 max-w-2xl">
          {step === "form" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="border-3 border-foreground bg-muted p-4 mb-6">
                <p className="text-sm font-bold mb-1 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Your privacy is protected
                </p>
                <p className="text-xs text-muted-foreground">
                  No login required. Contact email is optional and encrypted at rest if provided.
                  We only collect what you submit.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-bold mb-2" htmlFor="reportType">
                    Report Type <span className="text-primary">*</span>
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {REPORT_TYPES.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, reportType: type.value }))}
                        className={`border-2 border-foreground p-3 text-left transition-all ${
                          formData.reportType === type.value
                            ? "bg-foreground text-background"
                            : "bg-background hover:bg-muted"
                        }`}
                        aria-pressed={formData.reportType === type.value}
                      >
                        <p className="font-bold text-sm">{type.label}</p>
                        <p className={`text-xs mt-0.5 ${formData.reportType === type.value ? "text-background/70" : "text-muted-foreground"}`}>
                          {type.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold mb-2" htmlFor="description">
                    Description <span className="text-primary">*</span>
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder="Describe the fraud in detail. Include dates, amounts, property addresses, and any other relevant information. (Minimum 20 characters)"
                    className="w-full border-3 border-foreground px-3 py-3 bg-background font-medium min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-primary"
                    rows={5}
                    required
                    aria-describedby="description-hint"
                  />
                  <p id="description-hint" className="text-xs text-muted-foreground mt-1">
                    {formData.description.length}/20 minimum characters
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-bold mb-2" htmlFor="evidenceUrl">
                    Evidence URL{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Input
                    id="evidenceUrl"
                    type="url"
                    name="evidenceUrl"
                    value={formData.evidenceUrl}
                    onChange={handleInputChange}
                    placeholder="https://example.com/screenshot.png"
                    className="border-3 border-foreground py-3"
                    aria-describedby="evidence-hint"
                  />
                  <p id="evidence-hint" className="text-xs text-muted-foreground mt-1">
                    Link to a screenshot or document supporting your report
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-bold mb-2" htmlFor="contactEmail">
                    Contact Email{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Input
                    id="contactEmail"
                    type="email"
                    name="contactEmail"
                    value={formData.contactEmail}
                    onChange={handleInputChange}
                    placeholder="your@email.com"
                    className="border-3 border-foreground py-3"
                    aria-describedby="email-hint"
                  />
                  <p id="email-hint" className="text-xs text-muted-foreground mt-1">
                    Only used if we need to follow up. Encrypted at rest — never shared.
                  </p>
                </div>

                {serverError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 border-3 border-destructive bg-red-50 p-4"
                  >
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm font-bold text-destructive">{serverError}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting || !formData.reportType || formData.description.trim().length < 20}
                  className="w-full border-3 border-foreground bg-primary px-6 py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-60"
                  aria-label="Submit anonymous report"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    "Submit Anonymous Report"
                  )}
                </Button>
              </form>
            </Card>
          )}

          {step === "success" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="flex h-16 w-16 items-center justify-center border-3 border-foreground bg-secondary">
                    <CheckCircle className="h-10 w-10 text-green-600" />
                  </div>
                </div>
                <h2 className="text-3xl font-black mb-2">Report Submitted</h2>
                <p className="text-muted-foreground mb-6">
                  Thank you for helping keep the Lagos rental market safe.
                </p>

                <div className="border-3 border-foreground bg-muted p-4 mb-6">
                  <p className="text-sm font-bold mb-2">Your Reference Code</p>
                  <Badge className="font-mono text-2xl font-black border-3 border-foreground bg-primary px-6 py-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    {referenceCode}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-3">
                    Save this code to track your report status. Our team will review within 48 hours.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link href="/properties" className="flex-1">
                    <Button className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                      Browse Properties
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    className="flex-1 border-3 border-foreground bg-transparent font-bold"
                    onClick={() => {
                      setStep("form");
                      setFormData({ reportType: "", description: "", evidenceUrl: "", contactEmail: "" });
                      setReferenceCode("");
                    }}
                  >
                    Submit Another Report
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </section>
    </main>
  );
}
