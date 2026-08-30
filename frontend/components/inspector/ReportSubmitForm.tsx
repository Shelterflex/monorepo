"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Upload, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  InspectionChecklist,
  inspectionChecklistTemplate,
  type ChecklistCategory,
} from "./InspectionChecklist";
import { AccessibleFlowStatus } from "./AccessibleFlowStatus";
import { propertyInspectionApi, type ChecklistItem } from "@/lib/propertyInspectionApi";
import { startWhistleblowerReport, trackWhistleblowerReportStep, trackFormSubmission } from "@/lib/analytics-init";

interface ReportSubmitFormProps {
  jobId: string;
  propertyTitle: string;
  onSubmitted?: () => void;
  onError?: (error: Error) => void;
}

export interface ReportData {
  jobId: string;
  checklist: ChecklistCategory[];
  photos: File[];
  summary: string;
  recommendations: string;
  overallCondition: "excellent" | "good" | "fair" | "poor";
}

export function ReportSubmitForm({ jobId, propertyTitle, onSubmitted, onError }: ReportSubmitFormProps) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [summary, setSummary] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [overallCondition, setOverallCondition] = useState<
    "excellent" | "good" | "fair" | "poor"
  >("good");
  const [checklist, setChecklist] = useState<ChecklistCategory[]>(
    () =>
      inspectionChecklistTemplate.map((cat) => ({
        ...cat,
        items: cat.items.map((item) => ({
          ...item,
          completed: false,
          notes: "",
        })),
      })),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPhotos((prev) => [...prev, ...files]);
    setError("");
    setStatus(`${files.length} photo${files.length === 1 ? "" : "s"} selected.`);
    e.target.value = "";
  };

  const removePhoto = (index: number) => {
    const removed = photos[index];
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setStatus(`${removed.name} removed. ${photos.length - 1} photo${photos.length - 1 === 1 ? "" : "s"} selected.`);
  };

  const validate = () => {
    const requiredItemsCompleted = checklist.every((cat) =>
      cat.items.every((item) => !item.required || item.completed),
    );

    if (!summary.trim()) {
      setError("Enter a summary of findings before submitting the report.");
      summaryRef.current?.focus();
      return false;
    }

    if (photos.length === 0) {
      setError("Upload at least one inspection photo before submitting the report.");
      photosRef.current?.focus();
      return false;
    }

    if (!requiredItemsCompleted) {
      setError("Complete all required inspection checklist items before submitting the report.");
      document.getElementById("inspection-checklist")?.focus();
      return false;
    }

    setError("");
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    startWhistleblowerReport("anonymous");
    trackWhistleblowerReportStep("anonymous", "complete_inspection_report");
    setIsSubmitting(true);
    setError("");
    setStatus("Submitting inspection report.");

    try {
      const notes = [summary, recommendations].filter(Boolean).join("\n\n");
      const checklistItems: ChecklistItem[] = [];

      checklist.forEach((cat) => {
        cat.items.forEach((item) => {
          checklistItems.push({
            category: cat.category as "structural" | "plumbing" | "electrical" | "safety" | "exterior",
            item: item.label,
            result: item.completed ? "pass" : "fail",
            notes: item.notes || undefined,
          });
        });
      });

      const photoUrls = photos.map((f) => `https://placeholder.url/${f.name}`);

      await propertyInspectionApi.submitReport(jobId, {
        checklistItems,
        photos: photoUrls.map((url) => ({ url })),
        inspectorNotes: notes,
      });

      trackFormSubmission("inspection_report", { job_id: jobId });
      trackWhistleblowerReportStep("anonymous", "submit_report", { completed: true });
      setStatus("Inspection report submitted successfully.");
      onSubmitted?.();
    } catch (err) {
      const submissionError = err instanceof Error ? err : new Error("Failed to submit report");
      setError(submissionError.message);
      setStatus("Inspection report submission failed.");
      onError?.(submissionError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <AccessibleFlowStatus
        step={1}
        totalSteps={1}
        stepName="Inspection report"
        error={error}
        status={status}
      />

      {error ? (
        <div id="report-error-summary" role="alert" className="border-2 border-destructive bg-destructive/10 p-4 text-destructive">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <h3 className="text-lg font-bold text-foreground">Property Information</h3>
        <p className="mt-1 text-muted-foreground">{propertyTitle}</p>
        <p className="text-sm text-muted-foreground">Job ID: {jobId}</p>
      </Card>

      <div id="inspection-checklist" tabIndex={-1}>
        <h3 className="mb-4 text-lg font-bold text-foreground">Inspection Checklist</h3>
        <InspectionChecklist checklist={checklist} onChange={setChecklist} />
      </div>

      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <h3 className="mb-4 text-lg font-bold text-foreground">Photo Evidence</h3>
        <div className="space-y-4">
          <div>
            <Label htmlFor="photos" className="mb-2 block">Upload inspection photos (required)</Label>
            <Input
              ref={photosRef}
              id="photos"
              type="file"
              multiple
              accept="image/*"
              onChange={handlePhotoUpload}
              aria-describedby="photos-help photos-status"
              aria-invalid={error.includes("photo")}
              className="border-2 border-foreground"
            />
            <p id="photos-help" className="mt-1 text-sm text-muted-foreground">Select one or more image files.</p>
            <p id="photos-status" className="sr-only" aria-live="polite">{photos.length} photo{photos.length === 1 ? "" : "s"} selected.</p>
          </div>

          {photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-label="Selected inspection photos">
              {photos.map((photo, index) => (
                <div key={`${photo.name}-${index}`} className="relative aspect-square overflow-hidden rounded-lg border-2 border-foreground bg-muted">
                  <Image src={URL.createObjectURL(photo)} alt={`Photo ${index + 1}: ${photo.name}`} fill unoptimized sizes="(max-width: 768px) 50vw, 25vw" className="object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    aria-label={`Remove photo ${index + 1}, ${photo.name}`}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-foreground bg-muted p-8">
              <Upload className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 text-sm text-muted-foreground">No photos uploaded yet</p>
            </div>
          )}
        </div>
      </Card>

      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <h3 className="mb-4 text-lg font-bold text-foreground">Inspection Summary</h3>
        <div className="space-y-4">
          <div>
            <Label htmlFor="summary" className="mb-2 block">Summary of findings (required)</Label>
            <Textarea
              ref={summaryRef}
              id="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Provide a summary of your findings"
              aria-describedby={error.includes("summary") ? "summary-error" : undefined}
              aria-invalid={error.includes("summary")}
              required
            />
            {error.includes("summary") ? <p id="summary-error" className="mt-1 text-sm text-destructive">{error}</p> : null}
          </div>

          <div>
            <Label htmlFor="recommendations" className="mb-2 block">Recommendations</Label>
            <Textarea
              id="recommendations"
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              placeholder="Add any recommended actions"
            />
          </div>

          <div>
            <Label htmlFor="overall-condition" className="mb-2 block">Overall condition</Label>
            <select
              id="overall-condition"
              value={overallCondition}
              onChange={(e) => setOverallCondition(e.target.value as "excellent" | "good" | "fair" | "poor")}
              className="w-full border-2 border-foreground bg-background p-2"
            >
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </select>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting} aria-describedby={error ? "report-error-summary" : undefined}>
          {isSubmitting ? "Submitting…" : "Submit inspection report"}
        </Button>
      </div>
    </form>
  );
}
