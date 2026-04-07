"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TouchButtonProps extends React.ComponentProps<typeof Button> {
  children: React.ReactNode
  className?: string
}

export function TouchButton({ 
  children, 
  className,
  ...props 
}: Readonly<TouchButtonProps>) {
  return (
    <Button
      className={cn(
        "min-h-11 min-w-11 active:scale-95 transition-transform",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  )
}
