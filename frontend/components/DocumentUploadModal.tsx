"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Upload, X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

type DocumentCategory =
  | "lease_agreement"
  | "payment_receipt"
  | "identity_document"
  | "inspection_report"
  | "other";

type UploadState = "idle" | "selecting" | "uploading" | "success" | "failed";

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  lease_agreement: "Lease Agreement",
  payment_receipt: "Payment Receipt",
  identity_document: "Identity Document",
  inspection_report: "Inspection Report",
  other: "Other",
};

// Validation constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];

// Magic bytes for file type verification
const MAGIC_BYTES: Record<string, Uint8Array> = {
  pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
  jpg: new Uint8Array([0xff, 0xd8, 0xff]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG
};

const uploadSchema = z.object({
  category: z.enum([
    "lease_agreement",
    "payment_receipt",
    "identity_document",
    "inspection_report",
    "other",
  ]),
  description: z.string().max(500).optional(),
  dealId: z.string().optional(),
});

type UploadFormData = z.infer<typeof uploadSchema>;

interface DocumentUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/**
 * Validates file by checking extension, MIME type, and magic bytes
 */
async function validateFile(
  file: File,
): Promise<{ valid: boolean; error?: string }> {
  // Check extension
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `File type not supported. Use: ${ALLOWED_EXTENSIONS.join(", ").toUpperCase()}`,
    };
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file format. Detected: ${file.type || "unknown"}`,
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    const maxMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File too large (${sizeMB}MB). Maximum: ${maxMB}MB`,
    };
  }

  // Check magic bytes for additional verification
  try {
    const buffer = await file.slice(0, 4).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    let validMagic = false;
    for (const [type, magic] of Object.entries(MAGIC_BYTES)) {
      if (bytes.length >= magic.length) {
        const matches = Array.from(magic).every((byte, i) => bytes[i] === byte);
        if (matches) {
          validMagic = true;
          break;
        }
      }
    }

    if (!validMagic) {
      return {
        valid: false,
        error: "File appears to be corrupted or not a valid document",
      };
    }
  } catch {
    // If magic byte check fails, continue with other validations
  }

  return { valid: true };
}

