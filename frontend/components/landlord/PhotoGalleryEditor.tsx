"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  GripVertical,
  Star,
  Upload,
  X,
  Loader2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  deletePropertyPhoto,
  uploadPropertyPhotos,
} from "@/lib/landlordPropertiesApi";
import { cn } from "@/lib/utils";

export interface ListingPhoto {
  id: string;
  preview: string;
  file?: File;
}

interface PhotoGalleryEditorProps {
  propertyId?: string;
  photos: ListingPhoto[];
  primaryPhotoId: string | null;
  onChange: (photos: ListingPhoto[], primaryPhotoId: string | null) => void;
  maxPhotos?: number;
  minPhotos?: number;
}

export function PhotoGalleryEditor({
  propertyId,
  photos,
  primaryPhotoId,
  onChange,
  maxPhotos = 20,
  minPhotos = 3,
}: PhotoGalleryEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragPhotoId, setDragPhotoId] = useState<string | null>(null);
  const [uploadingPhotoIds, setUploadingPhotoIds] = useState<
    Record<string, boolean>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const availableSlots = maxPhotos - photos.length;

  const setPrimary = useCallback(
    (photoId: string) => {
      onChange(photos, photoId);
    },
    [onChange, photos],
  );

  const updatePhotos = useCallback(
    (nextPhotos: ListingPhoto[]) => {
      const nextPrimary =
        primaryPhotoId &&
        nextPhotos.some((photo) => photo.id === primaryPhotoId)
          ? primaryPhotoId
          : (nextPhotos[0]?.id ?? null);
      onChange(nextPhotos, nextPrimary);
    },
    [onChange, primaryPhotoId],
  );

  const isPersistedPhoto = useCallback((photo: ListingPhoto) => {
    return !photo.id.startsWith("photo-") && !photo.id.startsWith("existing-");
  }, []);

  const removePhoto = useCallback(
    async (id: string) => {
      const nextPhotos = photos.filter((photo) => photo.id !== id);
      updatePhotos(nextPhotos);
      setUploadingPhotoIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      const removedPhoto = photos.find((photo) => photo.id === id);
      if (!removedPhoto || !propertyId || !isPersistedPhoto(removedPhoto)) {
        return;
      }

      try {
        await deletePropertyPhoto(propertyId, id);
      } catch {
        setErrors((prev) => ({
          ...prev,
          [id]: "Unable to delete uploaded photo. It will be removed locally.",
        }));
      }
    },
    [photos, propertyId, updatePhotos, isPersistedPhoto],
  );

  const retryUpload = useCallback(
    async (id: string) => {
      const photo = photos.find((p) => p.id === id);
      if (!photo || !photo.file || !propertyId) return;

      setErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      setUploadingPhotoIds((prev) => ({ ...prev, [id]: true }));

      try {
        const response = await uploadPropertyPhotos(propertyId, [photo.file]);
        const uploadedPhoto = response.photos[0];

        const nextPhotos = photos.map((p) =>
          p.id === id
            ? { id: uploadedPhoto.id, preview: uploadedPhoto.url }
            : p,
        );
        const nextPrimaryId =
          primaryPhotoId === id ? uploadedPhoto.id : primaryPhotoId;
        onChange(nextPhotos, nextPrimaryId);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Upload failed";
        setErrors((prev) => ({
          ...prev,
          [id]: errorMessage,
        }));
      } finally {
        setUploadingPhotoIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [photos, primaryPhotoId, onChange, propertyId],
  );

  const reorderPhoto = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const nextPhotos = [...photos];
      const fromIndex = nextPhotos.findIndex((photo) => photo.id === fromId);
      const toIndex = nextPhotos.findIndex((photo) => photo.id === toId);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = nextPhotos.splice(fromIndex, 1);
      nextPhotos.splice(toIndex, 0, moved);
      updatePhotos(nextPhotos);
    },
    [photos, updatePhotos],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const selected = Array.from(files).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (selected.length === 0 || availableSlots <= 0) {
        return;
      }

      const toAdd = selected.slice(0, availableSlots).map((file) => {
        return {
          id: `photo-${crypto.randomUUID()}`,
          preview: URL.createObjectURL(file),
          file,
        };
      });

      const nextPhotos = [...photos, ...toAdd];
      updatePhotos(nextPhotos);

      if (!propertyId) {
        return;
      }

      const uploadingIds = toAdd.reduce(
        (acc, photo) => ({ ...acc, [photo.id]: true }),
        {} as Record<string, boolean>,
      );
      setUploadingPhotoIds((prev) => ({ ...prev, ...uploadingIds }));
      setErrors((prev) => {
        const next = { ...prev };
        toAdd.forEach((photo) => delete next[photo.id]);
        return next;
      });

      try {
        const response = await uploadPropertyPhotos(
          propertyId,
          toAdd.map((photo) => photo.file!),
        );
        const uploadedPhotos: ListingPhoto[] = response.photos.map((photo) => ({
          id: photo.id,
          preview: photo.url,
        }));

        const placeholderMap = new Map(
          toAdd.map((photo, index) => [photo.id, uploadedPhotos[index]]),
        );
        const persistedPhotos = nextPhotos.map(
          (photo) => placeholderMap.get(photo.id) ?? photo,
        );
        const nextPrimaryId =
          primaryPhotoId && placeholderMap.has(primaryPhotoId)
            ? (placeholderMap.get(primaryPhotoId)?.id ?? primaryPhotoId)
            : primaryPhotoId;
        onChange(persistedPhotos, nextPrimaryId);
      } catch (error) {
        const failedIds = toAdd.map((photo) => photo.id);
        setErrors((prev) => ({
          ...prev,
          ...Object.fromEntries(failedIds.map((id) => [id, "Upload failed."])),
        }));
      } finally {
        setUploadingPhotoIds((prev) => {
          const next = { ...prev };
          toAdd.forEach((photo) => delete next[photo.id]);
          return next;
        });
      }
    },
    [availableSlots, photos, propertyId, updatePhotos, onChange, primaryPhotoId],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer.files?.length) {
        handleFiles(event.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const fileBrowse = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const primaryLabel = useMemo(() => {
    if (photos.length === 0) {
      return `Upload ${minPhotos} photos to continue.`;
    }
    return (
      `${photos.length} / ${maxPhotos} photos` +
      (photos.length < minPhotos ? " (minimum required)" : "")
    );
  }, [photos.length, maxPhotos, minPhotos]);

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) {
            handleFiles(event.target.files);
          }
          event.target.value = "";
        }}
      />

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        className="mb-6 flex flex-col items-center border-3 border-dashed border-foreground bg-muted/40 p-10"
      >
        <Upload className="mb-2 h-10 w-10" />
        <p className="font-medium">Drag & drop photos here</p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={fileBrowse}
          disabled={photos.length >= maxPhotos}
        >
          Browse files
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {photos.map((photo) => (
          <div
            key={photo.id}
            draggable
            onDragStart={() => setDragPhotoId(photo.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragPhotoId) {
                reorderPhoto(dragPhotoId, photo.id);
              }
              setDragPhotoId(null);
            }}
            className="relative aspect-video overflow-hidden rounded-md border-2 border-foreground bg-muted"
          >
            <Image
              src={photo.preview}
              alt="Property photo"
              fill
              unoptimized={photo.preview.startsWith("blob:") || photo.preview.startsWith("data:")}
              sizes="(max-width: 768px) 50vw, 25vw"
              className="object-cover"
            />
            <div className="absolute left-1 top-1 flex gap-1">
              <span className="bg-background/90 p-1">
                <GripVertical className="h-4 w-4" />
              </span>
              <button
                type="button"
                aria-label="Set as primary photo"
                onClick={() => setPrimary(photo.id)}
                className={cn(
                  "border border-foreground bg-background/90 p-1",
                  primaryPhotoId === photo.id && "bg-primary",
                )}
              >
                <Star className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => removePhoto(photo.id)}
              className="absolute right-1 top-1 rounded bg-destructive p-1 text-destructive-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            {uploadingPhotoIds[photo.id] && (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/50 p-2 text-xs text-white">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading
              </div>
            )}
            {errors[photo.id] && (
              <div className="absolute inset-x-0 bottom-0 bg-destructive/90 p-2 text-xs text-white">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    {errors[photo.id]}
                  </span>
                  <button
                    type="button"
                    onClick={() => retryUpload(photo.id)}
                    className="flex items-center gap-1 rounded bg-white/20 px-2 py-1 text-xs font-medium hover:bg-white/30"
                    aria-label="Retry upload"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between text-sm font-medium">
        <Label>{primaryLabel}</Label>
        <span className="text-muted-foreground">
          Drag to reorder • star to select primary
        </span>
      </div>
    </div>
  );
}
