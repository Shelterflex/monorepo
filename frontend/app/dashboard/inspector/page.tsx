import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InspectorShell } from "./InspectorShell";

const stats = [
  ["Completed", "18"],
  ["Pending submissions", "3"],
  ["Current earnings", "NGN 270,000"],
];

export default function InspectorDashboardPage() {
  return (
    <InspectorShell>
      <div className="mb-6">
        <Badge className="mb-3 border-2 border-foreground">Verified inspector</Badge>
        <h1 className="text-3xl font-black text-foreground">Inspection dashboard</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map(([label, value]) => (
          <Card key={label} className="border-3 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-bold text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-black">{value}</p>
          </Card>
        ))}
      </div>
    </InspectorShell>
  );
}
