import { z } from "zod";

/**
 * Evaluation request for POST /evaluate/:applicationId
 */
export const evaluateApplicationBodySchema = z
  .object({
    paymentHistory: z
      .object({
        onTimePaymentRate: z
          .number()
          .min(0)
          .max(1)
          .describe("Rate between 0 and 1"),
        missedPayments: z
          .number()
          .int()
          .min(0)
          .describe("Number of missed payments"),
        totalPayments: z
          .number()
          .int()
          .min(0)
          .describe("Total number of payments"),
      })
      .optional()
      .describe("Optional payment history data"),
    metadata: z
      .record(z.unknown())
      .optional()
      .describe("Optional metadata for evaluation context"),
  })
  .strict();

export type EvaluateApplicationBody = z.infer<
  typeof evaluateApplicationBodySchema
>;

/**
 * Config update request for PUT /config
 * Validates all updatable fields of the rule engine config
 */
export const updateRuleConfigBodySchema = z
  .object({
    version: z.string().optional().describe("Config version identifier"),
    approveThreshold: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Score threshold for auto-approval (0-100)"),
    reviewThreshold: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Score threshold for manual review (0-100)"),
    rules: z
      .array(
        z.object({
          ruleId: z.string().min(1).describe("Unique rule identifier"),
          ruleName: z.string().min(1).describe("Human-readable rule name"),
          weight: z.number().int().min(0).describe("Rule weight in scoring"),
          enabled: z.boolean().describe("Whether the rule is active"),
          threshold: z
            .number()
            .optional()
            .describe("Threshold value for this rule if applicable"),
          severity: z
            .enum(["critical", "warning", "info"])
            .describe("Rule severity level"),
        }),
      )
      .optional()
      .describe("Array of rule configurations"),
  })
  .strict();

export type UpdateRuleConfigBody = z.infer<typeof updateRuleConfigBodySchema>;
