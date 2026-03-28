import { Resend } from 'resend'
import { OtpDeliveryProvider, generateOtpEmailTemplate } from './otpDeliveryProvider.js'
import { logger } from '../utils/logger.js'
import { env } from '../schemas/env.js'

/**
 * Email OTP Provider
 * 
 * Production-ready email provider for sending OTP codes using Resend.
 * 
 * IMPORTANT: Never log the plaintext OTP in production.
 */
export class EmailOtpProvider implements OtpDeliveryProvider {
  private resend: Resend

  constructor() {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured')
    }
    this.resend = new Resend(env.RESEND_API_KEY)
  }

  async sendOtp(email: string, otp: string, ttlMinutes: number): Promise<void> {
    const template = generateOtpEmailTemplate(otp, ttlMinutes)
    const fromEmail = env.RESEND_FROM_EMAIL
    
    if (!fromEmail) {
      throw new Error('RESEND_FROM_EMAIL is not configured')
    }

    let result: { error: any } | null = null
    try {
      logger.info('[OTP Delivery] Sending Email OTP', {
        email,
        subject: template.subject,
        ttlMinutes,
        // NOTE: OTP is intentionally NOT logged here for security
      })

      const sendResult = await this.resend.emails.send({
        from: fromEmail,
        to: email,
        subject: template.subject,
        html: template.html,
      })
      result = sendResult
    } catch (err) {
      logger.error('[OTP Delivery] Unexpected error sending email', { 
        email, 
        error: err instanceof Error ? err.message : String(err) 
      })
      throw new Error('An unexpected error occurred while sending the OTP email')
    }

    if (result?.error) {
      logger.error('[OTP Delivery] Resend provider error', { 
        email, 
        error: result.error.message 
      })
      throw new Error('Failed to send OTP email via provider')
    }
  }
}
