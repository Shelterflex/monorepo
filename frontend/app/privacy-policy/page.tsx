"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background py-12 px-4 pt-32">
      <div className="mx-auto max-w-4xl">
        {/* Back Button */}
        <Link href="/">
          <button className="mb-8 flex items-center gap-2 border-3 border-foreground bg-card px-4 py-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
            <ArrowLeft className="h-5 w-5" />
            Back to Home
          </button>
        </Link>

        <div className="border-3 border-foreground bg-card p-6 md:p-8 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <h1 className="mb-2 font-mono text-3xl font-black md:text-4xl">Privacy Policy</h1>
          <p className="mb-8 text-sm text-muted-foreground">Last updated: February 5, 2026</p>

          <div className="space-y-8 text-sm md:text-base">
            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">1. Introduction</h2>
              <p className="text-muted-foreground">
                Shelterflex ("we", "our", "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website and use our services.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">2. Information We Collect</h2>
              <p className="text-muted-foreground mb-3">
                We collect information in the following ways:
              </p>
              <p className="text-muted-foreground mb-2">
                <strong>2.1 Information You Provide:</strong>
              </p>
              <ul className="text-muted-foreground space-y-2 ml-4 mb-3">
                <li>• Account registration information (name, email, phone, address)</li>
                <li>• Payment information (banking details, transaction history)</li>
                <li>• Application and lease information</li>
                <li>• Communication and correspondence with Shelterflex</li>
                <li>• Identity verification documents</li>
              </ul>
              <p className="text-muted-foreground mb-2">
                <strong>2.2 Automatically Collected Information:</strong>
              </p>
              <ul className="text-muted-foreground space-y-2 ml-4">
                <li>• Browser type, operating system, and IP address</li>
                <li>• Pages visited and time spent on the website</li>
                <li>• Referring URL and clickstream data</li>
                <li>• Cookies and similar tracking technologies</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">3. How We Use Your Information</h2>
              <p className="text-muted-foreground mb-2">
                We use the information we collect for:
              </p>
              <ul className="text-muted-foreground space-y-2 ml-4">
                <li>• Processing rental applications and payments</li>
                <li>• Verifying your identity and creditworthiness</li>
                <li>• Communicating with you about your account and services</li>
                <li>• Providing customer support and responding to inquiries</li>
                <li>• Sending promotional emails and updates (with your consent)</li>
                <li>• Improving our website, products, and services</li>
                <li>• Complying with legal obligations and preventing fraud</li>
                <li>• Analyzing usage patterns and trends</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">4. Information Sharing and Disclosure</h2>
              <p className="text-muted-foreground mb-3">
                We may share your information with:
              </p>
              <ul className="text-muted-foreground space-y-2 ml-4">
                <li>• <strong>Landlords and Agents:</strong> Your application information necessary to process your rental</li>
                <li>• <strong>Financial Institutions:</strong> For payment processing and verification</li>
                <li>• <strong>Credit Bureaus:</strong> For credit checks and reporting</li>
                <li>• <strong>Legal Authorities:</strong> When required by law or to protect our rights</li>
                <li>• <strong>Service Providers:</strong> Third parties who assist us in providing our services</li>
              </ul>
              <p className="text-muted-foreground mt-3">
                We do NOT sell your personal information to third parties for marketing purposes.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">5. Data Security</h2>
              <p className="text-muted-foreground">
                We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to protect your information, we cannot guarantee absolute security.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">6. Data Retention</h2>
              <p className="text-muted-foreground">
                We retain your personal information for as long as necessary to fulfill the purposes outlined in this Privacy Policy, or as required by law. Once you close your account, we will delete or anonymize your information unless we are legally required to retain it.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">7. Your Rights</h2>
              <p className="text-muted-foreground mb-2">
                Depending on your location, you may have the following rights:
              </p>
              <ul className="text-muted-foreground space-y-2 ml-4">
                <li>• <strong>Right to Access:</strong> Request access to your personal information</li>
                <li>• <strong>Right to Correction:</strong> Request correction of inaccurate data</li>
                <li>• <strong>Right to Deletion:</strong> Request deletion of your personal information</li>
                <li>• <strong>Right to Portability:</strong> Request a copy of your data in a portable format</li>
                <li>• <strong>Right to Opt-Out:</strong> Opt-out of marketing communications</li>
              </ul>
              <p className="text-muted-foreground mt-3">
                To exercise any of these rights, please contact us at privacy@shelterflex.com.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">8. Cookies and Tracking</h2>
              <p className="text-muted-foreground">
                We use cookies and similar tracking technologies to enhance your experience on our website. You can control cookie settings in your browser preferences. However, disabling cookies may affect some functionality of our website.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">9. Third-Party Links</h2>
              <p className="text-muted-foreground">
                Our website may contain links to third-party websites. We are not responsible for the privacy practices of these external sites. We encourage you to review their privacy policies before providing any personal information.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">10. Children's Privacy</h2>
              <p className="text-muted-foreground">
                Shelterflex is not intended for children under 18 years of age. We do not knowingly collect personal information from children. If we become aware that a child has provided us with personal information, we will take steps to delete such information.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">11. Changes to This Privacy Policy</h2>
              <p className="text-muted-foreground">
                We may update this Privacy Policy periodically to reflect changes in our practices or for other operational, legal, or regulatory reasons. We will notify you of any material changes by posting the updated policy on our website and updating the "Last updated" date.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">12. Contact Us</h2>
              <p className="text-muted-foreground mb-3">
                If you have questions about this Privacy Policy or our privacy practices, please contact us:
              </p>
              <div className="text-muted-foreground space-y-2">
                <p><strong>Email:</strong> privacy@shelterflex.com</p>
                <p><strong>Phone:</strong> +234 (0) XXX XXX XXXX</p>
                <p><strong>Address:</strong> Lagos, Nigeria</p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
