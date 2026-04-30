"use client";

import { XCircle, Eye, File, Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DocumentPreview } from "@/lib/documentVaultApi";

interface DocumentPreviewDialogProps {
  preview: DocumentPreview | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

export function DocumentPreviewDialog({
  preview,
  loading,
  error,
  onClose,
}: DocumentPreviewDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4">
      <Card className="w-full max-w-lg border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Document Preview</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            className="border-2 border-foreground font-bold"
          >
            Close
          </Button>
        </div>

        {loading && (
          <div className="mt-6 flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-foreground border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="mt-6 text-center">
            <XCircle className="mx-auto h-12 w-12 text-destructive" />
            <p className="mt-2 font-bold text-destructive">{error}</p>
          </div>
        )}

        {preview && (
          <div className="mt-6">
            <div className="mb-4 flex items-center gap-3 border-3 border-foreground bg-muted p-3">
              <File className="h-8 w-8 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{preview.fileName}</p>
                <p className="text-sm text-muted-foreground">
                  .{preview.fileFormat}
                </p>
              </div>
              {preview.previewAvailable && (
                <ShieldCheck className="h-5 w-5 text-green-600" />
              )}
            </div>

            {preview.previewAvailable ? (
              <div className="border-3 border-foreground bg-muted p-8 text-center">
                <Eye className="mx-auto h-16 w-16 text-primary" />
                <p className="mt-3 font-bold">Secure Preview Available</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This file can be previewed securely. Click below to open.
                </p>
                <Button className="mt-4 border-2 border-foreground bg-primary font-bold">
                  <Eye className="mr-2 h-4 w-4" />
                  Open Preview
                </Button>
              </div>
            ) : (
              <div className="border-3 border-amber-500/50 bg-amber-50 p-6 text-center">
                <Download className="mx-auto h-12 w-12 text-amber-600" />
                <p className="mt-3 font-bold text-amber-800">
                  Preview Not Available
                </p>
                <p className="mt-1 text-sm text-amber-700">
                  {preview.message ||
                    `Preview is not supported for .${preview.fileFormat} files.`}
                </p>
                <Button
                  variant="outline"
                  className="mt-4 border-2 border-foreground font-bold"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download File
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
