"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { ArrowLeft, ArrowRight, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EligibilityResultCard } from "@/components/prescreener/EligibilityResultCard"
import { calculateAffordability, type EmploymentStatus, type EligibilityBand } from "@/lib/affordabilityCalc"
import { useDraftPersist } from "@/hooks/useDraftPersist"
import { useAppForm } from "@/hooks/useAppForm"
import { preScreenSchema, type PreScreenFormValues } from "@/lib/formSchemas"

const EMPLOYMENT_OPTIONS: { value: EmploymentStatus; label: string }[] = [
  { value: "employed", label: "Employed (Full-time)" },
  { value: "self-employed", label: "Self-Employed" },
  { value: "contract", label: "Contract / Freelance" },
  { value: "student", label: "Student" },
]

const EMPLOYMENT_LABELS: Record<EmploymentStatus, string> = {
  employed: "High",
  "self-employed": "Medium",
  contract: "Medium",
  student: "Low",
}

const TOTAL_STEPS = 3

interface PreScreenDraft {
  step: number
  formData: PreScreenFormValues
}

const DRAFT_KEY = "prescreen_draft"

export function PreScreenClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const listingPrice = searchParams.get("listingPrice")
  const stepParam = searchParams.get("step")
  
  const initialStep = stepParam ? parseInt(stepParam, 10) : 1
  const [step, setStep] = useState(initialStep)
  const [result, setResult] = useState<{
    band: EligibilityBand
    incomePass: boolean
    depositPass: boolean
  } | null>(null)
  const [showResumePrompt, setShowResumePrompt] = useState(false)
  const [stepChangeAnnouncement, setStepChangeAnnouncement] = useState("")
  const previousStepRef = useRef(step)

  const { save, load, clear } = useDraftPersist<PreScreenDraft>(DRAFT_KEY)

  // Initialize form with default values
  const defaultValues: PreScreenFormValues = {
    monthlyNetIncome: "",
    monthlyRent: listingPrice ? String(parseFloat(listingPrice) / 12) : "",
    employmentStatus: "employed",
    depositPercentage: 10,
  }

  const form = useAppForm<PreScreenFormValues>({
    schema: preScreenSchema,
    draftKey: DRAFT_KEY,
    defaultValues: defaultValues as any,
  })

  const { watch, setValue, trigger, formState: { errors }, clearErrors } = form

  const formData = watch()

  // Sync step with URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (step <= TOTAL_STEPS) {
      params.set("step", step.toString())
    } else {
      params.delete("step")
    }
    const newUrl = `${pathname}?${params.toString()}`
    if (newUrl !== `${pathname}?${searchParams.toString()}`) {
      router.replace(newUrl)
    }
  }, [step, searchParams, pathname, router])

  // Announce step changes to screen readers
  useEffect(() => {
    if (step !== previousStepRef.current) {
      setStepChangeAnnouncement(`Step ${step} of ${TOTAL_STEPS}`)
      previousStepRef.current = step
      // Clear announcement after it's been read
      setTimeout(() => setStepChangeAnnouncement(""), 1000)
    }
  }, [step])

  // Load draft on mount and offer resume
  useEffect(() => {
    const draft = load()
    if (draft && draft.step > 1) {
      setShowResumePrompt(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyDraft = (draft: PreScreenDraft) => {
    setStep(draft.step)
    Object.entries(draft.formData).forEach(([key, value]) => {
      setValue(key as keyof PreScreenFormValues, value as any)
    })
  }

  const handleResume = () => {
    const draft = load()
    if (draft) applyDraft(draft)
    setShowResumePrompt(false)
  }

  const handleStartOver = () => {
    clear()
    clearErrors()
    form.reset(defaultValues)
    setShowResumePrompt(false)
    setStep(1)
  }

  const saveDraft = () => {
    const current: PreScreenDraft = {
      step,
      formData,
    }
    save(current)
  }

  // Auto-save draft on form changes
  useEffect(() => {
    saveDraft()
  }, [formData, step]) // eslint-disable-line react-hooks/exhaustive-deps

  const parsedRent = useMemo(
    () => parseFloat(formData.monthlyRent) || (listingPrice ? parseFloat(listingPrice) / 12 : 0),
    [formData.monthlyRent, listingPrice],
  )
  const parsedIncome = useMemo(() => parseFloat(formData.monthlyNetIncome) || 0, [formData.monthlyNetIncome])

  const incomePass =
    parsedIncome > 0 && parsedRent > 0 ? parsedRent / parsedIncome <= 0.4 : null

  const validateStep = async (currentStep: number) => {
    let isValid = false
    
    switch (currentStep) {
      case 1:
        isValid = await trigger(["monthlyNetIncome", "monthlyRent"])
        if (!isValid) {
          // Focus first error field
          if (errors.monthlyNetIncome) {
            document.getElementById("income")?.focus()
          } else if (errors.monthlyRent) {
            document.getElementById("rent")?.focus()
          }
        }
        break
      case 2:
        isValid = await trigger("employmentStatus")
        if (!isValid) {
          document.getElementById("employment-status")?.focus()
        }
        break
      case 3:
        isValid = await trigger("depositPercentage")
        break
    }
    
    return isValid
  }

  const handleNext = async () => {
    const isValid = await validateStep(step)
    if (isValid) {
      setStep((prev) => Math.min(prev + 1, TOTAL_STEPS))
    }
  }

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 1))
  }

  const handleSubmit = async () => {
    const isValid = await validateStep(step)
    if (!isValid || !formData.employmentStatus) return
    
    const calc = calculateAffordability({
      monthlyNetIncome: parsedIncome,
      monthlyRent: parsedRent,
      employmentStatus: formData.employmentStatus,
      depositPercentage: formData.depositPercentage,
      minDepositRequired: 20,
    })
    setResult({ band: calc.overallBand, incomePass: calc.incomePass, depositPass: calc.depositPass })
    clear()
    clearErrors()
    form.reset(defaultValues)
    setStep(4)
  }

  if (showResumePrompt) {
    return (
      <main className="min-h-screen bg-background">
        <div className="container mx-auto max-w-lg px-4 py-12">
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <h2 className="text-lg font-black mb-2">Resume your pre-screen?</h2>
            <p className="text-sm text-muted-foreground mb-6">
              You have a saved pre-screen in progress. Would you like to continue where you left off,
              or start fresh?
            </p>
            <div className="flex gap-3">
              <Button
                onClick={handleResume}
                className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all"
              >
                Resume
              </Button>
              <Button
                variant="outline"
                onClick={handleStartOver}
                className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all"
              >
                Start over
              </Button>
            </div>
          </Card>
        </div>
      </main>
    )
  }

  if (result) {
    return (
      <main className="min-h-screen bg-background">
        <div className="container mx-auto max-w-lg px-4 py-12">
          <EligibilityResultCard
            band={result.band}
            incomePass={result.incomePass}
            employmentLabel={formData.employmentStatus ? EMPLOYMENT_LABELS[formData.employmentStatus] : ""}
            depositPass={result.depositPass}
            onReset={() => {
              setStep(1)
              setResult(null)
              clearErrors()
              form.reset(defaultValues)
            }}
          />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto max-w-lg px-4 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-black">Rent Affordability Pre-Screener</h1>
          <p className="text-sm text-muted-foreground mt-2">
            See if you qualify before you apply. This takes about 30 seconds.
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-muted-foreground">
              Step {step} of {TOTAL_STEPS}
            </h2>
            <div className="text-sm font-bold text-muted-foreground">
              {Math.round((step / TOTAL_STEPS) * 100)}% complete
            </div>
          </div>
          <div className="flex items-center gap-2" aria-label="Progress" role="group">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`h-8 w-8 border-2 border-foreground flex items-center justify-center text-sm font-bold ${
                    step > s ? "bg-primary" : step === s ? "bg-card" : "bg-muted"
                  }`}
                  aria-current={step === s ? "step" : undefined}
                  aria-label={`Step ${s}${step > s ? " (completed)" : step === s ? " (current)" : ""}`}
                  tabIndex={-1}
                >
                  {step > s ? <Check className="h-4 w-4" aria-hidden="true" /> : s}
                </div>
                {s < TOTAL_STEPS && <div className={`h-0.5 w-8 ${step > s ? "bg-primary" : "bg-muted"}`} aria-hidden="true" />}
              </div>
            ))}
          </div>
          {/* Screen reader announcement for step changes */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {stepChangeAnnouncement}
          </div>
        </div>

        <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-black">Income Check</h2>
                <p className="text-sm text-muted-foreground mt-1">Enter your monthly income to check affordability.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-bold block mb-1" htmlFor="income">
                    Monthly Net Income (NGN)
                  </label>
                  <input
                    id="income"
                    type="number"
                    min="0"
                    placeholder="e.g. 500000"
                    value={formData.monthlyNetIncome}
                    onChange={(e) => setValue("monthlyNetIncome", e.target.value)}
                    className={`w-full border-2 border-foreground bg-background px-3 py-2 text-sm ${
                      errors.monthlyNetIncome ? "border-destructive" : ""
                    }`}
                    aria-describedby={errors.monthlyNetIncome ? "income-error" : incomePass !== null ? "income-feedback" : undefined}
                    aria-invalid={!!errors.monthlyNetIncome}
                  />
                  {errors.monthlyNetIncome && (
                    <p id="income-error" className="text-sm text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                      {errors.monthlyNetIncome.message}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-bold block mb-1" htmlFor="rent">
                    Expected Monthly Rent (NGN)
                    {listingPrice && (
                      <span className="font-normal text-muted-foreground"> (pre-filled from listing)</span>
                    )}
                  </label>
                  <input
                    id="rent"
                    type="number"
                    min="0"
                    placeholder="e.g. 150000"
                    value={formData.monthlyRent}
                    onChange={(e) => setValue("monthlyRent", e.target.value)}
                    className={`w-full border-2 border-foreground bg-background px-3 py-2 text-sm ${
                      errors.monthlyRent ? "border-destructive" : ""
                    }`}
                    aria-describedby={errors.monthlyRent ? "rent-error" : undefined}
                    aria-invalid={!!errors.monthlyRent}
                  />
                  {errors.monthlyRent && (
                    <p id="rent-error" className="text-sm text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                      {errors.monthlyRent.message}
                    </p>
                  )}
                </div>

                {incomePass !== null && (
                  <div
                    id="income-feedback"
                    role="status"
                    aria-live="polite"
                    className={`border-2 border-foreground p-3 ${incomePass ? "bg-green-50" : "bg-destructive/10"}`}
                  >
                    <p className={`text-sm font-bold ${incomePass ? "text-green-700" : "text-destructive"}`}>
                      {incomePass
                        ? "Pass — Your rent is within the recommended threshold."
                        : "Fail — Your rent exceeds 40% of your net income."}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Recommended: Rent should not exceed 40% of your monthly net income.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleNext}
                  disabled={!formData.monthlyNetIncome || !formData.monthlyRent}
                  className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all disabled:opacity-50"
                  aria-describedby="step-1-next-help"
                >
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
                <span id="step-1-next-help" className="sr-only">
                  Proceeds to employment status step after validating income and rent fields
                </span>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-black">Employment Status</h2>
                <p className="text-sm text-muted-foreground mt-1">Select your current employment situation.</p>
              </div>

              <div className="space-y-2" role="radiogroup" aria-label="Employment status" aria-required="true">
                {EMPLOYMENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={formData.employmentStatus === opt.value}
                    onClick={() => setValue("employmentStatus", opt.value)}
                    className={`w-full text-left border-2 border-foreground p-3 text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2 ${
                      formData.employmentStatus === opt.value
                        ? "bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                        : "bg-card hover:bg-muted"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {errors.employmentStatus && (
                <p id="employment-error" className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  {errors.employmentStatus.message}
                </p>
              )}

              {formData.employmentStatus && (
                <div className="border-2 border-foreground p-3 bg-muted" aria-live="polite">
                  <p className="text-sm">
                    Likelihood band: <span className="font-bold">{EMPLOYMENT_LABELS[formData.employmentStatus]}</span>
                  </p>
                </div>
              )}

              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <Button
                  onClick={handleNext}
                  disabled={!formData.employmentStatus}
                  className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all disabled:opacity-50"
                >
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-black">Deposit Readiness</h2>
                <p className="text-sm text-muted-foreground mt-1">How much upfront deposit can you put down?</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-bold block mb-1" htmlFor="deposit-range">
                    Available Deposit: <span className="text-primary">{formData.depositPercentage}%</span>
                  </label>
                  <input
                    id="deposit-range"
                    type="range"
                    min="0"
                    max="100"
                    value={formData.depositPercentage}
                    onChange={(e) => setValue("depositPercentage", parseInt(e.target.value, 10))}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={formData.depositPercentage}
                    aria-valuetext={`${formData.depositPercentage}%`}
                    className="w-full focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1" aria-hidden="true">
                    <span>0%</span>
                    <span>Minimum: 20%</span>
                    <span>100%</span>
                  </div>
                </div>
                {errors.depositPercentage && (
                  <p id="deposit-error" className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    {errors.depositPercentage.message}
                  </p>
                )}

                <div
                  role="status"
                  aria-live="polite"
                  className={`border-2 border-foreground p-3 ${formData.depositPercentage >= 20 ? "bg-green-50" : "bg-destructive/10"}`}
                >
                  <p className={`text-sm font-bold ${formData.depositPercentage >= 20 ? "text-green-700" : "text-destructive"}`}>
                    {formData.depositPercentage >= 20
                      ? "Pass — Your deposit meets the minimum requirement."
                      : "Fail — Most listings require at least 20% deposit."}
                  </p>
                </div>
              </div>

              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all"
                >
                  See Results
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </main>
  )
}
