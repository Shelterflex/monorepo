"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Mail, Phone, MapPin } from "lucide-react"

const footerLinks = {
  product: [
    { label: "Find a Home", href: "/properties" },
    { label: "Calculator", href: "/calculator" },
    { label: "For Landlords", href: "/landlords" },
  ],
  company: [
    { label: "About Us", href: "/about" },
    { label: "Careers", href: "/careers" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ],
  legal: [
    { label: "Terms of Service", href: "/terms" },
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Cookie Policy", href: "/cookies" },
  ],
}

export function Footer() {
  const pathname = usePathname()
  const isAuthPage = pathname === "/login" || pathname === "/signup"
  const isDashboard = pathname.startsWith("/dashboard")

  if (isAuthPage || isDashboard) return null

  return (
    <footer className="bg-foreground text-background py-16">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-12">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-6">
              <div className="flex h-10 w-10 items-center justify-center border-3 border-background bg-primary shadow-[4px_4px_0px_0px_rgba(255,254,249,0.3)]">
                <Home className="h-5 w-5 text-foreground" />
              </div>
              <span className="font-mono text-xl font-black tracking-tight">
                SHELTERFLEX
              </span>
            </Link>
            <p className="text-background/70 mb-6 max-w-sm leading-relaxed">
              The smarter way to pay your rent. Split your annual rent into
              affordable monthly payments and move into your dream home today.
            </p>
            <div className="space-y-3">
              <a
                href="mailto:hello@shelterflex.com"
                className="flex items-center gap-3 text-background/70 hover:text-primary transition-colors"
              >
                <Mail className="h-5 w-5" />
                <span>hello@shelterflex.com</span>
              </a>
              <a
                href="tel:+2341234567890"
                className="flex items-center gap-3 text-background/70 hover:text-primary transition-colors"
              >
                <Phone className="h-5 w-5" />
                <span>+234 123 456 7890</span>
              </a>
              <div className="flex items-center gap-3 text-background/70">
                <MapPin className="h-5 w-5" />
                <span>Lagos | Abuja | Port Harcourt</span>
              </div>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="font-mono font-bold text-lg mb-6 text-primary">
              Product
            </h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-background/70 hover:text-background transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h3 className="font-mono font-bold text-lg mb-6 text-primary">
              Company
            </h3>
            <ul className="space-y-3">
              {footerLinks.company.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-background/70 hover:text-background transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="font-mono font-bold text-lg mb-6 text-primary">
              Legal
            </h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-background/70 hover:text-background transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-16 pt-8 border-t border-background/20">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-background/60 text-sm">
              © 2026 Shelterflex. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <span className="text-background/60 text-sm">Follow us</span>
              <div className="flex gap-2">
                {["X", "IG", "LI"].map((platform, i) => (
                  <div
                    key={platform}
                    className="h-8 w-8 border-2 border-background/40 flex items-center justify-center font-mono font-bold text-xs cursor-pointer hover:bg-primary hover:border-primary transition-colors"
                  >
                    <span className="text-background">{platform}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
