"use client";

import { useState } from "react";
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
import { CheckCircle2, Loader2 } from "lucide-react";

interface LeaseESignatureProps {
  propertyId: string;
  propertyName: string;
  isOpen: boolean;
  onClose: () => void;
}

type SignatureStep = "preview" | "sign" | "confirmed";

export function LeaseESignature({
  propertyId,
  propertyName,
  isOpen,
  onClose,
}: LeaseESignatureProps) {
  const [step, setStep] = useState<SignatureStep>("preview");
  const [signerName, setSignerName] = useState("");
  const [signDate, setSignDate] = useState(new Date().toISOString().split("T")[0]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSign = async () => {
    if (!signerName.trim()) {
      alert("Please enter your full name");
      return;
    }

    setIsLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setStep("confirmed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (step === "confirmed") {
      setStep("preview");
      setSignerName("");
      setSignDate(new Date().toISOString().split("T")[0]);
      setAcknowledged(false);
      onClose();
    } else {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lease Agreement E-Signature</DialogTitle>
          <DialogDescription>
            Sign the lease agreement for {propertyName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {step === "preview" && (
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
                    {new Date().toLocaleDateString("en-NG")}
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
                  onClick={() => setStep("sign")}
                  className="w-full border-3 border-foreground bg-primary font-bold py-6"
                >
                  Proceed to Sign
                </Button>
              </div>
            </>
          )}

          {step === "sign" && (
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
                  />
                  <Label htmlFor="acknowledge" className="text-sm font-normal">
                    I confirm that I have read and understood the lease
                    agreement terms and authorize this electronic signature as
                    my legal signature.
                  </Label>
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("preview")}
                  className="border-2 border-foreground"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSign}
                  disabled={!signerName.trim() || !acknowledged || isLoading}
                  className="border-3 border-foreground bg-primary font-bold"
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign Now
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "confirmed" && (
            <>
              <div className="flex flex-col items-center justify-center py-8">
                <CheckCircle2 className="h-16 w-16 text-primary mb-4" />
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
                </div>
              </div>

              <DialogFooter>
                <Button
                  onClick={handleClose}
                  className="w-full border-3 border-foreground bg-primary font-bold py-6"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
