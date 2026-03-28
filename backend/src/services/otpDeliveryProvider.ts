/**
 * OTP Delivery Provider Interface
 * 
 * Abstraction for delivering OTP codes to users via different channels.
 * Ensures plaintext OTP is never stored or logged in production.
 */
export interface OtpDeliveryProvider {
  /**
   * Send an OTP code to the user
   * @param email - User's email address
   * @param otp - The OTP code (plaintext, must not be stored or logged in production)
   * @param ttlMinutes - Time to live in minutes
   * @returns Promise that resolves when OTP is sent
   */
  sendOtp(email: string, otp: string, ttlMinutes: number): Promise<void>
}

/**
 * OTP email template data
 */
export interface OtpEmailTemplate {
  subject: string
  body: string
  html: string
}

/**
 * Generate OTP email template with security hints
 */
export function generateOtpEmailTemplate(
  otp: string,
  ttlMinutes: number,
): OtpEmailTemplate {
  const subject = 'Your Verification Code'
  
  const body = `
Your verification code is: ${otp}

This code will expire in ${ttlMinutes} minutes.

Security tip: Never share this code with anyone. We will never ask for it via phone or email.

If you didn't request this code, please ignore this message.
`.trim()

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #333; text-align: center;">Verification Code</h2>
      <p style="font-size: 16px; color: #666;">Your verification code is:</p>
      <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #000; border-radius: 5px; margin: 20px 0;">
        ${otp}
      </div>
      <p style="font-size: 14px; color: #999;">This code will expire in <strong>${ttlMinutes} minutes</strong>.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="font-size: 12px; color: #999;"><strong>Security tip:</strong> Never share this code with anyone. We will never ask for it via phone or email.</p>
      <p style="font-size: 12px; color: #999;">If you didn't request this code, please ignore this message.</p>
    </div>
  `.trim()

  return { subject, body, html }
}
