import Link from "next/link";
import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";

export type UserPropertyCardData = {
  id: number;
  title: string;
  location: string;
  priceNgnPerYear: number;
};

function formatNgn(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
}

export function UserPropertyCard({ property }: { property: UserPropertyCardData }) {
  return (
    <Link href={`/properties/${property.id}`} className="block">
      <Card className="border-3 border-foreground bg-card p-5 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate font-mono text-base font-black text-foreground">
              {property.title}
            </div>
            <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">{property.location}</span>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-xs text-muted-foreground">Per year</div>
            <div className="font-mono text-sm font-black text-primary">
              {formatNgn(property.priceNgnPerYear)}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
