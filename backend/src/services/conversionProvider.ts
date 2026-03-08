export interface ConvertNgnToUsdcInput {
  amountNgn: number
  userId: string
  depositId: string
}

export interface ConvertNgnToUsdcOutput {
  amountUsdc: string
  fxRateNgnPerUsdc: number
  providerRef: string
}

export interface ConversionProvider {
  convertNgnToUsdc(input: ConvertNgnToUsdcInput): Promise<ConvertNgnToUsdcOutput>
}

function toUsdcDecimalString(amountUsdc: number): string {
  // USDC canonical formatting: up to 6 decimals. Use fixed 6 to be deterministic.
  if (!Number.isFinite(amountUsdc)) {
    throw new Error('Invalid USDC amount')
  }
  return amountUsdc.toFixed(6)
}

/**
 * MVP stub conversion provider.
 * Deterministic and side-effect free.
 */
export class StubConversionProvider implements ConversionProvider {
  constructor(private fxRateNgnPerUsdc: number) {}

  async convertNgnToUsdc(input: ConvertNgnToUsdcInput): Promise<ConvertNgnToUsdcOutput> {
    if (input.amountNgn <= 0) {
      throw new Error('amountNgn must be positive')
    }
    if (this.fxRateNgnPerUsdc <= 0) {
      throw new Error('fxRateNgnPerUsdc must be positive')
    }

    const amountUsdc = input.amountNgn / this.fxRateNgnPerUsdc

    return {
      amountUsdc: toUsdcDecimalString(amountUsdc),
      fxRateNgnPerUsdc: this.fxRateNgnPerUsdc,
      providerRef: `stub:${input.depositId}`,
    }
  }
}
