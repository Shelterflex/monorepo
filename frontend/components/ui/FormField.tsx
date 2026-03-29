"use client";

import React from "react";
import {
  useFormContext,
  type RegisterOptions,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { cn } from "@/lib/utils";

interface FormFieldProps<T extends FieldValues> {
  name: Path<T>;
  label: string;
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  description?: string;
  rules?: RegisterOptions<T>;
  disabled?: boolean;
  className?: string;
  /** Render a custom input instead of the default <input> */
  children?: React.ReactNode;
}

/**
 * Accessible form field with label, error message, and optional description.
 * Must be used inside a <FormProvider> (react-hook-form).
 */
export function FormField<T extends FieldValues>({
  name,
  label,
  type = "text",
  placeholder,
  description,
  rules,
  disabled,
  className,
  children,
}: FormFieldProps<T>) {
  const {
    register,
    formState: { errors },
  } = useFormContext<T>();

  const error = errors[name];
  const errorId = `${name}-error`;
  const descId = `${name}-desc`;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={name}
        className="text-sm font-medium text-foreground"
      >
        {label}
      </label>

      {description && (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}

      {children ?? (
        <input
          id={name}
          type={type}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={
            [description ? descId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={!!error}
          className={cn(
            "rounded-md border border-input bg-background px-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-destructive focus:ring-destructive"
          )}
          {...register(name, rules)}
        />
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-destructive"
        >
          {String(error.message ?? "Invalid value")}
        </p>
      )}
    </div>
  );
}
