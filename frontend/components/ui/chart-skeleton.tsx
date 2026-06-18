interface ChartSkeletonProps {
  height?: string;
  className?: string;
}

export function ChartSkeleton({
  height = "h-[360px]",
  className = "",
}: ChartSkeletonProps) {
  return (
    <div
      className={`border-3 border-foreground bg-card p-6 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] animate-pulse flex flex-col justify-between ${height} ${className}`}
    >
      <div className="h-6 w-48 bg-muted border-2 border-foreground/10 mb-4" />
      <div className="flex-1 w-full bg-muted border-2 border-foreground/10" />
    </div>
  );
}
