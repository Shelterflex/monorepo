/**
 * Centralised Zod schemas for all app forms.
 * Import the schema you need and pass it to useAppForm's `schema` option.
 */
import { z } from "zod";

// ── Primitives ────────────────────────────────────────────────────────────────

export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Enter a valid email address");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/\d/, "Password must include at least one number");

export const phoneSchema = z
  .string()
  .min(10, "Phone number must be at least 10 digits")
  .regex(/^[0-9+() \-]+$/, "Phone number contains invalid characters");

export const optionalPhoneSchema = z
  .string()
  .transform((value) => value.trim())
  .refine(
    (value) => !value || /^[0-9+() \-]+$/.test(value),
    {
      message: "Phone number contains invalid characters",
    }
  )
  .optional();

export const amountSchema = z
  .string()
  .min(1, "Amount is required")
  .refine((v) => !isNaN(Number(v)) && Number(v) > 0, {
    message: "Amount must be a positive number",
  });

// ── Auth ──────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: emailSchema,
});

export const otpSchema = z.object({
  otp: z
    .string()
    .length(6, "OTP must be exactly 6 digits")
    .regex(/^\d+$/, "OTP must contain only digits"),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const signupSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
});

export const partnerSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  phone: phoneSchema,
  email: emailSchema,
  propertyCount: z.preprocess(
    (value) => Number(value),
    z.number().min(1, "Enter number of properties")
  ),
  propertyLocations: z.string().min(2, "Property location is required"),
});

// ── Staking ───────────────────────────────────────────────────────────────────

export const stakeSchema = z.object({
  amount: amountSchema,
  currency: z.enum(["USDC", "NGN"], { required_error: "Select a currency" }),
  duration: z.number().min(1, "Duration must be at least 1 day"),
});

// ── Deposit ───────────────────────────────────────────────────────────────────

export const depositSchema = z.object({
  amount: amountSchema,
  reference: z.string().optional(),
});

// ── Whistleblower ─────────────────────────────────────────────────────────────

export const whistleblowerSchema = z.object({
  subject: z.string().min(5, "Subject must be at least 5 characters"),
  description: z.string().min(20, "Please provide more detail (min 20 chars)"),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().url(),
      })
    )
    .optional(),
});

// ── Contact ───────────────────────────────────────────────────────────────────

export const contactSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: emailSchema,
  phone: optionalPhoneSchema,
  subject: z.string().min(5, "Subject is required"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

// ── Type exports ──────────────────────────────────────────────────────────────

export type LoginFormValues = z.infer<typeof loginSchema>;
export type OtpFormValues = z.infer<typeof otpSchema>;
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
export type SignupFormValues = z.infer<typeof signupSchema>;
export type PartnerFormValues = z.infer<typeof partnerSchema>;
export type StakeFormValues = z.infer<typeof stakeSchema>;
export type DepositFormValues = z.infer<typeof depositSchema>;
export type WhistleblowerFormValues = z.infer<typeof whistleblowerSchema>;
export type ContactFormValues = z.infer<typeof contactSchema>;
