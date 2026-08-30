"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { Loader2, Upload, File as FileIcon, X, CheckCircle2 } from "lucide-react";
import { OnboardingStepIndicator } from "@/components/inspector/OnboardingStepIndicator";
import { ServiceAreaPicker } from "@/components/inspector/ServiceAreaPicker";
import { useForm, Controller } from "react-hook-form";

type PersonalInfo = {
  fullName: string;
  phone: string;
  email: string;
  experience: string;
  background: string;
};

type KYCFile = {
  file: File;
  previewUrl: string;
} | null;

type KYCInfo = {
  nin: string;
  passport: KYCFile;
  driverLicense: KYCFile;
};

type BankDetails = {
  bankName: string;
  accountNumber: string;
  accountName: string;
  isVerified: boolean;
};

type OnboardingState = {
  personalInfo: PersonalInfo;
  kyc: Omit<KYCInfo, "passport" | "driverLicense">; // We won't persist actual File objects to localStorage easily
  serviceAreas: string[];
  bankDetails: BankDetails;
};

const DEFAULT_STATE: OnboardingState = {
  personalInfo: { fullName: "", phone: "", email: "", experience: "", background: "" },
  kyc: { nin: "" },
  serviceAreas: [],
  bankDetails: { bankName: "", accountNumber: "", accountName: "", isVerified: false },
};

function InspectorOnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepParam = searchParams.get("step");
  const currentStep = stepParam ? parseInt(stepParam) : 1;

  const [isLoaded, setIsLoaded] = useState(false);
  const [formData, setFormData] = useState<OnboardingState>(DEFAULT_STATE);
  
  // Local volatile state for files (since they can't be easily put in localStorage)
  const [passportFile, setPassportFile] = useState<KYCFile>(null);
  const [driverLicenseFile, setDriverLicenseFile] = useState<KYCFile>(null);

  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [isVerifyingBank, setIsVerifyingBank] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("inspector_onboarding");
    if (saved) {
      try {
        setFormData(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved state");
      }
    }
    
    fetch("/data/ng-banks.json")
      .then((res) => res.json())
      .then((data) => setBanks(data))
      .catch((err) => console.error("Failed to load banks", err));
      
    setIsLoaded(true);
  }, []);

  // Save state to localStorage on change
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem("inspector_onboarding", JSON.stringify(formData));
    }
  }, [formData, isLoaded]);

  const goToStep = useCallback((step: number) => {
    router.push(`/onboarding/inspector?step=${step}`);
  }, [router]);

  const updateFormData = (key: keyof OnboardingState, data: any) => {
    setFormData((prev) => ({ ...prev, [key]: data }));
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<KYCFile>>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size exceeds 5MB limit");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setter({ file, previewUrl });
  };

  const verifyBank = async () => {
    if (!formData.bankDetails.bankName || formData.bankDetails.accountNumber.length < 10) {
      toast.error("Please enter bank name and 10-digit account number");
      return;
    }

    setIsVerifyingBank(true);
    try {
      const response = await fetch("/api/landlord/payout/verify-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankName: formData.bankDetails.bankName,
          accountNumber: formData.bankDetails.accountNumber,
        }),
      });

      if (!response.ok) throw new Error("Verification failed");

      const data = await response.json();
      updateFormData("bankDetails", {
        ...formData.bankDetails,
        accountName: data.accountName,
        isVerified: true,
      });
      toast.success("Bank account verified");
    } catch (error) {
      toast.error("Failed to verify bank account");
    } finally {
      setIsVerifyingBank(false);
    }
  };

  const submitApplication = async () => {
    if (!formData.bankDetails.isVerified) {
      toast.error("Please verify your bank account first");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/inspector/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personalInfo: formData.personalInfo,
          kyc: {
            ...formData.kyc,
            hasPassport: !!passportFile,
            hasDriverLicense: !!driverLicenseFile,
          },
          serviceAreas: formData.serviceAreas,
          bankDetails: formData.bankDetails,
        }),
      });

      if (!response.ok) throw new Error("Submission failed");

      toast.success("Application submitted successfully!");
      localStorage.removeItem("inspector_onboarding");
      router.push("/dashboard/inspector");
    } catch (error) {
      toast.error("Failed to submit application");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isLoaded) return null;

  return (
    <div className="min-h-screen bg-muted/30 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">Join as an Inspector</h1>
          <p className="text-muted-foreground mt-2">Complete your profile to start inspecting properties.</p>
        </div>

        <div className="bg-card border border-border shadow-sm rounded-xl p-6 md:p-8">
          <OnboardingStepIndicator currentStep={currentStep} totalSteps={5} />

          <div className="mt-8">
            {/* STEP 1: Personal Info */}
            {currentStep === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-xl font-semibold">Personal Information</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Full Name</label>
                      <input
                        type="text"
                        value={formData.personalInfo.fullName}
                        onChange={(e) => updateFormData("personalInfo", { ...formData.personalInfo, fullName: e.target.value })}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Phone</label>
                      <input
                        type="tel"
                        value={formData.personalInfo.phone}
                        onChange={(e) => updateFormData("personalInfo", { ...formData.personalInfo, phone: e.target.value })}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Email</label>
                    <input
                      type="email"
                      value={formData.personalInfo.email}
                      onChange={(e) => updateFormData("personalInfo", { ...formData.personalInfo, email: e.target.value })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Years of Experience</label>
                    <input
                      type="number"
                      value={formData.personalInfo.experience}
                      onChange={(e) => updateFormData("personalInfo", { ...formData.personalInfo, experience: e.target.value })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Background / Qualifications</label>
                    <textarea
                      rows={4}
                      value={formData.personalInfo.background}
                      onChange={(e) => updateFormData("personalInfo", { ...formData.personalInfo, background: e.target.value })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-4 border-t">
                  <button
                    onClick={() => goToStep(2)}
                    className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Next Step
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: KYC */}
            {currentStep === 2 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-xl font-semibold">KYC Verification</h2>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">National Identity Number (NIN)</label>
                    <input
                      type="text"
                      value={formData.kyc.nin}
                      onChange={(e) => updateFormData("kyc", { ...formData.kyc, nin: e.target.value })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Passport Photograph (Max 5MB)</label>
                    {passportFile ? (
                      <div className="flex items-center justify-between p-3 border rounded-md bg-muted/50">
                        <div className="flex items-center space-x-3">
                          {passportFile.file.type.startsWith('image/') ? (
                            <Image src={passportFile.previewUrl} alt="Preview" width={40} height={40} unoptimized className="w-10 h-10 object-cover rounded-md" />
                          ) : (
                            <FileIcon className="w-10 h-10 text-muted-foreground" />
                          )}
                          <span className="text-sm truncate max-w-[200px]">{passportFile.file.name}</span>
                        </div>
                        <button onClick={() => setPassportFile(null)} className="text-destructive hover:bg-destructive/10 p-1 rounded">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center w-full">
                        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-muted/30 hover:bg-muted/50">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Upload className="w-6 h-6 mb-2 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Click to upload JPG, PNG, PDF</p>
                          </div>
                          <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => handleFileUpload(e, setPassportFile)} />
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Driver's License (Max 5MB)</label>
                    {driverLicenseFile ? (
                      <div className="flex items-center justify-between p-3 border rounded-md bg-muted/50">
                        <div className="flex items-center space-x-3">
                          {driverLicenseFile.file.type.startsWith('image/') ? (
                            <Image src={driverLicenseFile.previewUrl} alt="Preview" width={40} height={40} unoptimized className="w-10 h-10 object-cover rounded-md" />
                          ) : (
                            <FileIcon className="w-10 h-10 text-muted-foreground" />
                          )}
                          <span className="text-sm truncate max-w-[200px]">{driverLicenseFile.file.name}</span>
                        </div>
                        <button onClick={() => setDriverLicenseFile(null)} className="text-destructive hover:bg-destructive/10 p-1 rounded">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center w-full">
                        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-muted/30 hover:bg-muted/50">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Upload className="w-6 h-6 mb-2 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Click to upload JPG, PNG, PDF</p>
                          </div>
                          <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => handleFileUpload(e, setDriverLicenseFile)} />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex justify-between pt-4 border-t">
                  <button onClick={() => goToStep(1)} className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted">Back</button>
                  <button onClick={() => goToStep(3)} className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Next Step</button>
                </div>
              </div>
            )}

            {/* STEP 3: Service Areas */}
            {currentStep === 3 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-xl font-semibold">Service Areas</h2>
                <p className="text-sm text-muted-foreground">Select up to 10 Local Government Areas (LGAs) in Lagos where you can perform inspections.</p>
                
                <ServiceAreaPicker
                  selectedAreas={formData.serviceAreas}
                  onChange={(areas) => updateFormData("serviceAreas", areas)}
                />

                <div className="flex justify-between pt-4 border-t">
                  <button onClick={() => goToStep(2)} className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted">Back</button>
                  <button 
                    onClick={() => goToStep(4)} 
                    disabled={formData.serviceAreas.length === 0}
                    className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    Next Step
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: Bank Verification */}
            {currentStep === 4 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-xl font-semibold">Bank Details</h2>
                <p className="text-sm text-muted-foreground">Provide your payout account details.</p>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Bank Name</label>
                    <select
                      value={formData.bankDetails.bankName}
                      onChange={(e) => updateFormData("bankDetails", { ...formData.bankDetails, bankName: e.target.value, isVerified: false, accountName: "" })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">Select a bank</option>
                      {banks.map((bank, i) => (
                        <option key={i} value={bank.name}>{bank.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Account Number</label>
                    <input
                      type="text"
                      maxLength={10}
                      value={formData.bankDetails.accountNumber}
                      onChange={(e) => updateFormData("bankDetails", { ...formData.bankDetails, accountNumber: e.target.value, isVerified: false, accountName: "" })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  
                  <div className="flex items-end space-x-2">
                    <div className="flex-1 space-y-2">
                      <label className="text-sm font-medium">Account Name</label>
                      <input
                        type="text"
                        readOnly
                        value={formData.bankDetails.accountName}
                        placeholder="Verified name will appear here"
                        className={`w-full rounded-md border border-input bg-muted px-3 py-2 text-sm shadow-sm ${formData.bankDetails.isVerified ? 'text-green-600 font-medium border-green-200 bg-green-50' : 'opacity-70'}`}
                      />
                    </div>
                    {!formData.bankDetails.isVerified ? (
                      <button
                        type="button"
                        onClick={verifyBank}
                        disabled={isVerifyingBank}
                        className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 flex items-center space-x-2 h-[38px]"
                      >
                        {isVerifyingBank && <Loader2 className="w-4 h-4 animate-spin" />}
                        <span>Verify</span>
                      </button>
                    ) : (
                      <div className="h-[38px] flex items-center px-3 text-green-600 bg-green-50 rounded-md border border-green-200">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t">
                  <button onClick={() => goToStep(3)} className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted">Back</button>
                  <button 
                    onClick={() => goToStep(5)} 
                    disabled={!formData.bankDetails.isVerified}
                    className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    Next Step
                  </button>
                </div>
              </div>
            )}

            {/* STEP 5: Review */}
            {currentStep === 5 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-xl font-semibold">Review Application</h2>
                
                <div className="space-y-6">
                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="font-medium text-sm uppercase text-muted-foreground tracking-wider">Personal Info</h3>
                      <button onClick={() => goToStep(1)} className="text-xs text-primary hover:underline">Edit</button>
                    </div>
                    <div className="grid grid-cols-2 gap-y-2 text-sm">
                      <div className="text-muted-foreground">Name:</div>
                      <div className="font-medium">{formData.personalInfo.fullName || '—'}</div>
                      <div className="text-muted-foreground">Email:</div>
                      <div className="font-medium">{formData.personalInfo.email || '—'}</div>
                      <div className="text-muted-foreground">Phone:</div>
                      <div className="font-medium">{formData.personalInfo.phone || '—'}</div>
                    </div>
                  </div>

                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="font-medium text-sm uppercase text-muted-foreground tracking-wider">KYC Verification</h3>
                      <button onClick={() => goToStep(2)} className="text-xs text-primary hover:underline">Edit</button>
                    </div>
                    <div className="grid grid-cols-2 gap-y-2 text-sm">
                      <div className="text-muted-foreground">NIN:</div>
                      <div className="font-medium">{formData.kyc.nin || '—'}</div>
                      <div className="text-muted-foreground">Documents:</div>
                      <div className="font-medium">
                        {passportFile ? 'Passport ✓' : 'Passport ✗'}<br/>
                        {driverLicenseFile ? 'License ✓' : 'License ✗'}
                      </div>
                    </div>
                  </div>

                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="font-medium text-sm uppercase text-muted-foreground tracking-wider">Service Areas</h3>
                      <button onClick={() => goToStep(3)} className="text-xs text-primary hover:underline">Edit</button>
                    </div>
                    <div className="text-sm font-medium">
                      {formData.serviceAreas.length > 0 
                        ? formData.serviceAreas.join(", ") 
                        : 'None selected'}
                    </div>
                  </div>

                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="font-medium text-sm uppercase text-muted-foreground tracking-wider">Bank Details</h3>
                      <button onClick={() => goToStep(4)} className="text-xs text-primary hover:underline">Edit</button>
                    </div>
                    <div className="grid grid-cols-2 gap-y-2 text-sm">
                      <div className="text-muted-foreground">Bank:</div>
                      <div className="font-medium">{formData.bankDetails.bankName || '—'}</div>
                      <div className="text-muted-foreground">Account:</div>
                      <div className="font-medium">{formData.bankDetails.accountNumber || '—'}</div>
                      <div className="text-muted-foreground">Name:</div>
                      <div className="font-medium">{formData.bankDetails.accountName || '—'}</div>
                      <div className="text-muted-foreground">Status:</div>
                      <div className="font-medium flex items-center text-green-600">
                        {formData.bankDetails.isVerified && <CheckCircle2 className="w-4 h-4 mr-1" />}
                        {formData.bankDetails.isVerified ? 'Verified' : 'Unverified'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-6 border-t mt-8">
                  <button onClick={() => goToStep(4)} className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted">Back</button>
                  <button 
                    onClick={submitApplication} 
                    disabled={isSubmitting}
                    className="rounded-md bg-primary px-8 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 flex items-center space-x-2"
                  >
                    {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Submit Application</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InspectorOnboardingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <InspectorOnboardingContent />
    </Suspense>
  );
}
