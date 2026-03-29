"use client"

import * as React from "react"
import { Button, ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TouchButtonProps extends ButtonProps {
  children: React.ReactNode
  className?: string
}

export function TouchButton({ 
  children, 
  className,
  ...props 
}: TouchButtonProps) {
  return (
    <Button
      className={cn(
        "min-h-[44px] min-w-[44px] active:scale-95 transition-transform",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  )
}
