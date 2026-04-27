"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Bell, CreditCard, FileText, MessageSquare } from "lucide-react";
import { TenantOnboardingData } from "@/lib/tenantApi";

interface NotificationsStepProps {
  data: TenantOnboardingData["notifications"];
  updateData: (data: Partial<TenantOnboardingData["notifications"]>) => void;
}

export function NotificationsStep({ data, updateData }: NotificationsStepProps) {
  const options = [
    {
      id: "paymentReminders",
      title: "Payment Reminders",
      description: "Get notified 3 days before your rent is due.",
      icon: CreditCard,
    },
    {
      id: "paymentConfirmations",
      title: "Payment Confirmations",
      description: "Receive receipts and confirmations for all transactions.",
      icon: CheckCircle,
    },
    {
      id: "leaseUpdates",
      title: "Lease Updates",
      description: "Stay informed about lease renewals and administrative changes.",
      icon: FileText,
    },
    {
      id: "messages",
      title: "New Messages",
      description: "Instant notifications when a landlord or support messages you.",
      icon: MessageSquare,
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Notification Preferences</h2>
        <p className="text-muted-foreground">Stay updated on your lease and payments. You can change these later in settings.</p>
      </div>

      <div className="space-y-4">
        {options.map((option) => (
          <div 
            key={option.id}
            className="flex items-start justify-between border-3 border-foreground p-6 bg-background shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            <div className="flex gap-4">
              <div className="bg-primary/10 p-2 border-2 border-foreground h-fit">
                <option.icon className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="font-bold">{option.title}</p>
                <p className="text-sm text-muted-foreground max-w-sm">{option.description}</p>
              </div>
            </div>
            <Switch 
              checked={(data as any)[option.id]} 
              onCheckedChange={(checked) => updateData({ [option.id]: checked })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// I missed a CheckCircle import in NotificationsStep, I'll fix it in the file write
import { CheckCircle } from "lucide-react";
