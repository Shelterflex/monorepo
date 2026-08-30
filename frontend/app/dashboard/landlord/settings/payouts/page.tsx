"use client";

import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Loader2, Wallet, Building2, AlertCircle } from "lucide-react";

import { BankAccountCard } from "@/components/landlord/BankAccountCard";
import { PayoutScheduleSelector } from "@/components/landlord/PayoutScheduleSelector";
import { useWallet, WalletProvider } from "@/contexts/WalletContext";

// Schemas
const bankSchema = z.object({
  bankName: z.string().min(1, "Bank name is required"),
  accountNumber: z.string().min(10, "Account number must be at least 10 digits").max(10),
  accountName: z.string().optional(),
});

const stellarSchema = z.object({
  stellarAddress: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address format"),
});

type BankFormData = z.infer<typeof bankSchema>;
type StellarFormData = z.infer<typeof stellarSchema>;

function PayoutSettingsContent() {
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [activeTab, setActiveTab] = useState<"fiat" | "crypto">("fiat");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedAccount, setVerifiedAccount] = useState<{
    bankName: string;
    accountNumber: string;
    accountName: string;
  } | null>(null);

  const { address, connect, disconnect } = useWallet();

  const {
    control: bankControl,
    handleSubmit: handleBankSubmit,
    setValue: setBankValue,
    watch: watchBank,
    formState: { errors: bankErrors, isSubmitting: isBankSubmitting },
  } = useForm<BankFormData>({
    resolver: zodResolver(bankSchema),
    mode: "onBlur",
    shouldFocusError: true,
    defaultValues: { bankName: "", accountNumber: "", accountName: "" },
  });

  const {
    control: stellarControl,
    handleSubmit: handleStellarSubmit,
    setValue: setStellarValue,
    formState: { errors: stellarErrors, isSubmitting: isStellarSubmitting },
  } = useForm<StellarFormData>({
    resolver: zodResolver(stellarSchema),
    mode: "onBlur",
    shouldFocusError: true,
    defaultValues: { stellarAddress: "" },
  });

  const watchBankName = watchBank("bankName");
  const watchAccountNumber = watchBank("accountNumber");

  useEffect(() => {
    fetch("/data/ng-banks.json")
      .then((res) => res.json())
      .then((data) => setBanks(data))
      .catch((err) => console.error("Failed to load banks", err));
  }, []);

  useEffect(() => {
    if (address) {
      setStellarValue("stellarAddress", address);
    }
  }, [address, setStellarValue]);

  const onVerifyBank = async () => {
    if (!watchBankName || !watchAccountNumber || watchAccountNumber.length < 10) {
      toast.error("Please enter a valid bank name and 10-digit account number.");
      return;
    }

    setIsVerifying(true);
    try {
      const response = await fetch("/api/landlord/payout/verify-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankName: watchBankName,
          accountNumber: watchAccountNumber,
        }),
      });

      if (!response.ok) throw new Error("Verification failed");

      const data = await response.json();
      setBankValue("accountName", data.accountName);
      toast.success("Bank account verified successfully");
    } catch (error) {
      toast.error("Failed to verify bank account.");
    } finally {
      setIsVerifying(false);
    }
  };

  const onSaveBank = (data: BankFormData) => {
    if (!data.accountName) {
      toast.error("Please verify your account first.");
      return;
    }

    setVerifiedAccount({
      bankName: data.bankName,
      accountNumber: data.accountNumber,
      accountName: data.accountName,
    });
    toast.success("Bank account saved for payouts.");
  };

  const onSaveStellar = (data: StellarFormData) => {
    toast.success(`Stellar address ${data.stellarAddress.substring(0, 8)}... saved for payouts.`);
  };

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payout Preferences</h1>
        <p className="text-muted-foreground mt-1">
          Manage how and when you receive your earnings.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          {/* Payout Method Section */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="flex border-b border-border">
              <button
                className={`flex-1 py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "fiat"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("fiat")}
              >
                <div className="flex items-center justify-center space-x-2">
                  <Building2 className="w-4 h-4" />
                  <span>NGN Bank Account</span>
                </div>
              </button>
              <button
                className={`flex-1 py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "crypto"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("crypto")}
              >
                <div className="flex items-center justify-center space-x-2">
                  <Wallet className="w-4 h-4" />
                  <span>Stellar Wallet</span>
                </div>
              </button>
            </div>

            <div className="p-6">
              {activeTab === "fiat" && (
                <div>
                  {verifiedAccount ? (
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-foreground">Primary Payout Account</h3>
                      <BankAccountCard
                        bankName={verifiedAccount.bankName}
                        accountNumber={verifiedAccount.accountNumber}
                        accountName={verifiedAccount.accountName}
                        onChangeRequest={() => setVerifiedAccount(null)}
                      />
                    </div>
                  ) : (
                    <form onSubmit={handleBankSubmit(onSaveBank)} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label htmlFor="bankName" className="text-sm font-medium">Bank Name</label>
                          <Controller
                            name="bankName"
                            control={bankControl}
                            render={({ field }) => (
                              <select
                                id="bankName"
                                {...field}
                                aria-invalid={!!bankErrors.bankName}
                                aria-describedby={bankErrors.bankName ? "bankName-error" : undefined}
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              >
                                <option value="">Select a bank</option>
                                {banks.map((bank, i) => (
                                  <option key={i} value={bank.name}>
                                    {bank.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          />
                          {bankErrors.bankName && (
                            <p id="bankName-error" role="alert" className="text-xs text-destructive">{bankErrors.bankName.message}</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="accountNumber" className="text-sm font-medium">Account Number</label>
                          <Controller
                            name="accountNumber"
                            control={bankControl}
                            render={({ field }) => (
                              <input
                                id="accountNumber"
                                {...field}
                                type="text"
                                maxLength={10}
                                placeholder="0123456789"
                                aria-invalid={!!bankErrors.accountNumber}
                                aria-describedby={bankErrors.accountNumber ? "accountNumber-error" : undefined}
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            )}
                          />
                          {bankErrors.accountNumber && (
                            <p id="accountNumber-error" role="alert" className="text-xs text-destructive">{bankErrors.accountNumber.message}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-end space-x-2">
                        <div className="flex-1 space-y-2">
                          <label className="text-sm font-medium">Account Name</label>
                          <Controller
                            name="accountName"
                            control={bankControl}
                            render={({ field }) => (
                              <input
                                {...field}
                                type="text"
                                readOnly
                                placeholder="Verified name will appear here"
                                className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm shadow-sm opacity-70"
                              />
                            )}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={onVerifyBank}
                          disabled={isVerifying}
                          className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 flex items-center space-x-2 h-[38px]"
                        >
                          {isVerifying && <Loader2 className="w-4 h-4 animate-spin" />}
                          <span>Verify</span>
                        </button>
                      </div>

                      <div className="pt-4">
                        <button
                          type="submit"
                          disabled={isBankSubmitting || isVerifying}
                          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isBankSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}
                          Save NGN Bank Account
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {activeTab === "crypto" && (
                <form onSubmit={handleStellarSubmit(onSaveStellar)} className="space-y-4">
                  <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-4 flex items-start space-x-3 mb-6">
                    <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      Receive payouts in USDC on the Stellar network. Fast, low-fee global transfers.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="stellarAddress" className="text-sm font-medium flex justify-between items-center">
                      <span>Stellar Address</span>
                      {!address ? (
                        <button
                          type="button"
                          onClick={connect}
                          className="text-xs text-primary hover:underline"
                        >
                          Connect Wallet
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={disconnect}
                          className="text-xs text-destructive hover:underline"
                        >
                          Disconnect
                        </button>
                      )}
                    </label>
                    <Controller
                      name="stellarAddress"
                      control={stellarControl}
                      render={({ field }) => (
                        <input
                          id="stellarAddress"
                          {...field}
                          type="text"
                          placeholder="G..."
                          aria-invalid={!!stellarErrors.stellarAddress}
                          aria-describedby={stellarErrors.stellarAddress ? "stellarAddress-error" : undefined}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                        />
                      )}
                    />
                    {stellarErrors.stellarAddress && (
                      <p id="stellarAddress-error" role="alert" className="text-xs text-destructive">{stellarErrors.stellarAddress.message}</p>
                    )}
                  </div>

                  <div className="pt-4">
                    <button
                      type="submit"
                      disabled={isStellarSubmitting}
                      className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isStellarSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}
                      Save Stellar Address
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <PayoutScheduleSelector initialSchedule="monthly" />
        </div>
      </div>
    </div>
  );
}

export default function PayoutSettingsPage() {
  return (
    <WalletProvider>
      <PayoutSettingsContent />
    </WalletProvider>
  );
}
