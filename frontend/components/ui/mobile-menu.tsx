"use client"

import * as React from "react"
import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { X, Menu } from "lucide-react"

interface MobileMenuProps {
  navLinks: Array<{ href: string; label: string }>
  pathname: string
}

export function MobileMenu({ navLinks, pathname }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        type="button"
        className="md:hidden p-3 border-3 border-foreground shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] bg-background min-h-[44px] min-w-[44px]"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls="mobile-menu"
        aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile Menu Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setIsOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" />
          
          {/* Menu Panel */}
          <div className="absolute right-0 top-0 h-full w-80 max-w-[85vw] bg-card border-l-3 border-foreground shadow-xl">
            <div className="flex h-16 items-center justify-between border-b-3 border-foreground px-4">
              <span className="font-mono text-lg font-bold">Menu</span>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 border-2 border-foreground min-h-[44px] min-w-[44px]"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <nav className="h-full overflow-y-auto py-4">
              <div className="space-y-2 px-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "block py-3 px-4 text-lg font-medium transition-colors hover:text-primary min-h-[44px] flex items-center border-2 border-transparent",
                      pathname === link.href 
                        ? "text-primary border-primary bg-primary/10" 
                        : "text-foreground hover:border-foreground/20"
                    )}
                    onClick={() => setIsOpen(false)}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              
              {/* Mobile Actions */}
              <div className="mt-8 space-y-3 px-4 border-t-3 border-foreground pt-4">
                <Link href="/login" onClick={() => setIsOpen(false)}>
                  <Button
                    variant="outline"
                    className="w-full border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all bg-background text-foreground min-h-[48px]"
                  >
                    Log In
                  </Button>
                </Link>
                <Link href="/signup" onClick={() => setIsOpen(false)}>
                  <Button className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all text-foreground min-h-[48px]">
                    Get Started
                  </Button>
                </Link>
              </div>
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
