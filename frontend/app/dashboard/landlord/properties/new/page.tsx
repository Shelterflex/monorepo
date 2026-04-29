"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Upload,
  X,
  Home,
  Sofa,
  UtensilsCrossed,
  Bath,
  BedDouble,
  Car,
  Trees,
  Building2,
  Plus,
  ImageIcon,
} from "lucide-react"
import { landlordApi } from "@/lib/landlordApi"
import { showErrorToast, showSuccessToast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const roomTypes = [
  { id: "living", label: "Living Room", icon: Sofa },
  { id: "bedroom", label: "Bedroom", icon: BedDouble },
  { id: "kitchen", label: "Kitchen", icon: UtensilsCrossed },
  { id: "bathroom", label: "Bathroom", icon: Bath },
  { id: "exterior", label: "Exterior", icon: Home },
  { id: "parking", label: "Parking", icon: Car },
  { id: "garden", label: "Garden/Balcony", icon: Trees },
  { id: "other", label: "Other", icon: Building2 },
]

const amenities = [
  "Air Conditioning",
  "Swimming Pool",
  "Gym",
  "24/7 Security",
  "Parking Space",
  "Generator",
  "Water Supply",
  "Fitted Kitchen",
  "Walk-in Closet",
  "Balcony",
  "Garden",
  "Smart Home",
  "Elevator",
  "CCTV",
  "Intercom",
  "Staff Quarters",
]

interface RoomImage {
  id: string
  roomType: string
  preview: string
  file?: File
}

export default function NewPropertyPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [images, setImages] = useState<RoomImage[]>([])
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([])
  const imageIdCounterRef = useRef(0)
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    propertyType: "",
    location: "",
    address: "",
    price: "",
    beds: "",
    baths: "",
    sqm: "",
    yearBuilt: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Hidden file input ref for the real file picker
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingRoomTypeRef = useRef<string>("")

  const handleImageUpload = (roomType: string) => {
    pendingRoomTypeRef.current = roomType
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const roomType = pendingRoomTypeRef.current
    const newImages: RoomImage[] = Array.from(files).map((file) => {
      imageIdCounterRef.current += 1
      return {
        id: `${roomType}-${imageIdCounterRef.current}`,
        roomType,
        preview: URL.createObjectURL(file),
        file,
      }
    })

    setImages((prev) => [...prev, ...newImages])
    // Reset so the same file can be re-selected if removed and re-added
    e.target.value = ""
  }

  const removeImage = (id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id)
      // Revoke the object URL to free memory
      if (img?.preview && img.preview.startsWith("blob:")) {
        URL.revokeObjectURL(img.preview)
      }
      return prev.filter((i) => i.id !== id)
    })
  }

  const toggleAmenity = (amenity: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(amenity) ? prev.filter((a) => a !== amenity) : [...prev, amenity]
    )
  }

  const handleSubmit = async () => {
    try {
      setFieldErrors({})
      setSubmitting(true)
      const payload = {
        title: formData.title,
        description: formData.description,
        propertyType: formData.propertyType,
        location: formData.location,
        address: formData.address,
        price: formData.price,
        beds: formData.beds,
        baths: formData.baths,
        sqm: formData.sqm,
        yearBuilt: formData.yearBuilt,
        amenities: selectedAmenities,
        images: images.map(({ id, roomType, preview }) => ({ id, roomType, preview })),
      }

      await landlordApi.createProperty(payload)
      showSuccessToast("Property submitted for review.")
      router.push("/dashboard/landlord")
    } catch (error: any) {
      if (error?.details?.fieldErrors) {
        const errors: Record<string, string> = {}
        for (const [key, val] of Object.entries(error.details.fieldErrors)) {
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
            errors[key] = val[0]
          }
        }
        if (errors.annualRentNgn) { errors.price = errors.annualRentNgn; delete errors.annualRentNgn; }
        if (errors.bedrooms) { errors.beds = errors.bedrooms; delete errors.bedrooms; }
        if (errors.bathrooms) { errors.baths = errors.bathrooms; delete errors.bathrooms; }
        
        setFieldErrors(errors)
        
        const step1Keys = ['title', 'description', 'propertyType', 'location', 'address', 'price', 'beds', 'baths', 'sqm', 'yearBuilt']
        const hasStep1Error = Object.keys(errors).some(k => step1Keys.includes(k))
        if (hasStep1Error) {
          setStep(1)
        }
      }
      showErrorToast(error, "Failed to create property. Please check your inputs and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background pt-20">
      <div className="mx-auto max-w-4xl p-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard/landlord"
            className="mb-4 inline-flex items-center gap-2 font-bold text-foreground hover:text-primary"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to Dashboard
          </Link>
          <h1 className="text-4xl font-bold text-foreground">Add New Property</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            List your property and find the perfect tenants
          </p>
        </div>

        {/* Progress Steps */}
        <div className="mb-8 flex items-center gap-4">
          {[1, 2, 3].map((s) => {
            let stepLabel = "Amenities";
            if (s === 1) stepLabel = "Basic Info";
            else if (s === 2) stepLabel = "Photos";

            return (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`flex h-10 w-10 items-center justify-center border-3 border-foreground font-bold ${
                    step >= s ? "bg-primary" : "bg-muted"
                  }`}
                >
                  {s}
                </div>
                <span
                  className={`font-medium ${step >= s ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {stepLabel}
                </span>
                {s < 3 && (
                  <div className="mx-2 h-1 w-12 border-2 border-foreground bg-muted" />
                )}
              </div>
            );
          })}
        </div>

        {/* Step 1: Basic Info */}
        {step === 1 && (
          <Card className="border-3 border-foreground p-8 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <h2 className="mb-6 text-2xl font-bold">Property Details</h2>

            <div className="grid gap-6">
              <div className="grid gap-2">
                <Label htmlFor="title" className="text-base font-bold">
                  Property Title
                </Label>
                <Input
                  id="title"
                  placeholder="e.g., Luxury 3 Bedroom Apartment in Victoria Island"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="border-3 border-foreground p-4 text-lg shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                />
                {fieldErrors.title && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.title}</p>}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="description" className="text-base font-bold">
                  Description
                </Label>
                <Textarea
                  id="description"
                  placeholder="Describe your property in detail..."
                  rows={4}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                />
                {fieldErrors.description && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.description}</p>}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="propertyType" className="text-base font-bold">Property Type</Label>
                  <Select
                    value={formData.propertyType}
                    onValueChange={(value) => setFormData({ ...formData, propertyType: value })}
                  >
                    <SelectTrigger
                      id="propertyType"
                      className="border-3 border-foreground p-4 text-lg shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent className="border-3 border-foreground">
                      <SelectItem value="apartment">Apartment</SelectItem>
                      <SelectItem value="duplex">Duplex</SelectItem>
                      <SelectItem value="bungalow">Bungalow</SelectItem>
                      <SelectItem value="terrace">Terrace</SelectItem>
                      <SelectItem value="penthouse">Penthouse</SelectItem>
                      <SelectItem value="studio">Studio</SelectItem>
                    </SelectContent>
                  </Select>
                  {fieldErrors.propertyType && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.propertyType}</p>}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="location" className="text-base font-bold">Location</Label>
                  <Select
                    value={formData.location}
                    onValueChange={(value) => setFormData({ ...formData, location: value })}
                  >
                    <SelectTrigger
                      id="location"
                      className="border-3 border-foreground p-4 text-lg shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <SelectValue placeholder="Select area" />
                    </SelectTrigger>
                    <SelectContent className="border-3 border-foreground">
                      <SelectItem value="vi">Victoria Island</SelectItem>
                      <SelectItem value="lekki">Lekki</SelectItem>
                      <SelectItem value="ikoyi">Ikoyi</SelectItem>
                      <SelectItem value="ajah">Ajah</SelectItem>
                      <SelectItem value="yaba">Yaba</SelectItem>
                      <SelectItem value="surulere">Surulere</SelectItem>
                      <SelectItem value="ikeja">Ikeja</SelectItem>
                    </SelectContent>
                  </Select>
                  {fieldErrors.location && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.location}</p>}
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="address" className="text-base font-bold">
                  Full Address
                </Label>
                <Input
                  id="address"
                  placeholder="Enter the full property address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="border-3 border-foreground p-4 text-lg shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                />
                {fieldErrors.address && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.address}</p>}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="price" className="text-base font-bold">
                    Annual Rent (₦)
                  </Label>
                  <Input
                    id="price"
                    type="number"
                    placeholder="e.g., 3500000"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    className="border-3 border-foreground p-4 text-lg shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                  {fieldErrors.price && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.price}</p>}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="sqm" className="text-base font-bold">
                    Size (sqm)
                  </Label>
                  <Input
                    id="sqm"
                    type="number"
                    placeholder="e.g., 150"
                    value={formData.sqm}
                    onChange={(e) => setFormData({ ...formData, sqm: e.target.value })}
                    className="border-3 border-foreground p-4 text-lg shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                  {fieldErrors.sqm && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.sqm}</p>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="beds" className="text-base font-bold">
                    Bedrooms
                  </Label>
                  <Input
                    id="beds"
                    type="number"
                    placeholder="e.g., 3"
                    value={formData.beds}
                    onChange={(e) => setFormData({ ...formData, beds: e.target.value })}
                    className="border-3 border-foreground p-4 text-lg shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                  {fieldErrors.beds && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.beds}</p>}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="baths" className="text-base font-bold">
                    Bathrooms
                  </Label>
                  <Input
                    id="baths"
                    type="number"
                    placeholder="e.g., 2"
                    value={formData.baths}
                    onChange={(e) => setFormData({ ...formData, baths: e.target.value })}
                    className="border-3 border-foreground p-4 text-lg shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                  {fieldErrors.baths && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.baths}</p>}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="yearBuilt" className="text-base font-bold">
                    Year Built
                  </Label>
                  <Input
                    id="yearBuilt"
                    type="number"
                    placeholder="e.g., 2020"
                    value={formData.yearBuilt}
                    onChange={(e) => setFormData({ ...formData, yearBuilt: e.target.value })}
                    className="border-3 border-foreground p-4 text-lg shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                  {fieldErrors.yearBuilt && <p className="text-sm font-medium text-destructive mt-1">{fieldErrors.yearBuilt}</p>}
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <Button
                onClick={() => setStep(2)}
                className="border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                Continue to Photos
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Photos */}
        {step === 2 && (
          <Card className="border-3 border-foreground p-8 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <h2 className="mb-2 text-2xl font-bold">Property Photos</h2>
            <p className="mb-6 text-muted-foreground">
              Add photos of different rooms to help tenants visualize your property
            </p>

            {/* Hidden file input for real file picker */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              aria-label="Upload room photos"
              onChange={handleFileChange}
            />

            {/* Room Type Selector */}
            <div className="mb-8">
              <p className="mb-4 block text-base font-bold">Select room type and upload photos</p>
              <div className="grid grid-cols-4 gap-4">
                {roomTypes.map((room) => {
                  const roomImages = images.filter((img) => img.roomType === room.id)
                  return (
                    <button
                      key={room.id}
                      onClick={() => handleImageUpload(room.id)}
                      className="group relative flex flex-col items-center gap-2 border-3 border-foreground bg-card p-4 transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <room.icon className="h-8 w-8" />
                      <span className="text-sm font-medium">{room.label}</span>
                      {roomImages.length > 0 && (
                        <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center border-2 border-foreground bg-secondary text-xs font-bold">
                          {roomImages.length}
                        </span>
                      )}
                      <Plus className="absolute bottom-2 right-2 h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Uploaded Images Grid */}
            {images.length > 0 && (
              <div className="mb-8">
                <p className="mb-4 block text-base font-bold">
                  Uploaded Photos ({images.length})
                </p>
                <div className="grid grid-cols-4 gap-4">
                  {images.map((image) => {
                    const roomType = roomTypes.find((r) => r.id === image.roomType)
                    return (
                      <div
                        key={image.id}
                        className="group relative aspect-video border-3 border-foreground bg-muted"
                      >
                        {image.preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={image.preview}
                            alt={`${roomType?.label ?? image.roomType} photo`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImageIcon className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 border-t-3 border-foreground bg-card/90 px-2 py-1">
                          <span className="text-xs font-medium">{roomType?.label}</span>
                        </div>
                        <button
                          onClick={() => removeImage(image.id)}
                          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center border-2 border-foreground bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {images.length === 0 && (
              <div className="mb-8 flex flex-col items-center justify-center border-3 border-dashed border-foreground bg-muted/50 p-12">
                <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No photos uploaded yet</p>
                <p className="text-muted-foreground">Click on a room type above to add photos</p>
              </div>
            )}

            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="border-3 border-foreground bg-transparent px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                className="border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                Continue to Amenities
              </Button>
            </div>
          </Card>
        )}

        {/* Step 3: Amenities */}
        {step === 3 && (
          <Card className="border-3 border-foreground p-8 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <h2 className="mb-2 text-2xl font-bold">Amenities & Features</h2>
            <p className="mb-6 text-muted-foreground">
              Select the amenities available in your property
            </p>

            <div className="mb-8 grid grid-cols-4 gap-4">
              {amenities.map((amenity) => (
                <button
                  key={amenity}
                  onClick={() => toggleAmenity(amenity)}
                  className={`border-3 border-foreground p-4 text-left font-medium transition-all ${
                    selectedAmenities.includes(amenity)
                      ? "bg-secondary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                      : "bg-card hover:bg-muted"
                  }`}
                >
                  {amenity}
                </button>
              ))}
            </div>

            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep(2)}
                className="border-3 border-foreground bg-transparent px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                {submitting ? "Publishing..." : "Publish Property"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
