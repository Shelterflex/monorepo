"use client"

import Link from "next/link"
import { Home, Building2, Calculator, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState } from "react"

export function DashboardHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b-3 border-foreground bg-card">
      <div className="flex h-16 items-center justify-between px-4 lg:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center border-3 border-foreground bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
            <Building2 className="h-6 w-6" />
          </div>
          <span className="font-mono text-xl font-black">SHELTERFLEX</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-4">
          <Link href="/">
            <Button
              variant="outline"
              className="border-2 border-foreground bg-transparent font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]"
            >
              <Home className="mr-2 h-4 w-4" />
              Home
            </Button>
          </Link>
          <Link href="/properties">
            <Button
              variant="outline"
              className="border-2 border-foreground bg-transparent font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]"
            >
              <Building2 className="mr-2 h-4 w-4" />
              Properties
            </Button>
          </Link>
          <Link href="/calculator">
            <Button
              variant="outline"
              className="border-2 border-foreground bg-transparent font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]"
            >
              <Calculator className="mr-2 h-4 w-4" />
              Calculator
            </Button>
          </Link>
        </nav>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden border-2 border-foreground p-2"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t-2 border-foreground bg-card p-4 space-y-2">
          <Link href="/" className="block">
            <Button variant="outline" className="w-full border-2 border-foreground justify-start bg-transparent">
              <Home className="mr-2 h-4 w-4" />
              Home
            </Button>
          </Link>
          <Link href="/properties" className="block">
            <Button variant="outline" className="w-full border-2 border-foreground justify-start bg-transparent">
              <Building2 className="mr-2 h-4 w-4" />
              Properties
            </Button>
          </Link>
          <Link href="/calculator" className="block">
            <Button variant="outline" className="w-full border-2 border-foreground justify-start bg-transparent">
              <Calculator className="mr-2 h-4 w-4" />
              Calculator
            </Button>
          </Link>
        </div>
      )}
    </header>
  )
}
