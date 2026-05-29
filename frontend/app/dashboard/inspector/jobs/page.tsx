import Link from "next/link";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InspectorShell } from "../InspectorShell";

const jobs = [
  {
    id: "lekki-inspection-1",
    address: "12 Admiralty Way, Lekki",
    type: "Apartment",
    scheduledDate: "May 31, 2026",
    serviceArea: "Lekki",
  },
  {
    id: "yaba-inspection-1",
    address: "8 Commercial Avenue, Yaba",
    type: "Studio",
    scheduledDate: "June 1, 2026",
    serviceArea: "Yaba",
  },
];

export default function InspectorJobsPage() {
  return (
    <InspectorShell>
      <div className="mb-6">
        <h1 className="text-3xl font-black">Job Board</h1>
        <p className="text-muted-foreground">Jobs shown here match your declared service areas.</p>
      </div>
      <div className="grid gap-4">
        {jobs.map((job) => (
          <Card key={job.id} className="border-3 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Badge className="border-2 border-foreground">{job.serviceArea}</Badge>
                  <Badge variant="outline" className="border-2 border-foreground">{job.type}</Badge>
                </div>
                <h2 className="text-xl font-black">{job.address}</h2>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" /> Scheduled {job.scheduledDate}
                </p>
              </div>
              <Link href={`/dashboard/inspector/jobs/${job.id}/report`}>
                <Button className="border-3 border-foreground font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]">
                  Accept Job
                </Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </InspectorShell>
  );
}
