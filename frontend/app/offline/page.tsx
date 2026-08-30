"use client"

import Image from "next/image"
import { Button } from "@/components/ui/button"

export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#fffef9] px-4">
      <div className="max-w-sm w-full border-3 border-[#111827] bg-white p-8 shadow-[8px_8px_0_#111827] text-center">
        <div className="flex justify-center mb-6">
          <Image
            src="/icon.svg"
            alt="Shelterflex"
            width={80}
            height={80}
            priority
          />
        </div>
        <h1 className="text-2xl font-bold text-[#1a1a1a] mb-3">You&apos;re offline</h1>
        <p className="text-[#4b5563] mb-6 leading-relaxed">
          It looks like you&apos;ve lost your internet connection. Check your network and try again.
        </p>
        <Button
          onClick={() => window.location.reload()}
          className="w-full bg-[#ff6b35] hover:bg-[#e05a28] text-white font-semibold border-2 border-[#111827] shadow-[4px_4px_0_#111827] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
        >
          Try Again
        </Button>
      </div>
    </main>
  )
}
