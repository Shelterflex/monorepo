export type TenantPaymentStatus = "paid" | "pending" | "upcoming";

export type TenantPaymentStatusPresentation = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  className: string;
  textClassName: string;
  iconContainerClassName: string;
};

const STATUS_PRESENTATION: Record<
  TenantPaymentStatus,
  TenantPaymentStatusPresentation
> = {
  paid: {
    label: "Paid",
    variant: "secondary",
    className: "border-2 border-foreground",
    textClassName: "text-secondary",
    iconContainerClassName: "bg-secondary",
  },
  upcoming: {
    label: "Upcoming",
    variant: "default",
    className: "border-2 border-foreground",
    textClassName: "text-primary",
    iconContainerClassName: "bg-primary",
  },
  pending: {
    label: "Pending",
    variant: "outline",
    className: "border-2 border-foreground bg-muted",
    textClassName: "text-muted-foreground",
    iconContainerClassName: "bg-muted",
  },
};

export function getTenantPaymentStatusPresentation(
  status: string,
): TenantPaymentStatusPresentation {
  const normalized = status.toLowerCase() as TenantPaymentStatus;
  return STATUS_PRESENTATION[normalized] ?? STATUS_PRESENTATION.pending;
}
