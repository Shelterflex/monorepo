"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Upload, CheckCircle, Loader2, X, AlertCircle  } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { startWhistleblowerReport, trackWhistleblowerReportStep, trackFormSubmission } from "@/lib/analytics-init";

interface PhotoFile {
  id: string;
  url: string;
  file: File;
}
const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export default function ReportApartmentPage() {
  const [step, setStep] = useState<"form" | "confirmation">("form");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    address: "",
    bedrooms: "",
    bathrooms: "",
    annualRent: "",
    description: "",
    photos: [] as PhotoFile[],
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
      const newPhotos: PhotoFile[] = Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        file,
      }));
      setFormData((prev) => ({
        ...prev,
        photos: [...prev.photos, ...newPhotos],
      }));
    }
  };

  const handleRemovePhoto = (id: string) => {
    setFormData((prev) => {
      const photoToRemove = prev.photos.find((p) => p.id === id);
      if (photoToRemove) {
        URL.revokeObjectURL(photoToRemove.url);
      }
      return {
        ...prev,
        photos: prev.photos.filter((p) => p.id !== id),
      };
    });
  };

  // Clean up object URLs when component unmounts
  const photosRef = useRef(formData.photos);
  photosRef.current = formData.photos;

  useEffect(() => {
    return () => {
      photosRef.current.forEach((photo) => {
        URL.revokeObjectURL(photo.url);
      });
    };
  }, []);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    startWhistleblowerReport("anonymous");
    trackWhistleblowerReportStep("anonymous", "submit_listing_report");
    setServerError(null);

    if (!formData.address || !formData.bedrooms || !formData.annualRent) return;
    if (formData.photos.length < 3) {
      setServerError("Please upload at least 3 photos.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        address: formData.address,
        bedrooms: parseInt(formData.bedrooms, 10),
        bathrooms: parseInt(formData.bathrooms || "1", 10),
        annualRentNgn: parseInt(formData.annualRent, 10),
        description: formData.description || undefined,
        photos: formData.photos,
      };

      const res = await fetch(`${API_BASE}/api/whistleblower/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json() as { error?: { message?: string }; message?: string };

      if (!res.ok) {
        const msg =
          data?.error?.message ||
          data?.message ||
          (res.status === 429
            ? "You have reached the monthly listing limit (2 per month)."
            : "Failed to submit report. Please try again.");
        setServerError(msg);
        return;
      }

      trackFormSubmission("whistleblower_report", { photo_count: formData.photos.length });
      trackWhistleblowerReportStep("anonymous", "report_submitted", { completed: true });
      setStep("confirmation");
    } catch {
      setServerError(
        "Network error — please check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
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

                  {/* Photo Previews */}
                  {formData.photos.length > 0 && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-bold">
                          {formData.photos.length} photo{formData.photos.length !== 1 ? 's' : ''} selected
                        </p>
                        {formData.photos.length < 3 && (
                          <p className="text-xs text-destructive font-bold flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Minimum 3 photos required
                          </p>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {formData.photos.map((photo) => (
                          <div
                            key={photo.id}
                            className="relative group border-3 border-foreground overflow-hidden"
                          >
                            <Image
                              src={photo.url}
                              alt="Preview"
                              width={240}
                              height={96}
                              unoptimized
                              className="w-full h-24 object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemovePhoto(photo.id)}
                              className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center bg-destructive text-white border-2 border-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label="Remove photo"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Validation Error */}
                  {formData.photos.length > 0 && formData.photos.length < 3 && (
                    <div className="mt-2 flex items-start gap-2 border-2 border-destructive bg-destructive/10 p-3">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <p className="text-xs text-destructive">
                        You need at least 3 photos to submit your report. You have {formData.photos.length}. Please add more photos or remove some and upload different ones.
                      </p>
                    </div>
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

                {serverError && (
                  <div
                    role="alert"
                    className="border-3 border-destructive bg-red-50 p-4 text-sm font-bold text-destructive"
                  >
                    {serverError}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full border-3 border-foreground bg-primary px-6 py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    "Submit Report"
                  )}
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
