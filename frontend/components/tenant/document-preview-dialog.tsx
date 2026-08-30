"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import {
  XCircle,
  Eye,
  File,
  Download,
  ShieldCheck,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DocumentPreview } from "@/lib/documentVaultApi";

type PreviewState =
  | "idle"
  | "loading"
  | "rendering"
  | "success"
  | "error"
  | "expired"
  | "empty";

interface DocumentPreviewDialogProps {
  preview: DocumentPreview | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh?: () => void;
  documentId?: string;
}

const PREVIEWABLE_FORMATS = ["pdf", "jpg", "jpeg", "png", "webp"];
const MAX_PRESIGN_RETRIES = 3;

/**
 * Safely render document content based on format
 * Images use img tag, PDFs use sandboxed iframe
 */
function DocumentContent({
  preview,
  onRenderStart,
  onRenderEnd,
  onRenderError,
}: {
  preview: DocumentPreview;
  onRenderStart: () => void;
  onRenderEnd: () => void;
  onRenderError: (msg: string) => void;
}) {
  const isImage = ["jpg", "jpeg", "png", "webp", "svg"].includes(
    preview.fileFormat,
  );
  const isPdf = preview.fileFormat === "pdf";

  if (!preview.storageKey) {
    onRenderError("No preview URL available");
    return null;
  }

  return (
    <div className="relative bg-muted border-2 border-foreground rounded">
      {isImage && (
        <Image
          src={preview.storageKey}
          alt={`Preview of ${preview.fileName}`}
          width={800}
          height={600}
          className="max-w-full h-auto max-h-96 mx-auto"
          onLoad={() => onRenderEnd()}
          onError={() => onRenderError("Failed to load image")}
          onLoadStart={() => onRenderStart()}
          unoptimized
        />
      )}

      {isPdf && (
        <iframe
          src={`${preview.storageKey}#toolbar=0`}
          title={`Preview of ${preview.fileName}`}
          className="w-full h-96 border-0"
          sandbox="allow-same-origin allow-scripts"
          onLoad={() => onRenderEnd()}
          onError={() => onRenderError("Failed to load PDF")}
        />
      )}
    </div>
  );
}

