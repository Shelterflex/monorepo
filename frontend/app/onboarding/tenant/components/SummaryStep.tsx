"use client";

import { CheckCircle, User, Briefcase, Mail, Phone, MapPin, FileText, Wallet, Bell } from "lucide-react";
import { TenantOnboardingData } from "@/lib/tenantApi";
import { Card } from "@/components/ui/card";

interface SummaryStepProps {
  data: TenantOnboardingData;
}

export function SummaryStep({ data }: SummaryStepProps) {
  const sections = [
    {
      title: "Identity Info",
      icon: User,
      items: [
        { label: "Full Name", value: data.identity.fullName, icon: User },
        { label: "Occupation", value: data.identity.occupation, icon: Briefcase },
        { label: "Email", value: data.identity.email, icon: Mail },
        { label: "Phone", value: data.identity.phone, icon: Phone },
        { label: "Address", value: data.identity.address, icon: MapPin },
      ]
    },
    {
      title: "Verification",
      icon: FileText,
      items: [
        { label: "Document Type", value: data.kyc.documentType.toUpperCase(), icon: FileText },
        { label: "Status", value: "Pending Submission", icon: CheckCircle },
      ]
    },
    {
      title: "Wallet",
      icon: Wallet,
      items: [
        { label: "Address", value: data.wallet.address || "Not connected", icon: Wallet },
      ]
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2 text-center">
        <div className="bg-green-500/10 border-3 border-green-600 w-fit mx-auto p-4 rounded-full mb-4">
          <CheckCircle className="h-10 w-10 text-green-600" />
        </div>
        <h2 className="text-3xl font-bold text-foreground">Review & Submit</h2>
        <p className="text-muted-foreground">Almost done! Please review your information before completing your onboarding.</p>
      </div>

      <div className="grid gap-6">
        {sections.map((section) => (
          <Card key={section.title} className="border-3 border-foreground p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex items-center gap-2 mb-4 border-b-2 border-foreground pb-2 h-fit">
              <section.icon className="h-5 w-5" />
              <h3 className="text-xl font-bold">{section.title}</h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {section.items.map((item) => (
                <div key={item.label} className="space-y-1">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{item.label}</p>
                  <div className="flex items-center gap-2">
                    <item.icon className="h-4 w-4 text-primary" />
                    <p className="font-bold truncate">{item.value || "N/A"}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}

        <Card className="border-3 border-foreground p-6 bg-accent/5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-center gap-2 mb-4 border-b-2 border-foreground pb-2">
            <Bell className="h-5 w-5" />
            <h3 className="text-xl font-bold">Notifications</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.notifications).map(([key, enabled]) => (
              enabled && (
                <span key={key} className="bg-secondary border-2 border-foreground px-3 py-1 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  {key.replace(/([A-Z])/g, ' $1').toUpperCase()}
                </span>
              )
            ))}
          </div>
        </Card>
      </div>

      <div className="p-6 border-3 border-foreground bg-accent/10 rounded-lg text-sm font-medium">
        By clicking &quot;Complete Onboarding&quot;, you agree to our Terms of Service and Privacy Policy. Your information will be processed in accordance with our KYC standards.
      </div>
    </div>
  );
}
