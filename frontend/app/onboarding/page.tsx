"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Briefcase,
  FileText,
  Wallet,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  Loader2,
  SkipForward,
} from "lucide-react";
import { apiFetch, apiPost } from "@/lib/api";

const STEPS = [
  { id: "personal_info", label: "Personal Info", icon: User },
  { id: "employment_info", label: "Employment", icon: Briefcase },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "summary", label: "Summary", icon: CheckCircle },
] as const;

type StepId = (typeof STEPS)[number]["id"];

interface PersonalInfo {
  fullName: string;
  dateOfBirth: string;
  phone: string;
  residentialAddress: string;
  nin: string;
  bvn: string;
}

interface EmploymentInfo {
  employmentStatus: "employed" | "self_employed" | "unemployed" | "";
  employerName: string;
  monthlyIncome: string;
  proofOfEmploymentType: string;
}

interface Documents {
  bankStatementKey: string;
  proofOfIncomeKey: string;
  governmentIdKey: string;
}

interface WalletInfo {
  walletAddress: string;
  walletType: "stellar" | "freighter" | "";
  skipped: boolean;
}

interface FormData {
  personalInfo: PersonalInfo;
  employmentInfo: EmploymentInfo;
  documents: Documents;
  walletInfo: WalletInfo;
}

const defaultFormData: FormData = {
  personalInfo: {
    fullName: "",
    dateOfBirth: "",
    phone: "",
    residentialAddress: "",
    nin: "",
    bvn: "",
  },
  employmentInfo: {
    employmentStatus: "",
    employerName: "",
    monthlyIncome: "",
    proofOfEmploymentType: "",
  },
  documents: {
    bankStatementKey: "",
    proofOfIncomeKey: "",
    governmentIdKey: "",
  },
  walletInfo: {
    walletAddress: "",
    walletType: "",
    skipped: false,
  },
};

