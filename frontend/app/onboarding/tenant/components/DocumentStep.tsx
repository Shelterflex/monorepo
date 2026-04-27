"use client";

import { Label } from "@/components/ui/label";
import { FileUp, FileText, CheckCircle, AlertCircle, Trash2 } from "lucide-react";
import { TenantOnboardingData } from "@/lib/tenantApi";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface DocumentStepProps {
  data: TenantOnboardingData["kyc"];
  updateData: (data: Partial<TenantOnboardingData["kyc"]>) => void;
  errors: Record<string, string>;
}

export function DocumentStep({ data, updateData, errors }: DocumentStepProps) {
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      // Mocking upload by setting a fake URL
      updateData({ documentUrl: `https://fake-storage.com/${file.name}`, status: "pending" });
    }
  };

  const removeFile = () => {
    setFileName(null);
    updateData({ documentUrl: undefined, status: "pending" });
  };

  const docTypes = [
    { id: "passport", label: "International Passport" },
    { id: "nin", label: "NIN Slip" },
    { id: "voters", label: "Voters Card" },
    { id: "drivers", label: "Driver's License" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Identity Verification</h2>
        <p className="text-muted-foreground">Please upload a valid government-issued ID to verify your identity.</p>
      </div>

      <div className="space-y-4">
        <Label className="font-bold">Select Document Type</Label>
        <div className="grid grid-cols-2 gap-4">
          {docTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => updateData({ documentType: type.id })}
              className={`border-3 border-foreground p-4 font-bold text-left transition-all ${
                data.documentType === type.id
                  ? "bg-secondary shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] translate-x-0.5 translate-y-0.5"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
        {errors.documentType && <p className="text-xs font-bold text-destructive">{errors.documentType}</p>}
      </div>

      <div className="space-y-4">
        <Label className="font-bold">Upload Document</Label>
        {!data.documentUrl ? (
          <label className={`flex flex-col items-center justify-center border-3 border-dashed border-foreground bg-accent/10 py-12 cursor-pointer hover:bg-accent/20 transition-all ${errors.documentUrl ? "border-destructive" : ""}`}>
            <FileUp className="h-12 w-12 mb-4 text-muted-foreground" />
            <p className="font-bold">Click to upload or drag and drop</p>
            <p className="text-sm text-muted-foreground mt-2">JPG, PNG or PDF (Max 5MB)</p>
            <input type="file" className="hidden" onChange={handleFileChange} accept=".jpg,.jpeg,.png,.pdf" />
          </label>
        ) : (
          <div className="border-3 border-foreground bg-secondary/20 p-4 flex items-center justify-between shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex items-center gap-3">
              <div className="bg-secondary p-2 border-2 border-foreground">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <p className="font-bold">{fileName || "document_uploaded.pdf"}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" /> Ready to submit
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={removeFile} className="hover:bg-destructive hover:text-white border-2 border-transparent hover:border-foreground">
              <Trash2 className="h-5 w-5" />
            </Button>
          </div>
        )}
        {errors.documentUrl && <p className="text-xs font-bold text-destructive">{errors.documentUrl}</p>}
      </div>

      <div className="rounded-lg border-3 border-foreground bg-accent p-4 flex gap-3">
        <AlertCircle className="h-6 w-6 shrink-0 text-foreground" />
        <p className="text-sm font-medium">
          Make sure your document is clear, readable, and hasn&apos;t expired. Verification usually takes 24-48 hours.
        </p>
      </div>
    </div>
  );
}