export function DocumentPreviewDialog({
  preview,
  loading,
  error,
  onClose,
  onRefresh,
  documentId,
}: DocumentPreviewDialogProps) {
  const [renderError, setRenderError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const presignRetryRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Derive state from props and local state to avoid setState in effect
  const state: PreviewState = loading
    ? "loading"
    : isRendering
      ? "rendering"
      : renderError &&
          (renderError.includes("expired") ||
            renderError.includes("403") ||
            renderError.includes("410"))
        ? "expired"
        : renderError
          ? "error"
          : preview
            ? "success"
            : error
              ? error.includes("expired") ||
                error.includes("403") ||
                error.includes("410")
                ? "expired"
                : "error"
              : "idle";

  const handleRetry = useCallback(() => {
    if (retryCount < MAX_PRESIGN_RETRIES) {
      setRetryCount((r) => r + 1);
      setRenderError(null);
      onRefresh?.();
    }
  }, [retryCount, onRefresh]);

  const handleDownload = useCallback(() => {
    if (!preview?.storageKey) return;

    const link = document.createElement("a");
    link.href = preview.storageKey;
    link.download = preview.fileName;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [preview]);

  const handleRenderStart = () => {
    setIsRendering(true);
  };

  const handleRenderEnd = () => {
    setIsRendering(false);
  };

  const handleRenderError = (msg: string) => {
    setRenderError(msg);
    setIsRendering(false);
  };

  const handleDialogClose = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    onClose();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const isOpen = !!preview || loading || !!error;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleDialogClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Document Preview</DialogTitle>
        </DialogHeader>

        {/* Loading State */}
        {state === "loading" && (
          <div
            className="flex flex-col items-center justify-center py-16"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-8 w-8 animate-spin text-foreground mb-4" />
            <p className="font-medium text-foreground">Loading document...</p>
          </div>
        )}

        {/* Rendering State */}
        {state === "rendering" && preview && (
          <div>
            <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-muted p-3 rounded">
              <File className="h-6 w-6 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-sm">{preview.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {preview.fileSizeBytes
                    ? `${(preview.fileSizeBytes / 1024).toFixed(1)} KB`
                    : ""}{" "}
                  • .{preview.fileFormat}
                </p>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center justify-center bg-white/20 rounded">
                <Loader2 className="h-6 w-6 animate-spin text-foreground" />
              </div>
              <DocumentContent
                preview={preview}
                onRenderStart={handleRenderStart}
                onRenderEnd={handleRenderEnd}
                onRenderError={handleRenderError}
              />
            </div>
          </div>
        )}

        {/* Success State */}
        {state === "success" && preview && (
          <div>
            <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-muted p-3 rounded">
              <File className="h-6 w-6 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-sm">{preview.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {preview.fileSizeBytes
                    ? `${(preview.fileSizeBytes / 1024).toFixed(1)} KB`
                    : ""}{" "}
                  • .{preview.fileFormat}
                </p>
              </div>
              {preview.previewAvailable && (
                <ShieldCheck
                  className="h-5 w-5 text-green-600 shrink-0"
                  aria-label="Secure preview"
                />
              )}
            </div>

            {preview.previewAvailable ? (
              <>
                <DocumentContent
                  preview={preview}
                  onRenderStart={handleRenderStart}
                  onRenderEnd={handleRenderEnd}
                  onRenderError={handleRenderError}
                />
                <div className="mt-4 flex gap-2">
                  <Button
                    onClick={handleDownload}
                    variant="outline"
                    className="flex-1 border-2 border-foreground font-bold"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              </>
            ) : (
              <Alert className="border-amber-500 bg-amber-50">
                <Download className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  {preview.message ||
                    `Preview not available for ${preview.fileFormat.toUpperCase()} files. Download to view.`}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Error State */}
        {state === "error" && (
          <div>
            {preview && (
              <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-muted p-3 rounded">
                <File className="h-6 w-6 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-sm">
                    {preview.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    .{preview.fileFormat}
                  </p>
                </div>
              </div>
            )}

            <Alert className="border-red-600 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-900">
                {renderError || error || "Failed to load document preview"}
              </AlertDescription>
            </Alert>

            <div className="mt-4 flex gap-2">
              {preview && (
                <Button
                  onClick={handleDownload}
                  variant="outline"
                  className="flex-1 border-2 border-foreground font-bold"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Instead
                </Button>
              )}
              <Button
                onClick={handleRetry}
                disabled={retryCount >= MAX_PRESIGN_RETRIES}
                className="flex-1 border-2 border-foreground bg-foreground text-background font-bold hover:bg-foreground/90"
              >
                {retryCount >= MAX_PRESIGN_RETRIES
                  ? "Max Retries Reached"
                  : "Try Again"}
              </Button>
            </div>
          </div>
        )}

        {/* Expired Link State - signal to re-presign */}
        {state === "expired" && preview && (
          <div>
            <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-muted p-3 rounded">
              <File className="h-6 w-6 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-sm">{preview.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  .{preview.fileFormat}
                </p>
              </div>
            </div>

            <Alert className="border-amber-500 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                The preview link has expired. Click below to request a fresh
                link.
              </AlertDescription>
            </Alert>

            <div className="mt-4 flex gap-2">
              <Button
                onClick={handleRetry}
                disabled={retryCount >= MAX_PRESIGN_RETRIES}
                className="flex-1 border-2 border-foreground bg-foreground text-background font-bold hover:bg-foreground/90"
              >
                {retryCount >= MAX_PRESIGN_RETRIES
                  ? "Max Retries Reached"
                  : "Request Fresh Link"}
              </Button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {state === "idle" && (
          <div className="text-center py-12">
            <File className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="font-bold text-foreground">No document selected</p>
            <p className="text-sm text-muted-foreground mt-1">
              Select a document from your vault to preview
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
