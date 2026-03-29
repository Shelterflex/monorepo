"use client";

import React from "react";
import { FormProvider, type UseFormReturn, type FieldValues } from "react-hook-form";
import { cn } from "@/lib/utils";

interface AppFormProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  onSubmit: (values: T) => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
  /** Accessible label for the form */
  "aria-label"?: string;
}

/**
 * Wrapper that provides FormContext and handles submit + keyboard navigation.
 * Pair with <FormField> for individual fields.
 */
export function AppForm<T extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
  "aria-label": ariaLabel,
}: AppFormProps<T>) {
  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn("space-y-4", className)}
        aria-label={ariaLabel}
        noValidate
      >
        {children}
      </form>
    </FormProvider>
  );
}