export function DocumentUploadModal({
  open,
  onOpenChange,
  onSuccess,
}: DocumentUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Track if upload was already attempted to prevent double-submit
  const uploadAttemptRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<UploadFormData>({
    resolver: zodResolver(uploadSchema),
    mode: "onBlur",
    shouldFocusError: true,
    defaultValues: {
      category: "other",
    },
  });

  const category = watch("category");

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setUploadState("idle");
      setValidationError(null);
      setUploadProgress(0);
      setUploadError(null);
      uploadAttemptRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
  }, [open]);

  // Handle file selection with validation
  const handleFileSelect = useCallback(async (file: File) => {
    setValidationError(null);

    const validation = await validateFile(file);
    if (!validation.valid) {
      setValidationError(validation.error || "File validation failed");
      setUploadState("idle");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setUploadState("idle");
  }, []);

  const handleFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleFileSelect(file);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setValidationError(null);
    setUploadError(null);
    setUploadState("idle");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (data: UploadFormData) => {
    if (!selectedFile) {
      setValidationError("Please select a file");
      return;
    }

    // Prevent double-submit
    if (uploadAttemptRef.current) {
      return;
    }

    uploadAttemptRef.current = true;
    setUploadState("uploading");
    setUploadError(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("category", data.category);
      if (data.description) formData.append("description", data.description);
      if (data.dealId) formData.append("dealId", data.dealId);

      const token = localStorage.getItem("shelterflex_token");
      abortControllerRef.current = new AbortController();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000"}/api/v1/tenant/documents`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
          signal: abortControllerRef.current.signal,
        },
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Upload failed (${response.status})`);
      }

      setUploadState("success");
      setUploadProgress(100);

      // Show success message
      toast.success("Document uploaded successfully");

      // Auto-close after 2 seconds
      setTimeout(() => {
        setSelectedFile(null);
        setUploadState("idle");
        reset();
        onOpenChange(false);
        onSuccess?.();
        uploadAttemptRef.current = false;
      }, 2000);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setUploadError("Upload cancelled");
      } else {
        const errorMessage =
          error instanceof Error ? error.message : "Upload failed";
        setUploadError(errorMessage);
        setUploadState("failed");
      }
      uploadAttemptRef.current = false;
    }
  };

  const handleRetry = () => {
    uploadAttemptRef.current = false;
    setUploadError(null);
    setUploadProgress(0);
    setUploadState("idle");
  };

  const handleCancel = () => {
    if (uploadState === "uploading") {
      abortControllerRef.current?.abort();
    }
    handleRemoveFile();
    onOpenChange(false);
  };

  const canSubmit =
    selectedFile && !validationError && uploadState !== "uploading";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-2 border-foreground">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            Upload Document
          </DialogTitle>
        </DialogHeader>

        {/* Validation Error Alert */}
        {validationError && uploadState !== "success" && (
          <Alert className="border-red-600 bg-red-50 text-red-900">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription role="alert">{validationError}</AlertDescription>
          </Alert>
        )}

        {/* Upload Error Alert */}
        {uploadError && uploadState === "failed" && (
          <Alert className="border-red-600 bg-red-50 text-red-900">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription role="alert">{uploadError}</AlertDescription>
          </Alert>
        )}

        {/* Success State */}
        {uploadState === "success" && (
          <Alert className="border-green-600 bg-green-50 text-green-900">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription role="status" aria-live="polite">
              Document uploaded successfully! Closing...
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* File Input */}
          <div>
            <label
              htmlFor="file-input"
              className="block text-sm font-bold text-foreground mb-2"
            >
              Document File
            </label>
            {selectedFile ? (
              <Card className="border-2 border-border p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground break-words text-sm">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(2)} KB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveFile}
                  disabled={uploadState === "uploading"}
                  className="ml-2 p-1 hover:bg-border rounded transition-colors disabled:opacity-50"
                  aria-label="Remove file"
                >
                  <X className="h-4 w-4" />
                </button>
              </Card>
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <label
                  htmlFor="file-input"
                  className="flex flex-col items-center gap-2 cursor-pointer"
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="font-bold text-foreground">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, PDF up to{" "}
                    {(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)}MB
                  </p>
                </label>
                <input
                  id="file-input"
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
                  onChange={handleFileInputChange}
                  disabled={uploadState === "uploading"}
                  className="hidden"
                  aria-label="Select document file"
                />
              </div>
            )}
          </div>

          {/* Upload Progress Bar */}
          {uploadState === "uploading" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Uploading...
                </span>
                <span className="text-xs text-muted-foreground">
                  {uploadProgress}%
                </span>
              </div>
              <div className="h-2 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-foreground transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                  role="progressbar"
                  aria-valuenow={uploadProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          )}

          {/* Category */}
          <div>
            <label
              htmlFor="category-select"
              className="block text-sm font-bold text-foreground mb-2"
            >
              Category <span aria-label="required">*</span>
            </label>
            <select
              id="category-select"
              {...register("category")}
              disabled={uploadState === "uploading"}
              aria-invalid={!!errors.category}
              className="w-full border-2 border-border rounded-lg p-2 bg-background text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-foreground disabled:opacity-50"
              aria-describedby={errors.category ? "category-error" : undefined}
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {errors.category && (
              <p
                id="category-error"
                className="text-sm text-red-600 mt-1"
                role="alert"
              >
                {errors.category.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-bold text-foreground mb-2"
            >
              Description
            </label>
            <textarea
              id="description"
              {...register("description")}
              placeholder="Optional description..."
              maxLength={500}
              rows={3}
              disabled={uploadState === "uploading"}
              aria-invalid={!!errors.description}
              className="w-full border-2 border-border rounded-lg p-2 bg-background text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-foreground resize-none disabled:opacity-50"
              aria-describedby={
                errors.description ? "description-error" : undefined
              }
            />
            {errors.description && (
              <p
                id="description-error"
                className="text-sm text-red-600 mt-1"
                role="alert"
              >
                {errors.description.message}
              </p>
            )}
          </div>

          {/* Deal ID */}
          <div>
            <label
              htmlFor="deal-id"
              className="block text-sm font-bold text-foreground mb-2"
            >
              Deal ID (Optional)
            </label>
            <input
              id="deal-id"
              {...register("dealId")}
              type="text"
              placeholder="Link to a specific deal..."
              disabled={uploadState === "uploading"}
              aria-invalid={!!errors.dealId}
              className="w-full border-2 border-border rounded-lg p-2 bg-background text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-foreground disabled:opacity-50"
              aria-describedby={errors.dealId ? "deal-id-error" : undefined}
            />
            {errors.dealId && (
              <p
                id="deal-id-error"
                className="text-sm text-red-600 mt-1"
                role="alert"
              >
                {errors.dealId.message}
              </p>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              onClick={handleCancel}
              disabled={
                uploadState === "uploading" || uploadState === "success"
              }
              variant="outline"
              className="flex-1 border-2 border-border disabled:opacity-50"
            >
              Cancel
            </Button>

            {uploadState === "failed" ? (
              <Button
                type="button"
                onClick={handleRetry}
                className="flex-1 bg-foreground text-background hover:bg-foreground/90 font-bold border-2 border-foreground"
              >
                Retry Upload
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!canSubmit || uploadState === "success"}
                className="flex-1 bg-foreground text-background hover:bg-foreground/90 font-bold border-2 border-foreground disabled:opacity-50"
              >
                {uploadState === "uploading" ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading...
                  </span>
                ) : uploadState === "success" ? (
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Success
                  </span>
                ) : (
                  "Upload"
                )}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
