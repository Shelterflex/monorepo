"use client";

import React from "react";
import { useFormContext, type FieldValues, type Path, type PathValue } from "react-hook-form";

interface ConditionalFieldProps<T extends FieldValues> {
  /** Watch this field's value */
  watchField: Path<T>;
  /** Render children only when the watched value satisfies this predicate */
  when: (value: PathValue<T, Path<T>>) => boolean;
  children: React.ReactNode;
}

/**
 * Renders children only when a watched field value satisfies a condition.
 * Must be used inside <AppForm> / <FormProvider>.
 */
export function ConditionalField<T extends FieldValues>({
  watchField,
  when,
  children,
}: ConditionalFieldProps<T>) {
  const { watch } = useFormContext<T>();
  const value = watch(watchField);
  return when(value) ? <>{children}</> : null;
}
