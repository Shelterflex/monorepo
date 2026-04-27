"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Phone, MapPin, Briefcase, User } from "lucide-react";
import { TenantOnboardingData } from "@/lib/tenantApi";

interface IdentityStepProps {
  data: TenantOnboardingData["identity"];
  updateData: (data: Partial<TenantOnboardingData["identity"]>) => void;
  errors: Record<string, string>;
}

export function IdentityStep({ data, updateData, errors }: IdentityStepProps) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Tell us about yourself</h2>
        <p className="text-muted-foreground">This information will be used to create your tenant profile.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName" className="font-bold flex items-center gap-2">
            <User className="h-4 w-4" /> Full Name
          </Label>
          <Input
            id="fullName"
            placeholder="John Doe"
            value={data.fullName}
            onChange={(e) => updateData({ fullName: e.target.value })}
            className={`border-3 border-foreground bg-background py-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] focus-visible:ring-0 ${errors.fullName ? "border-destructive" : ""}`}
          />
          {errors.fullName && <p className="text-xs font-bold text-destructive">{errors.fullName}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="occupation" className="font-bold flex items-center gap-2">
            <Briefcase className="h-4 w-4" /> Occupation
          </Label>
          <Input
            id="occupation"
            placeholder="Software Engineer"
            value={data.occupation}
            onChange={(e) => updateData({ occupation: e.target.value })}
            className={`border-3 border-foreground bg-background py-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] focus-visible:ring-0 ${errors.occupation ? "border-destructive" : ""}`}
          />
          {errors.occupation && <p className="text-xs font-bold text-destructive">{errors.occupation}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="font-bold flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email Address
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="john@example.com"
            value={data.email}
            onChange={(e) => updateData({ email: e.target.value })}
            className={`border-3 border-foreground bg-background py-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] focus-visible:ring-0 ${errors.email ? "border-destructive" : ""}`}
          />
          {errors.email && <p className="text-xs font-bold text-destructive">{errors.email}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone" className="font-bold flex items-center gap-2">
            <Phone className="h-4 w-4" /> Phone Number
          </Label>
          <Input
            id="phone"
            placeholder="+234 801 234 5678"
            value={data.phone}
            onChange={(e) => updateData({ phone: e.target.value })}
            className={`border-3 border-foreground bg-background py-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] focus-visible:ring-0 ${errors.phone ? "border-destructive" : ""}`}
          />
          {errors.phone && <p className="text-xs font-bold text-destructive">{errors.phone}</p>}
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="address" className="font-bold flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Current Address
          </Label>
          <Input
            id="address"
            placeholder="123 Main St, Lagos, Nigeria"
            value={data.address}
            onChange={(e) => updateData({ address: e.target.value })}
            className={`border-3 border-foreground bg-background py-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] focus-visible:ring-0 ${errors.address ? "border-destructive" : ""}`}
          />
          {errors.address && <p className="text-xs font-bold text-destructive">{errors.address}</p>}
        </div>
      </div>
    </div>
  );
}
