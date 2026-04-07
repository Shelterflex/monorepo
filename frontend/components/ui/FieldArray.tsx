"use client";

import React from "react";
import {
  useFieldArray,
  useFormContext,
  type FieldValues,
  type ArrayPath,
  type FieldArray,
} from "react-hook-form";
import { cn } from "@/lib/utils";

interface FieldArrayProps<T extends FieldValues> {
  name: ArrayPath<T>;
  label: string;
  defaultItem: FieldArray<T, ArrayPath<T>>;
  renderItem: (index: number, remove: () => void) => React.ReactNode;
  addLabel?: string;
  maxItems?: number;
  className?: string;
}

/**
 * Reusable field array component for dynamic lists (e.g. attachments, addresses).
 * Must be used inside <AppForm> / <FormProvider>.
 */
export function FieldArrayField<T extends FieldValues>({
  name,
  label,
  defaultItem,
  renderItem,
  addLabel = "Add item",
  maxItems,
  className,
}: Readonly<FieldArrayProps<T>>) {
  const { control } = useFormContext<T>();
  const { fields, append, remove } = useFieldArray({ control, name });

  const canAdd = maxItems === undefined || fields.length < maxItems;

  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="text-sm font-medium text-foreground">{label}</legend>

      {fields.map((field, index) => (
        <fieldset
          key={field.id}
          className="border-0 p-0 m-0 min-w-0"
        >
          <legend className="sr-only">{`${label} item ${index + 1}`}</legend>
          {renderItem(index, () => remove(index))}
        </fieldset>
      ))}

      {canAdd && (
        <button
          type="button"
          onClick={() => append(defaultItem)}
          className={cn(
            "text-sm font-medium text-primary underline-offset-2 hover:underline",
            "focus:outline-none focus:ring-2 focus:ring-ring rounded"
          )}
        >
          + {addLabel}
        </button>
      )}
    </fieldset>
  );
}
