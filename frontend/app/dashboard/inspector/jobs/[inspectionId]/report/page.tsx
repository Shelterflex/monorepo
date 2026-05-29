"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { apiFetch } from "@/lib/api";
import { InspectorShell } from "../../../InspectorShell";

const checklist = {
  structural: ["Walls and ceiling", "Doors and windows"],
  plumbing: ["Water pressure", "Visible leaks"],
  electrical: ["Sockets", "Breaker panel"],
  safety: ["Smoke detector", "Exit access"],
  exterior: ["Drainage", "Perimeter condition"],
};

export default function InspectionReportPage() {
  const params = useParams<{ inspectionId: string }>();
  const [results, setResults] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [photoUrls, setPhotoUrls] = useState("");
  const [inspectorNotes, setInspectorNotes] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "submitted" | "error">("idle");

  const isComplete = useMemo(
    () => Object.values(checklist).flat().every((item) => results[item]),
    [results],
  );
  const photoList = useMemo(
    () => photoUrls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean)
      .slice(0, 10),
    [photoUrls],
  );
  const canSubmit = isComplete && photoList.length > 0 && photoList.length <= 10 && submitState !== "submitting";

  async function submitReport() {
    setSubmitState("submitting");
    try {
      await apiFetch(`/api/inspector/jobs/${params.inspectionId}/report`, {
        method: "POST",
        body: JSON.stringify({
          inspectorNotes,
          checklistItems: Object.entries(checklist).flatMap(([category, items]) =>
            items.map((item) => ({
              category,
              item,
              result: results[item],
              notes: notes[item] || undefined,
            })),
          ),
          photos: photoList.map((url) => ({ url })),
        }),
      });
      setSubmitState("submitted");
    } catch {
      setSubmitState("error");
    }
  }

  return (
    <InspectorShell>
      <h1 className="mb-2 text-3xl font-black">Submit Inspection Report</h1>
      <p className="mb-6 text-muted-foreground">Inspection {params.inspectionId}</p>
      <Card className="border-3 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <Accordion type="multiple" defaultValue={Object.keys(checklist)}>
          {Object.entries(checklist).map(([category, items]) => (
            <AccordionItem key={category} value={category}>
              <AccordionTrigger className="font-black capitalize">{category}</AccordionTrigger>
              <AccordionContent className="space-y-4">
                {items.map((item) => (
                  <div key={item} className="border-2 border-foreground p-4">
                    <Label className="font-bold">{item}</Label>
                    <RadioGroup
                      className="mt-3 flex gap-4"
                      value={results[item]}
                      onValueChange={(value) => setResults((current) => ({ ...current, [item]: value }))}
                    >
                      {["pass", "fail", "na"].map((value) => (
                        <label key={value} className="flex items-center gap-2 font-bold uppercase">
                          <RadioGroupItem value={value} />
                          {value}
                        </label>
                      ))}
                    </RadioGroup>
                    <Textarea
                      className="mt-3"
                      placeholder="Optional notes"
                      value={notes[item] ?? ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [item]: event.target.value }))}
                    />
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <div className="mt-5 space-y-2">
          <Label className="font-bold">Photo URLs</Label>
          <Textarea
            value={photoUrls}
            onChange={(event) => setPhotoUrls(event.target.value)}
            placeholder="One uploaded photo URL per line, maximum 10"
          />
        </div>
        <div className="mt-5 space-y-2">
          <Label className="font-bold">Inspector notes</Label>
          <Textarea value={inspectorNotes} onChange={(event) => setInspectorNotes(event.target.value)} />
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              className="mt-5 border-3 border-foreground font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
              disabled={!canSubmit}
            >
              Submit Report
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Submit inspection report?</AlertDialogTitle>
              <AlertDialogDescription>
                The report will be sent for admin review and cannot be edited from this screen after submission.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={submitReport}>Submit</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {photoUrls.trim().length > 0 && photoUrls.split("\n").filter((url) => url.trim()).length > 10 ? (
          <p className="mt-3 text-sm font-bold text-destructive">Maximum 10 photo URLs per inspection.</p>
        ) : null}
        {submitState === "submitted" ? (
          <p className="mt-3 text-sm font-bold text-green-700">Report submitted for review.</p>
        ) : null}
        {submitState === "error" ? (
          <p className="mt-3 text-sm font-bold text-destructive">Report submission failed. Please try again.</p>
        ) : null}
      </Card>
    </InspectorShell>
  );
}
