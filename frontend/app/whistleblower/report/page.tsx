"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function ReportApartmentPage() {
  const [step, setStep] = useState<"form" | "confirmation">("form");
  const [formData, setFormData] = useState({
    address: "",
    bedrooms: "",
    bathrooms: "",
    annualRent: "",
    description: "",
    photos: [] as string[],
  });

  const handleInputChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const fileArray = Array.from(files).map((file) =>
        URL.createObjectURL(file),
      );
      setFormData((prev) => ({
        ...prev,
        photos: [...prev.photos, ...fileArray],
      }));
    }
  };

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (
      formData.address &&
      formData.bedrooms &&
      formData.annualRent &&
      formData.photos.length > 0
    ) {
      setStep("confirmation");
    }
  };

  return (
    <div className="min-h-screen bg-background pt-20">
      <div className="container mx-auto px-4 py-8">
        <Link
          href="/whistleblower/dashboard"
          className="inline-flex items-center gap-2 mb-8 text-sm font-bold border-b-2 border-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <div className="max-w-3xl mx-auto">
          {step === "form" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <h1 className="text-3xl font-black mb-2">
                Report a Vacant Apartment
              </h1>
              <p className="text-muted-foreground mb-6">
                Help tenants find apartments and earn ₦10-20k when they rent
              </p>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Address */}
                <div>
                  <label htmlFor="apartment-address" className="text-sm font-bold mb-2 block">
                    Apartment Address
                  </label>
                  <Input
                    id="apartment-address"
                    type="text"
                    name="address"
                    value={formData.address}
                    onChange={handleInputChange}
                    placeholder="e.g., Block 5, Flat 2B, Yaba, Lagos"
                    className="border-3 border-foreground py-3"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Must be in the same building you live in
                  </p>
                </div>

                {/* Bedrooms and Bathrooms */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="bedrooms" className="text-sm font-bold mb-2 block">
                      Bedrooms
                    </label>
                    <select
                      id="bedrooms"
                      name="bedrooms"
                      value={formData.bedrooms}
                      onChange={handleInputChange}
                      className="w-full border-3 border-foreground px-3 py-3 font-bold bg-background"
                      required
                    >
                      <option value="">Select</option>
                      <option value="1">1 Bedroom</option>
                      <option value="2">2 Bedrooms</option>
                      <option value="3">3 Bedrooms</option>
                      <option value="4">4+ Bedrooms</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bathrooms" className="text-sm font-bold mb-2 block">
                      Bathrooms
                    </label>
                    <select
                      id="bathrooms"
                      name="bathrooms"
                      value={formData.bathrooms}
                      onChange={handleInputChange}
                      className="w-full border-3 border-foreground px-3 py-3 font-bold bg-background"
                      required
                    >
                      <option value="">Select</option>
                      <option value="1">1 Bathroom</option>
                      <option value="2">2 Bathrooms</option>
                      <option value="3">3+ Bathrooms</option>
                    </select>
                  </div>
                </div>

                {/* Annual Rent */}
                <div>
                  <label htmlFor="annual-rent" className="text-sm font-bold mb-2 block">
                    Annual Rent (₦)
                  </label>
                  <Input
                    id="annual-rent"
                    type="number"
                    name="annualRent"
                    value={formData.annualRent}
                    onChange={handleInputChange}
                    placeholder="e.g., 500000"
                    className="border-3 border-foreground py-3"
                    required
                  />
                </div>

                {/* Description */}
                <div>
                  <label htmlFor="description" className="text-sm font-bold mb-2 block">
                    Description
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder="Describe the apartment (features, amenities, condition, etc.)"
                    className="w-full border-3 border-foreground px-3 py-3 font-bold bg-background min-h-30"
                    rows={5}
                  />
                </div>

                {/* Photo Upload */}
                <div>
                  <p className="text-sm font-bold mb-2 block">
                    Upload Photos (Minimum 3)
                  </p>
                  <div className="border-3 border-dashed border-foreground p-6 text-center cursor-pointer hover:bg-muted transition-colors">
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                      id="photo-upload"
                      required
                    />
                    <label htmlFor="photo-upload" className="cursor-pointer">
                      <div className="flex justify-center mb-2">
                        <Upload className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <p className="font-bold text-sm mb-1">
                        Click to upload photos
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Recent photos work best (we check metadata)
                      </p>
                    </label>
                  </div>
                  {formData.photos.length > 0 && (
                    <p className="text-sm font-bold mt-2 text-primary">
                      {formData.photos.length} photo(s) selected
                    </p>
                  )}
                </div>

                {/* Important Notes */}
                <div className="border-3 border-foreground bg-muted p-4">
                  <p className="text-sm font-bold mb-2">Important Rules:</p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Only report apartments in your building</li>
                    <li>
                      • Photos must be recent (we check when they were taken)
                    </li>
                    <li>
                      • Accurate information only (false reports get you banned)
                    </li>
                    <li>• Maximum 2 apartments per month</li>
                  </ul>
                </div>

                <Button
                  type="submit"
                  className="w-full border-3 border-foreground bg-primary px-6 py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  Submit Report
                </Button>
              </form>
            </Card>
          )}

          {step === "confirmation" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="flex h-16 w-16 items-center justify-center border-3 border-foreground bg-secondary">
                    <CheckCircle className="h-10 w-10" />
                  </div>
                </div>
                <h2 className="text-3xl font-black mb-2">
                  Apartment Reported!
                </h2>
                <p className="text-muted-foreground mb-6">
                  Your listing has been posted. Once a tenant rents through
                  Shelterflex, you'll earn ₦10-20k!
                </p>

                <div className="border-3 border-foreground bg-muted p-4 mb-6 space-y-3 text-left">
                  <h3 className="font-bold mb-2">Your Listing Details:</h3>
                  <div className="text-sm space-y-1">
                    <p>
                      <span className="font-bold">Address:</span>{" "}
                      {formData.address}
                    </p>
                    <p>
                      <span className="font-bold">Bedrooms:</span>{" "}
                      {formData.bedrooms}
                    </p>
                    <p>
                      <span className="font-bold">Bathrooms:</span>{" "}
                      {formData.bathrooms}
                    </p>
                    <p>
                      <span className="font-bold">Annual Rent:</span> ₦
                      {formData.annualRent}
                    </p>
                    <p>
                      <span className="font-bold">Photos:</span>{" "}
                      {formData.photos.length}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 md:flex-row">
                  <Link href="/whistleblower/dashboard" className="flex-1">
                    <Button className="w-full border-3 border-foreground bg-primary px-6 py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                      Back to Dashboard
                    </Button>
                  </Link>
                  <Link href="/whistleblower/report" className="flex-1">
                    <Button
                      variant="outline"
                      className="w-full border-3 border-foreground bg-transparent px-6 py-6 font-bold"
                    >
                      Report Another
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
