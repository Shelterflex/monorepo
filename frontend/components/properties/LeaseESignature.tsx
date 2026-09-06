"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatTime } from "@/lib/date";
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Clock,
  Shield,
  FileText,
} from "lucide-react";
import {
  getDocumentIntegrity,
  getLease,
  submitSignature,
  voidLease,
  type DocumentIntegrity,
} from "@/lib/leaseApi";

interface LeaseESignatureProps {
  propertyId: string;
  propertyName: string;
  dealId: string;
  isOpen: boolean;
  onClose: () => void;
  onSigned?: (leaseId: string) => void;
}

type SigningState =
  | "not-ready"
  | "ready-to-sign"
  | "signing"
  | "signed"
  | "failed-with-retry"
  | "expired-signing-session"
  | "stale-terms";

export function LeaseESignature({
  propertyId,
  propertyName,
  dealId,
  isOpen,
  onClose,
  onSigned,
}: Readonly<LeaseESignatureProps>) {
  const [state, setState] = useState<SigningState>("not-ready");
  const [signerName, setSignerName] = useState("");
  const [signDate, setSignDate] = useState(new Date().toISOString().split("T")[0]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentIntegrity, setDocumentIntegrity] = useState<DocumentIntegrity | null>(null);
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [sessionExpiry, setSessionExpiry] = useState<Date | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  // Fetch the lease document integrity when the dialog opens
  useEffect(() => {
    if (isOpen && state === "not-ready") {
      fetchDocumentIntegrity();
    }
  }, [isOpen, state]);

  const fetchDocumentIntegrity = async () => {
    setIsLoading(true);
    try {
      const response = await getDocumentIntegrity(dealId);
      const integrity = response.data;

      setDocumentIntegrity({
        documentHash: integrity.documentHash,
        documentVersion: integrity.documentVersion,
        lastModified: integrity.lastModified,
      });

      // Set session expiry to 30 minutes from now
      setSessionExpiry(new Date(Date.now() + 30 * 60 * 1000));

      setState("ready-to-sign");
    } catch (err) {
      setError("Failed to load lease document. Please try again.");
      setState("failed-with-retry");
    } finally {
      setIsLoading(false);
    }
  };

  const checkForStaleTerms = async () => {
    // Re-fetch the latest lease and compare its hash against the loaded one.
    try {
      const response = await getLease(dealId);
      const latest = response.data;

      if (latest && documentIntegrity && latest.documentHash !== documentIntegrity.documentHash) {
        setState("stale-terms");
        return true;
      }
    } catch {
      // If we can't confirm freshness, assume the loaded document is current.
    }

    return false;
  };

  const handleSign = async () => {
    if (!signerName.trim()) {
      setError("Please enter your full name");
      return;
    }

    // Check for stale terms before signing
    const hasStaleTerms = await checkForStaleTerms();
    if (hasStaleTerms) {
      return;
    }

    // Check if session has expired
    if (sessionExpiry && new Date() > sessionExpiry) {
      setState("expired-signing-session");
      return;
    }

    setIsLoading(true);
    setError(null);
    setState("signing");

    try {
      const response = await submitSignature(dealId, {
        signerName: signerName.trim(),
        signDate,
        acknowledged,
      });

      const returnedLeaseId = response.data?.leaseId;
      setLeaseId(returnedLeaseId);
      setState("signed");

      if (onSigned && returnedLeaseId) {
        onSigned(returnedLeaseId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign lease");
      setState("failed-with-retry");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoidLease = async () => {
    setIsVoiding(true);
    setError(null);
    try {
      await voidLease(dealId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to void lease");
    } finally {
      setIsVoiding(false);
    }
  };

  const handleRetry = () => {
    setError(null);
    if (state === "expired-signing-session" || state === "stale-terms") {
      // Refresh the document
      fetchDocumentIntegrity();
    } else {
      setState("ready-to-sign");
    }
  };

  const handleClose = () => {
    if (state === "signed") {
      // Reset state for next time
      setState("not-ready");
      setSignerName("");
      setSignDate(new Date().toISOString().split("T")[0]);
      setAcknowledged(false);
      setError(null);
      setDocumentIntegrity(null);
      setLeaseId(null);
      onClose();
    } else {
      onClose();
    }
  };

  const getStateBadge = () => {
    const stateConfig = {
      "not-ready": { label: "Loading", variant: "secondary" as const },
      "ready-to-sign": { label: "Ready to Sign", variant: "default" as const },
      "signing": { label: "Signing...", variant: "secondary" as const },
      "signed": { label: "Signed", variant: "default" as const },
      "failed-with-retry": { label: "Failed", variant: "destructive" as const },
      "expired-signing-session": { label: "Session Expired", variant: "destructive" as const },
      "stale-terms": { label: "Terms Changed", variant: "destructive" as const },
    };
    
    const config = stateConfig[state];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Lease Agreement E-Signature</DialogTitle>
              <DialogDescription>
                Sign the lease agreement for {propertyName}
              </DialogDescription>
            </div>
            {getStateBadge()}
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Document Integrity Display */}
          {documentIntegrity && state !== "signed" && (
            <Alert variant="default" className="border-2">
              <Shield className="h-4 w-4" />
              <AlertTitle>Document Integrity Verified</AlertTitle>
              <AlertDescription className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <FileText className="h-3 w-3" />
                  <span>
                    <strong>Version:</strong> {documentIntegrity.documentVersion}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono">
                    <strong>Hash:</strong> {documentIntegrity.documentHash}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="h-3 w-3" />
                  <span>
                    <strong>Last modified:</strong>{" "}
                    {formatDateTime(documentIntegrity.lastModified)}
                  </span>
                </div>
                {sessionExpiry && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>
                      Session expires: {formatTime(sessionExpiry)}
                    </span>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive" className="border-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Loading State */}
          {state === "not-ready" && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Loading lease document...</p>
            </div>
          )}

          {/* Ready to Sign - Document Preview */}
          {state === "ready-to-sign" && (
            <>
              <div className="border-3 border-foreground bg-muted p-6 max-h-64 overflow-y-auto">
                <h3 className="font-mono text-lg font-bold mb-4">
                  LEASE AGREEMENT
                </h3>
                <div className="space-y-3 text-sm text-foreground">
                  <p>
                    <strong>Property:</strong> {propertyName}
                  </p>
                  <p>
                    <strong>Date:</strong>{" "}
                    {formatDate(new Date())}
                  </p>
                  <div className="mt-4 space-y-2 text-xs leading-relaxed">
                    <p>
                      THIS LEASE AGREEMENT ("Agreement") is entered into on the
                      date last signed below ("Effective Date").
                    </p>
                    <p>
                      The Landlord agrees to lease the property described above
                      to the Tenant under the terms and conditions outlined in
                      this Agreement.
                    </p>
                    <p>
                      1. LEASE TERM: The lease term shall commence on the
                      Effective Date and shall terminate twelve (12) months
                      thereafter, unless renewed or terminated as provided
                      herein.
                    </p>
                    <p>
                      2. RENT: Tenant agrees to pay rent in the amount specified
                      in the quote, payable monthly through Shelterflex's
                      rent-now-pay-later system.
                    </p>
                    <p>
                      3. PROPERTY MAINTENANCE: Tenant shall maintain the
                      property in good condition and shall promptly report any
                      damages or maintenance issues.
                    </p>
                    <p>
                      4. TERMINATION: Either party may terminate this lease with
                      thirty (30) days written notice.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <Button
                  onClick={() => setState("signing")}
                  className="w-full border-3 border-foreground bg-primary font-bold py-6"
                  aria-label="Proceed to sign lease agreement"
                >
                  Proceed to Sign
                </Button>
              </div>
            </>
          )}

          {/* Signing State */}
          {state === "signing" && (
            <>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="signer-name">Full Name</Label>
                  <Input
                    id="signer-name"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Enter your full name as it should appear on the lease"
                    className="border-2 border-foreground mt-1"
                    aria-required="true"
                  />
                </div>

                <div>
                  <Label htmlFor="sign-date">Date of Signature</Label>
                  <Input
                    id="sign-date"
                    type="date"
                    value={signDate}
                    onChange={(e) => setSignDate(e.target.value)}
                    className="border-2 border-foreground mt-1"
                    aria-required="true"
                  />
                </div>

                <div className="border-3 border-foreground bg-muted p-4 space-y-3">
                  <p className="font-mono text-sm font-bold">
                    Signature Preview:
                  </p>
                  <div className="border-2 border-dashed border-foreground p-3 bg-background">
                    <p className="font-mono text-lg">{signerName || "Signature"}</p>
                    <p className="text-xs text-muted-foreground">
                      {signDate}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="acknowledge"
                    checked={acknowledged}
                    onCheckedChange={(checked) =>
                      setAcknowledged(checked as boolean)
                    }
                    aria-required="true"
                  />
                  <Label htmlFor="acknowledge" className="text-sm font-normal cursor-pointer">
                    I confirm that I have read and understood the lease
                    agreement terms and authorize this electronic signature as
                    my legal signature.
                  </Label>
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setState("ready-to-sign")}
                  className="border-2 border-foreground"
                  aria-label="Go back to document preview"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSign}
                  disabled={!signerName.trim() || !acknowledged || isLoading}
                  className="border-3 border-foreground bg-primary font-bold"
                  aria-label="Sign lease agreement now"
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {isLoading ? "Signing..." : "Sign Now"}
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Signed State */}
          {state === "signed" && (
            <>
              <div className="flex flex-col items-center justify-center py-8">
                <CheckCircle2 className="h-16 w-16 text-primary mb-4" aria-hidden="true" />
                <h3 className="font-mono text-xl font-bold mb-2">
                  Lease Signed Successfully
                </h3>
                <p className="text-center text-muted-foreground mb-4">
                  Your lease agreement has been electronically signed and
                  recorded.
                </p>
                <div className="border-2 border-foreground bg-muted p-4 w-full text-sm space-y-1">
                  <p>
                    <strong>Signed by:</strong> {signerName}
                  </p>
                  <p>
                    <strong>Date:</strong> {signDate}
                  </p>
                  <p>
                    <strong>Property:</strong> {propertyName}
                  </p>
                  {leaseId && (
                    <p>
                      <strong>Lease ID:</strong> {leaseId}
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  onClick={handleClose}
                  className="w-full border-3 border-foreground bg-primary font-bold py-6"
                  aria-label="Close signature dialog"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Failed with Retry */}
          {state === "failed-with-retry" && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <AlertTriangle className="h-12 w-12 text-destructive mb-2" aria-hidden="true" />
              <h3 className="font-mono text-lg font-bold">Signing Failed</h3>
              <p className="text-center text-muted-foreground">
                {error || "An error occurred while signing the lease. Please try again."}
              </p>
              <Button
                onClick={handleRetry}
                className="border-2 border-foreground"
                aria-label="Retry signing the lease"
              >
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Retry
              </Button>
            </div>
          )}

          {/* Expired Session */}
          {state === "expired-signing-session" && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <Clock className="h-12 w-12 text-destructive mb-2" aria-hidden="true" />
              <h3 className="font-mono text-lg font-bold">Session Expired</h3>
              <p className="text-center text-muted-foreground">
                Your signing session has expired. Please refresh the document to continue.
              </p>
              <Button
                onClick={handleRetry}
                className="border-2 border-foreground"
                aria-label="Refresh document and start new session"
              >
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Refresh Document
              </Button>
            </div>
          )}

          {/* Stale Terms */}
          {state === "stale-terms" && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <AlertTriangle className="h-12 w-12 text-destructive mb-2" aria-hidden="true" />
              <h3 className="font-mono text-lg font-bold">Terms Have Changed</h3>
              <p className="text-center text-muted-foreground">
                The lease terms have been modified since you loaded this document. 
                Please refresh to review the latest version before signing.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  onClick={handleRetry}
                  className="border-2 border-foreground"
                  aria-label="Refresh document to view updated terms"
                >
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  Refresh Document
                </Button>
                <Button
                  variant="outline"
                  onClick={handleVoidLease}
                  disabled={isVoiding}
                  className="border-2 border-destructive text-destructive"
                  aria-label="Void the lease agreement"
                >
                  {isVoiding && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {isVoiding ? "Voiding…" : "Void lease"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
