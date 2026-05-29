import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InspectorShell } from "../InspectorShell";

const completed = [
  { id: "INS-1001", property: "12 Admiralty Way", status: "approved", payout: "NGN 15,000" },
  { id: "INS-1002", property: "8 Commercial Avenue", status: "submitted", payout: "Pending" },
];

export default function InspectorEarningsPage() {
  return (
    <InspectorShell>
      <h1 className="mb-6 text-3xl font-black">Earnings</h1>
      <div className="grid gap-4">
        {completed.map((inspection) => (
          <Card key={inspection.id} className="border-3 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-sm text-muted-foreground">{inspection.id}</p>
                <h2 className="text-xl font-black">{inspection.property}</h2>
              </div>
              <div className="text-right">
                <Badge className="mb-2 border-2 border-foreground">{inspection.status}</Badge>
                <p className="font-bold">{inspection.payout}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </InspectorShell>
  );
}
