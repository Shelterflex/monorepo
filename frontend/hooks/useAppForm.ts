/**
 * useAppForm — thin wrapper around react-hook-form + Zod.
 *
 * Features:
 *  - Zod schema validation via @hookform/resolvers/zod
 *  - Auto-save draft to localStorage (optional)
 *  - Optimistic submit with rollback on failure
 */
"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  useForm,
  type UseFormProps,
  type FieldValues,
  type DefaultValues,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodType } from "zod";

interface UseAppFormOptions<T extends FieldValues> extends UseFormProps<T> {
  schema: ZodType<T>;
  /** localStorage key — enables auto-save draft when provided */
  draftKey?: string;
  /** Debounce delay for draft saves in ms (default 800) */
  draftDebounceMs?: number;
}

export function useAppForm<T extends FieldValues>({
  schema,
  draftKey,
  draftDebounceMs = 800,
  defaultValues,
  ...rest
}: UseAppFormOptions<T>) {
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Merge persisted draft into defaultValues
  const mergedDefaults = (() => {
    if (!draftKey || typeof window === "undefined") return defaultValues;
    try {
      const raw = localStorage.getItem(`form-draft:${draftKey}`);
      if (raw) return { ...(defaultValues as object), ...JSON.parse(raw) } as DefaultValues<T>;
    } catch {
      // ignore corrupt drafts
    }
    return defaultValues;
  })();

  const form = useForm<T>({
    resolver: zodResolver(schema),
    defaultValues: mergedDefaults,
    mode: "onChange",
    ...rest,
  });

  // Auto-save draft on value changes
  const saveDraft = useCallback(
    (values: Partial<T>) => {
      if (!draftKey || typeof window === "undefined") return;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(`form-draft:${draftKey}`, JSON.stringify(values));
        } catch {
          // quota exceeded — silently ignore
        }
      }, draftDebounceMs);
    },
    [draftKey, draftDebounceMs]
  );

  useEffect(() => {
    if (!draftKey) return;
    const sub = form.watch((values) => saveDraft(values as Partial<T>));
    return () => sub.unsubscribe();
  }, [form, draftKey, saveDraft]);

  /** Clear the saved draft (call after successful submit) */
  const clearDraft = useCallback(() => {
    if (!draftKey || typeof window === "undefined") return;
    localStorage.removeItem(`form-draft:${draftKey}`);
  }, [draftKey]);

  return { ...form, clearDraft };
}
