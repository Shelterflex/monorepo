"use client";

import React from "react";
import {
  useFormContext,
  type RegisterOptions,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { cn } from "@/lib/utils";

 function getErrorMessage(error: unknown): string {
   const rawMessage = (error as { message?: unknown } | null | undefined)?.message;

   if (typeof rawMessage === "string") return rawMessage;
   if (rawMessage == null) return "Invalid value";

   if (typeof rawMessage === "number" || typeof rawMessage === "boolean") {
     return String(rawMessage);
   }

   if (Array.isArray(rawMessage)) {
     const firstString = rawMessage.find((v) => typeof v === "string");
     if (typeof firstString === "string") return firstString;

     try {
       const json = JSON.stringify(rawMessage);
       return json ?? "Invalid value";
     } catch {
       return "Invalid value";
     }
   }

   if (typeof rawMessage === "object") {
     const nested = (rawMessage as { message?: unknown } | null)?.message;
     if (typeof nested === "string") return nested;

     try {
       const json = JSON.stringify(rawMessage);
       return json ?? "Invalid value";
     } catch {
       return "Invalid value";
     }
   }

   return "Invalid value";
 }

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
}: Readonly<FormFieldProps<T>>) {
  const {
    register,
    formState: { errors },
  } = useFormContext<T>();

  const error = errors[name];
  const errorId = `${name}-error`;
  const descId = `${name}-desc`;
  const describedBy = [description ? descId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  const inputElement = children && React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<any, any>, {
        id: (children.props as any).id ?? name,
        "aria-describedby": (children.props as any)["aria-describedby"] ?? describedBy,
        "aria-invalid": (children.props as any)["aria-invalid"] ?? !!error,
      } as any)
    : children;

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

      {inputElement ?? (
        <input
          id={name}
          type={type}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={describedBy}
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
          {getErrorMessage(error)}
        </p>
      )}
    </div>
  );
}
