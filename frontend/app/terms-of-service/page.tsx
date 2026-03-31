"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function TermsOfServicePage() {
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
          <h1 className="mb-2 font-mono text-3xl font-black md:text-4xl">Terms of Service</h1>
          <p className="mb-8 text-sm text-muted-foreground">Last updated: February 5, 2026</p>

          <div className="space-y-8 text-sm md:text-base">
            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">1. Acceptance of Terms</h2>
              <p className="text-muted-foreground">
                By accessing and using Shelterflex, you agree to be bound by these Terms of Service. If you do not agree to abide by the above, please do not use this service.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">2. Use License</h2>
              <p className="text-muted-foreground mb-3">
                Permission is granted to temporarily download one copy of the materials (information or software) on Shelterflex for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:
              </p>
              <ul className="text-muted-foreground space-y-2 ml-4">
                <li>• Modifying or copying the materials</li>
                <li>• Using the materials for any commercial purpose, or for any public display</li>
                <li>• Attempting to decompile or reverse engineer any software contained on Shelterflex</li>
                <li>• Removing any copyright or other proprietary notations from the materials</li>
                <li>• Transferring the materials to another person or "mirroring" the materials on any other server</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">3. Tenant Payment Terms</h2>
              <p className="text-muted-foreground mb-3">
                <strong>3.1 Rent Financing:</strong> Shelterflex finances the rental amount to the landlord upfront. You agree to repay this amount in monthly installments as calculated in your application.
              </p>
              <p className="text-muted-foreground mb-3">
                <strong>3.2 Monthly Payments:</strong> Payments must be made on or before the due date. Late payments may incur additional fees and penalties as outlined in your agreement.
              </p>
              <p className="text-muted-foreground mb-3">
                <strong>3.3 Deposit (NON-REFUNDABLE):</strong> Your initial deposit is NON-REFUNDABLE. It serves as a security measure for Shelterflex to mitigate risk. The deposit must be renewed annually to demonstrate your commitment to retaining the property. Minimum deposit is 20% of the yearly rent.
              </p>
              <p className="text-muted-foreground">
                <strong>3.4 Additional Fees:</strong> You are responsible for paying inspection fees, agreement fees, commission, and any other charges directly to the agent or landlord. These are separate from your monthly payments to Shelterflex.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">4. Tenant Obligations</h2>
              <p className="text-muted-foreground mb-2">
                As a tenant, you agree to:
              </p>
              <ul className="text-muted-foreground space-y-2 ml-4">
                <li>• Make timely monthly payments without default</li>
                <li>• Maintain the property in good condition</li>
                <li>• Comply with all terms of the lease agreement with the landlord</li>
                <li>• Provide accurate information in your application</li>
                <li>• Notify Shelterflex of any changes in contact information</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">5. Default and Remedies</h2>
              <p className="text-muted-foreground mb-3">
                Failure to pay rent installments on time may result in:
              </p>
              <ul className="text-muted-foreground space-y-2 ml-4">
                <li>• Additional charges and penalties</li>
                <li>• Legal action to recover the debt</li>
                <li>• Negative credit reporting</li>
                <li>• Eviction proceedings in accordance with applicable law</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">6. Early Settlement</h2>
              <p className="text-muted-foreground">
                You may settle your remaining balance early without penalty. Contact Shelterflex for settlement options and amounts.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">7. Landlord and Property Terms</h2>
              <p className="text-muted-foreground mb-2">
                <strong>7.1 Lease Agreement:</strong> The lease agreement remains between you and the landlord. Shelterflex only finances the rent and is not party to the lease.
              </p>
              <p className="text-muted-foreground">
                <strong>7.2 Property Disputes:</strong> Any disputes regarding the property condition, maintenance, or other lease terms should be addressed with the landlord directly.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">8. Limitation of Liability</h2>
              <p className="text-muted-foreground">
                Shelterflex is provided on an "as is" basis. Shelterflex shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use Shelterflex or the materials, even if Shelterflex has been advised of the possibility of such damages.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">9. Modifications to Terms</h2>
              <p className="text-muted-foreground">
                Shelterflex may revise these terms of service for its website at any time without notice. By using this website, you are agreeing to be bound by the then current version of these terms of service.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">10. Governing Law</h2>
              <p className="text-muted-foreground">
                These terms and conditions are governed by and construed in accordance with the laws of Nigeria, and you irrevocably submit to the exclusive jurisdiction of the courts in Lagos.
              </p>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-xl font-bold">11. Contact Information</h2>
              <p className="text-muted-foreground">
                For questions about these Terms of Service, please contact us at support@shelterflex.com or visit our <Link href="/contact" className="font-bold border-b-2 border-foreground hover:text-primary">contact page</Link>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
