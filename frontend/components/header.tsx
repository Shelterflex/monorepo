"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Home } from "lucide-react"
import BackendHealthCompact from "@/components/BackendHealthCompact"
import { MobileMenu } from "@/components/ui/mobile-menu"

const navLinks = [
  { href: "/properties", label: "Find a Home" },
  { href: "/calculator", label: "Calculator" },
  { href: "/landlords", label: "For Landlords" },
  { href: "/about", label: "About" },
]

export function Header() {
  const pathname = usePathname()

  const isAuthPage = pathname === "/login" || pathname === "/signup"
  const isDashboard = pathname.startsWith("/dashboard")

  if (isAuthPage || isDashboard) return null

  return (
    <header className="sticky top-0 z-50 bg-background border-b-4 border-foreground">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <Home className="h-5 w-5 sm:h-6 sm:w-6 text-foreground" />
            </div>
            <span className="font-mono text-lg sm:text-xl font-black tracking-tight">
              SHELTA<span className="text-primary">FLEX</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`font-medium transition-colors hover:text-primary text-sm sm:text-base ${
                  pathname === link.href ? "text-primary" : ""
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Desktop Actions */}
          <div className="hidden lg:flex items-center gap-3">
            <div className="hidden xl:block">
              <BackendHealthCompact />
            </div>
            <Link href="/login">
              <Button
                variant="outline"
                className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all bg-background text-foreground min-h-[44px] px-4 sm:px-6"
              >
                Log In
              </Button>
            </Link>
            <Link href="/signup">
              <Button className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all text-foreground min-h-[44px] px-4 sm:px-6">
                Get Started
              </Button>
            </Link>
          </div>

          {/* Mobile Menu */}
          <MobileMenu navLinks={navLinks} pathname={pathname} />
        </div>
      </div>
    </header>
  )
}
