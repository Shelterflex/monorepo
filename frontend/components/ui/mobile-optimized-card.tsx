"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useMobileOptimized } from "@/hooks/use-mobile-optimized"

interface MobileOptimizedCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  title?: string
  className?: string
}

export function MobileOptimizedCard({ 
  children, 
  title,
  className,
  ...props 
}: Readonly<MobileOptimizedCardProps>) {
  const { isMobile } = useMobileOptimized()

  return (
    <Card 
      className={cn(
        "border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]",
        isMobile && "w-full max-w-full",
        className
      )}
      {...props}
    >
      {title && (
        <CardHeader className={cn("pb-2", isMobile && "px-4")}>
          <CardTitle className={cn("text-lg sm:text-xl", isMobile && "text-base")}>
            {title}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className={cn(isMobile && "px-4 py-3", "p-6")}>
        {children}
      </CardContent>
    </Card>
  )
}
