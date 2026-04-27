"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader } from "@/components/dashboard-header";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Save } from "lucide-react";
import { TenantOnboardingData, saveOnboardingProgress, submitOnboarding, getOnboardingProgress } from "@/lib/tenantApi";
import { IdentityStep } from "./components/IdentityStep";
import { DocumentStep } from "./components/DocumentStep";
import { WalletStep } from "./components/WalletStep";
import { NotificationsStep } from "./components/NotificationsStep";
import { SummaryStep } from "./components/SummaryStep";
import { toast } from "sonner";

const STEPS = [
  { id: 1, title: "Identity", description: "Personal info" },
  { id: 2, title: "Documents", description: "Verification" },
  { id: 3, title: "Wallet", description: "Link wallet" },
  { id: 4, title: "Alerts", description: "Preferences" },
  { id: 5, title: "Review", description: "Final check" },
];

const INITIAL_DATA: TenantOnboardingData = {
  identity: { fullName: "", occupation: "", email: "", phone: "", address: "" },
  kyc: { documentType: "nin", status: "pending" },
  wallet: { address: "", connected: false },
  notifications: { paymentReminders: true, paymentConfirmations: true, leaseUpdates: true, messages: true },
  currentStep: 1,
};

export default function TenantOnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<TenantOnboardingData>(INITIAL_DATA);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadProgress = async () => {
      try {
        // Try local storage first for speed
        const localData = localStorage.getItem("tenant_onboarding_progress");
        if (localData) {
          const parsed = JSON.parse(localData);
          setFormData(parsed);
          setCurrentStep(parsed.currentStep || 1);
        }

        // Then sync with backend if available
        const response = await getOnboardingProgress();
        if (response.success && response.data) {
          setFormData(response.data);
          setCurrentStep(response.data.currentStep || 1);
        }
      } catch (err) {
        console.error("Failed to load onboarding progress:", err);
      } finally {
        setLoading(false);
      }
    };

    loadProgress();
  }, []);

  // Persist to local storage on every change
  useEffect(() => {
    if (!loading) {
      localStorage.setItem("tenant_onboarding_progress", JSON.stringify({ ...formData, currentStep }));
    }
  }, [formData, currentStep, loading]);

  const validateStep = (step: number) => {
    const newErrors: Record<string, string> = {};
    
    if (step === 1) {
      if (!formData.identity.fullName) newErrors.fullName = "Full name is required";
      if (!formData.identity.email) newErrors.email = "Email is required";
      if (!formData.identity.phone) newErrors.phone = "Phone number is required";
      if (!formData.identity.address) newErrors.address = "Address is required";
    } else if (step === 2) {
      if (!formData.kyc.documentType) newErrors.documentType = "Document type is required";
      if (!formData.kyc.documentUrl) newErrors.documentUrl = "Please upload a document";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = async () => {
    if (validateStep(currentStep)) {
      if (currentStep < STEPS.length) {
        setIsSaving(true);
        try {
          await saveOnboardingProgress({ ...formData, currentStep: currentStep + 1 });
          setCurrentStep(currentStep + 1);
        } catch (err) {
          toast.error("Failed to save progress, but you can continue.");
          setCurrentStep(currentStep + 1);
        } finally {
          setIsSaving(false);
        }
      } else {
        handleComplete();
      }
    } else {
      toast.error("Please fix errors before proceeding");
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    setIsSaving(true);
    try {
      await submitOnboarding(formData);
      localStorage.removeItem("tenant_onboarding_progress");
      toast.success("Onboarding completed successfully!");
      router.push("/dashboard/tenant");
    } catch (err) {
      toast.error("Failed to submit onboarding. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  const progress = (currentStep / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-background pb-20">
      <DashboardHeader />

      <main className="mx-auto max-w-4xl px-4 pt-28">
        {/* Progress Header */}
        <div className="mb-12 space-y-6">
          <div className="flex items-end justify-between">
            <div className="space-y-1">
              <p className="text-sm font-bold text-primary uppercase tracking-widest">Step {currentStep} of {STEPS.length}</p>
              <h1 className="text-4xl font-black text-foreground uppercase tracking-tight">
                {STEPS[currentStep - 1].title}
              </h1>
            </div>
            <div className="text-right hidden md:block">
              <p className="text-sm font-bold text-muted-foreground uppercase">Overall Progress</p>
              <p className="text-2xl font-black">{Math.round(progress)}%</p>
            </div>
          </div>
          <div className="relative h-4 w-full border-3 border-foreground bg-muted shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div 
              className="h-full bg-primary transition-all duration-500 ease-in-out" 
              style={{ width: `${progress}%` }} 
            />
          </div>
          
          {/* Step Indicators */}
          <div className="hidden md:grid grid-cols-5 gap-2">
            {STEPS.map((step) => (
              <div key={step.id} className="space-y-2">
                <div className={`h-1 border-2 ${currentStep >= step.id ? "border-foreground bg-primary" : "border-muted-foreground/30 bg-muted"}`} />
                <p className={`text-[10px] font-black uppercase ${currentStep >= step.id ? "text-foreground" : "text-muted-foreground"}`}>
                  {step.title}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="mb-12 min-h-[400px]">
          {currentStep === 1 && (
            <IdentityStep 
              data={formData.identity} 
              updateData={(data) => setFormData({ ...formData, identity: { ...formData.identity, ...data } })}
              errors={errors}
            />
          )}
          {currentStep === 2 && (
            <DocumentStep 
              data={formData.kyc} 
              updateData={(data) => setFormData({ ...formData, kyc: { ...formData.kyc, ...data } })}
              errors={errors}
            />
          )}
          {currentStep === 3 && (
            <WalletStep 
              data={formData.wallet} 
              updateData={(data) => setFormData({ ...formData, wallet: { ...formData.wallet, ...data } })}
              errors={errors}
            />
          )}
          {currentStep === 4 && (
            <NotificationsStep 
              data={formData.notifications} 
              updateData={(data) => setFormData({ ...formData, notifications: { ...formData.notifications, ...data } })}
            />
          )}
          {currentStep === 5 && <SummaryStep data={formData} />}
        </div>

        {/* Navigation Footer */}
        <div className="fixed bottom-0 left-0 right-0 border-t-3 border-foreground bg-background p-4 md:p-6 z-50">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 1 || isSaving}
              className="border-3 border-foreground bg-card px-8 py-6 text-lg font-bold transition-all hover:bg-muted"
            >
              <ArrowLeft className="mr-2 h-5 w-5" /> Back
            </Button>

            <div className="flex gap-4">
              <Button
                variant="ghost"
                onClick={() => {
                  saveOnboardingProgress({ ...formData, currentStep });
                  toast.success("Progress saved locally and to cloud!");
                }}
                disabled={isSaving}
                className="hidden md:flex border-3 border-transparent hover:border-foreground font-bold"
              >
                <Save className="mr-2 h-4 w-4" /> Save & Exit
              </Button>
              
              <Button
                onClick={handleNext}
                disabled={isSaving}
                className="border-3 border-foreground bg-primary px-10 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
              >
                {isSaving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : currentStep === STEPS.length ? (
                  <>Complete Onboarding <CheckCircle2 className="ml-2 h-5 w-5" /></>
                ) : (
                  <>Next Step <ArrowRight className="ml-2 h-5 w-5" /></>
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