function validateStep(stepId: StepId, data: FormData): string[] {
  const errors: string[] = [];
  if (stepId === "personal_info") {
    const p = data.personalInfo;
    if (!p.fullName.trim()) errors.push("Full name is required");
    if (!p.dateOfBirth) errors.push("Date of birth is required");
    if (!p.phone.trim()) errors.push("Phone number is required");
    if (!p.residentialAddress.trim()) errors.push("Residential address is required");
  }
  if (stepId === "employment_info") {
    const e = data.employmentInfo;
    if (!e.employmentStatus) errors.push("Employment status is required");
  }
  return errors;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [savedStepIndex, setSavedStepIndex] = useState(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentStep = STEPS[currentStepIndex];
  const progressPercent = Math.round(
    ((currentStepIndex) / (STEPS.length - 1)) * 100
  );

  // Resume from last incomplete step on mount
  useEffect(() => {
    apiFetch<{ completedSteps: string[]; currentStep: string; submitted: boolean }>(
      "/api/onboarding/status"
    )
      .then((status) => {
        if (status.submitted) {
          setSubmitSuccess(true);
          return;
        }
        const idx = STEPS.findIndex((s) => s.id === status.currentStep);
        if (idx > 0) {
          setSavedStepIndex(idx);
          setShowResumePrompt(true);
        }
      })
      .catch(() => {
        // Not logged in or no draft — start from beginning
      });
  }, []);

  // Auto-save on field change with 1s debounce
  const autoSave = useCallback(
    (data: FormData) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          const payload: Record<string, unknown> = {};
          if (data.personalInfo.fullName || data.personalInfo.phone)
            payload.personalInfo = {
              ...data.personalInfo,
              nin: data.personalInfo.nin || undefined,
              bvn: data.personalInfo.bvn || undefined,
            };
          if (data.employmentInfo.employmentStatus)
            payload.employmentInfo = {
              ...data.employmentInfo,
              employerName: data.employmentInfo.employerName || undefined,
              monthlyIncome: data.employmentInfo.monthlyIncome
                ? Number(data.employmentInfo.monthlyIncome)
                : undefined,
              proofOfEmploymentType:
                data.employmentInfo.proofOfEmploymentType || undefined,
            };
          if (
            data.documents.bankStatementKey ||
            data.documents.proofOfIncomeKey ||
            data.documents.governmentIdKey
          )
            payload.documents = data.documents;
          if (data.walletInfo.skipped || data.walletInfo.walletAddress)
            payload.walletInfo = {
              walletAddress: data.walletInfo.walletAddress || undefined,
              walletType: data.walletInfo.walletType || undefined,
              skipped: data.walletInfo.skipped,
            };

          if (Object.keys(payload).length > 0) {
            await apiPost("/api/onboarding/draft", payload);
          }
        } catch {
          // Silent fail for auto-save
        } finally {
          setIsSaving(false);
        }
      }, 1000);
    },
    []
  );

  function updateField<K extends keyof FormData>(
    section: K,
    field: keyof FormData[K],
    value: string | boolean
  ) {
    setFormData((prev) => {
      const updated = {
        ...prev,
        [section]: { ...(prev[section] as object), [field]: value },
      };
      autoSave(updated);
      return updated;
    });
  }

  function goNext() {
    const errs = validateStep(currentStep.id, formData);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStepIndex((i) => i + 1);
    }
  }

  function goBack() {
    setErrors([]);
    if (currentStepIndex > 0) setCurrentStepIndex((i) => i - 1);
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    try {
      await apiPost("/api/onboarding/submit", {});
      setSubmitSuccess(true);
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : "Submission failed"]);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (showResumePrompt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full p-8">
          <h1 className="text-xl font-bold mb-2">Resume your application?</h1>
          <p className="text-gray-600 mb-6">
            You have an application in progress at step{" "}
            <strong>{STEPS[savedStepIndex]?.label}</strong>. Would you like to
            continue where you left off, or start over?
          </p>
          <div className="flex gap-3">
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                setCurrentStepIndex(savedStepIndex);
                setShowResumePrompt(false);
              }}
            >
              Resume
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setFormData(defaultFormData);
                setCurrentStepIndex(0);
                setShowResumePrompt(false);
              }}
            >
              Start over
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (submitSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Assessment in progress</h1>
          <p className="text-gray-600 mb-6">
            Your profile has been submitted. We are reviewing your information
            and will notify you of the outcome shortly.
          </p>
          <Button onClick={() => router.push("/dashboard/tenant")}>
            Back to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Complete your profile
          </h1>
          <p className="text-gray-500 mt-1">
            Step {currentStepIndex + 1} of {STEPS.length}
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <Progress value={progressPercent} className="h-2" />
          <div className="flex justify-between mt-2">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isDone = idx < currentStepIndex;
              const isActive = idx === currentStepIndex;
              return (
                <div
                  key={step.id}
                  className={`flex flex-col items-center gap-1 ${idx > currentStepIndex ? "opacity-40" : ""}`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm
                      ${isActive ? "bg-blue-600 text-white" : isDone ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"}`}
                  >
                    {isDone ? <CheckCircle className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span className="text-xs text-gray-500 hidden sm:block">
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <ul className="text-sm text-red-700 space-y-0.5">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Step content */}
        <Card className="p-6 mb-6">
          {currentStep.id === "personal_info" && (
            <PersonalInfoStep
              data={formData.personalInfo}
              onChange={(f, v) => updateField("personalInfo", f, v)}
            />
          )}
          {currentStep.id === "employment_info" && (
            <EmploymentStep
              data={formData.employmentInfo}
              onChange={(f, v) => updateField("employmentInfo", f, v)}
            />
          )}
          {currentStep.id === "documents" && (
            <DocumentsStep
              data={formData.documents}
              onChange={(f, v) => updateField("documents", f, v)}
            />
          )}
          {currentStep.id === "wallet" && (
            <WalletStep
              data={formData.walletInfo}
              onChange={(f, v) => updateField("walletInfo", f, v)}
              onSkip={() => {
                updateField("walletInfo", "skipped", true);
                setCurrentStepIndex((i) => i + 1);
              }}
            />
          )}
          {currentStep.id === "summary" && (
            <SummaryStep data={formData} />
          )}
        </Card>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={goBack}
            disabled={currentStepIndex === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>

          <div className="flex items-center gap-2">
            {isSaving && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving…
              </span>
            )}
            {currentStep.id === "summary" ? (
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Submit for Assessment"
                )}
              </Button>
            ) : (
              <Button onClick={goNext} className="bg-blue-600 hover:bg-blue-700">
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Step sub-components ----

function PersonalInfoStep({
  data,
  onChange,
}: {
  data: PersonalInfo;
  onChange: (f: keyof PersonalInfo, v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Personal Information</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Full Name <span className="text-red-500">*</span>
          </label>
          <Input
            value={data.fullName}
            onChange={(e) => onChange("fullName", e.target.value)}
            placeholder="John Doe"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date of Birth <span className="text-red-500">*</span>
          </label>
          <Input
            type="date"
            value={data.dateOfBirth}
            onChange={(e) => onChange("dateOfBirth", e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Phone <span className="text-red-500">*</span>
          </label>
          <Input
            type="tel"
            value={data.phone}
            onChange={(e) => onChange("phone", e.target.value)}
            placeholder="+234 800 000 0000"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            NIN <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <Input
            type="password"
            value={data.nin}
            onChange={(e) => onChange("nin", e.target.value)}
            placeholder="••••••••••••"
            autoComplete="off"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Residential Address <span className="text-red-500">*</span>
          </label>
          <Input
            value={data.residentialAddress}
            onChange={(e) => onChange("residentialAddress", e.target.value)}
            placeholder="123 Main Street, Lagos"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            BVN <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <Input
            type="password"
            value={data.bvn}
            onChange={(e) => onChange("bvn", e.target.value)}
            placeholder="••••••••••••"
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}

function EmploymentStep({
  data,
  onChange,
}: {
  data: EmploymentInfo;
  onChange: (f: keyof EmploymentInfo, v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Employment & Income</h2>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Employment Status <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-3 flex-wrap">
          {(["employed", "self_employed", "unemployed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange("employmentStatus", s)}
              className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors
                ${data.employmentStatus === s
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-gray-300 text-gray-700 hover:border-blue-400"
                }`}
            >
              {s === "self_employed" ? "Self-Employed" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {data.employmentStatus !== "unemployed" && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Employer / Business Name
            </label>
            <Input
              value={data.employerName}
              onChange={(e) => onChange("employerName", e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Monthly Income (NGN)
            </label>
            <Input
              type="number"
              value={data.monthlyIncome}
              onChange={(e) => onChange("monthlyIncome", e.target.value)}
              placeholder="150000"
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Proof of Employment Type
            </label>
            <Input
              value={data.proofOfEmploymentType}
              onChange={(e) => onChange("proofOfEmploymentType", e.target.value)}
              placeholder="e.g. Pay slip, Employment letter"
            />
          </div>
        </>
      )}
    </div>
  );
}

function DocumentsStep({
  data,
  onChange,
}: {
  data: Documents;
  onChange: (f: keyof Documents, v: string) => void;
}) {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

  function handleFileChange(
    field: keyof Documents,
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert("File must be under 10 MB");
      e.target.value = "";
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      alert("Only PDF and image files are accepted");
      e.target.value = "";
      return;
    }
    // Store filename as key (actual upload handled by storage integration)
    onChange(field, file.name);
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">Document Upload</h2>
      <p className="text-sm text-gray-500">
        Upload PDF or image files. Maximum 10 MB per file.
      </p>
      {(
        [
          { field: "bankStatementKey" as const, label: "Bank Statement (last 3 months)", required: false },
          { field: "proofOfIncomeKey" as const, label: "Proof of Income (pay slip or business bank statement)", required: false },
          { field: "governmentIdKey" as const, label: "Government-Issued ID", required: false },
        ]
      ).map(({ field, label }) => (
        <div key={field}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => handleFileChange(field, e)}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {data[field] && (
            <p className="text-xs text-green-600 mt-1">✓ {data[field]}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function WalletStep({
  data,
  onChange,
  onSkip,
}: {
  data: WalletInfo;
  onChange: (f: keyof WalletInfo, v: string | boolean) => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Wallet Connection</h2>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <strong>Why connect a wallet?</strong> A Stellar wallet lets you pay
        rent in USDC, earn staking rewards, and access on-chain lease records.
        This step is optional.
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Wallet Type
        </label>
        <div className="flex gap-3">
          {(["stellar", "freighter"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange("walletType", t)}
              className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors
                ${data.walletType === t
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-gray-300 text-gray-700 hover:border-blue-400"}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {data.walletType && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Wallet Address
          </label>
          <Input
            value={data.walletAddress}
            onChange={(e) => onChange("walletAddress", e.target.value)}
            placeholder="G..."
            className="font-mono text-sm"
          />
        </div>
      )}
      <Button
        variant="outline"
        onClick={onSkip}
        className="w-full text-gray-500"
      >
        <SkipForward className="w-4 h-4 mr-2" />
        Skip this step
      </Button>
    </div>
  );
}

function SummaryStep({ data }: { data: FormData }) {
  const p = data.personalInfo;
  const e = data.employmentInfo;
  const d = data.documents;
  const w = data.walletInfo;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">Review Your Information</h2>
      <div className="space-y-4">
        <Section title="Personal Info">
          <Row label="Full Name" value={p.fullName} />
          <Row label="Date of Birth" value={p.dateOfBirth} />
          <Row label="Phone" value={p.phone} />
          <Row label="Address" value={p.residentialAddress} />
          <Row label="NIN" value={p.nin ? "Provided" : "—"} />
          <Row label="BVN" value={p.bvn ? "Provided" : "—"} />
        </Section>
        <Section title="Employment">
          <Row
            label="Status"
            value={e.employmentStatus || "—"}
          />
          {e.employerName && <Row label="Employer" value={e.employerName} />}
          {e.monthlyIncome && (
            <Row
              label="Monthly Income"
              value={`₦${Number(e.monthlyIncome).toLocaleString()}`}
            />
          )}
        </Section>
        <Section title="Documents">
          <Row label="Bank Statement" value={d.bankStatementKey || "Not uploaded"} />
          <Row label="Proof of Income" value={d.proofOfIncomeKey || "Not uploaded"} />
          <Row label="Government ID" value={d.governmentIdKey || "Not uploaded"} />
        </Section>
        <Section title="Wallet">
          {w.skipped ? (
            <p className="text-sm text-gray-500">Skipped</p>
          ) : w.walletAddress ? (
            <Row label="Address" value={`${w.walletAddress.slice(0, 8)}…`} />
          ) : (
            <p className="text-sm text-gray-500">Not connected</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium truncate ml-4 max-w-[60%] text-right">
        {value || "—"}
      </span>
    </div>
  );
}
