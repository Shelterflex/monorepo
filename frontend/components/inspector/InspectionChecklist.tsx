"use client";

import { useState } from "react";
import { Check, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
export interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  completed?: boolean;
  notes?: string;
}

export interface ChecklistCategory {
  id: string;
  category: string;
  items: ChecklistItem[];
}

export const inspectionChecklistTemplate: ChecklistCategory[] = [
  {
    id: "exterior",
    category: "Exterior",
    items: [
      { id: "ext-1", label: "Building exterior condition", required: true },
      { id: "ext-2", label: "Roof condition", required: true },
      { id: "ext-3", label: "Parking area", required: false },
      { id: "ext-4", label: "Security features (gates, fences)", required: true },
    ],
  },
  {
    id: "interior",
    category: "Interior",
    items: [
      { id: "int-1", label: "Living room condition", required: true },
      { id: "int-2", label: "Kitchen condition and appliances", required: true },
      { id: "int-3", label: "Bedroom condition", required: true },
      { id: "int-4", label: "Bathroom condition and fixtures", required: true },
      { id: "int-5", label: "Flooring condition", required: true },
      { id: "int-6", label: "Windows and doors", required: true },
      { id: "int-7", label: "Electrical outlets and switches", required: true },
      { id: "int-8", label: "Plumbing fixtures", required: true },
    ],
  },
  {
    id: "amenities",
    category: "Amenities",
    items: [
      { id: "amen-1", label: "Water supply and pressure", required: true },
      { id: "amen-2", label: "Electrical supply stability", required: true },
      { id: "amen-3", label: "Air conditioning (if applicable)", required: false },
      { id: "amen-4", label: "Security systems", required: false },
    ],
  },
  {
    id: "safety",
    category: "Safety & Compliance",
    items: [
      { id: "safe-1", label: "Fire safety equipment", required: true },
      { id: "safe-2", label: "Emergency exits", required: true },
      { id: "safe-3", label: "Ventilation", required: true },
      { id: "safe-4", label: "Pest control evidence", required: true },
    ],
  },
];

export interface InspectionChecklistProps {
  checklist?: ChecklistCategory[];
  onChange?: (checklist: ChecklistCategory[]) => void;
}

export function InspectionChecklist({ checklist: controlledChecklist, onChange }: InspectionChecklistProps = {}) {
  const [internalChecklist, setInternalChecklist] = useState<ChecklistCategory[]>(
    inspectionChecklistTemplate.map((cat) => ({
      ...cat,
      items: cat.items.map((item) => ({
        ...item,
        completed: false,
        notes: "",
      })),
    })),
  );

  const checklist = controlledChecklist || internalChecklist;
  const setChecklist = (updater: ChecklistCategory[] | ((prev: ChecklistCategory[]) => ChecklistCategory[])) => {
    const next = typeof updater === "function" ? updater(checklist) : updater;
    setInternalChecklist(next);
    onChange?.(next);
  };

  const toggleItem = (categoryId: string, itemId: string) => {
    setChecklist(
      checklist.map((cat) => {
        if (cat.id !== categoryId) return cat;
        return {
          ...cat,
          items: cat.items.map((item) => {
            if (item.id !== itemId) return item;
            return { ...item, completed: !item.completed };
          }),
        };
      }),
    );
  };

  const updateNotes = (categoryId: string, itemId: string, notes: string) => {
    setChecklist(
      checklist.map((cat) => {
        if (cat.id !== categoryId) return cat;
        return {
          ...cat,
          items: cat.items.map((item) => {
            if (item.id !== itemId) return item;
            return { ...item, notes };
          }),
        };
      }),
    );
  };

  const getProgress = () => {
    const totalItems = checklist.reduce((sum, cat) => sum + cat.items.length, 0);
    const completedItems = checklist.reduce(
      (sum, cat) => sum + cat.items.filter((i) => i.completed).length,
      0,
    );
    return totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
  };

  const getRequiredItemsCompleted = () => {
    const totalRequired = checklist.reduce(
      (sum, cat) => sum + cat.items.filter((i) => i.required).length,
      0,
    );
    const completedRequired = checklist.reduce(
      (sum, cat) =>
        sum + cat.items.filter((i) => i.required && i.completed).length,
      0,
    );
    return { total: totalRequired, completed: completedRequired };
  };

  const canSubmit = () => {
    const { total, completed } = getRequiredItemsCompleted();
    return total === completed && total > 0;
  };

  const progress = getProgress();
  const { total: totalRequired, completed: completedRequired } =
    getRequiredItemsCompleted();

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground">
              Inspection Progress
            </h3>
            <p className="text-sm text-muted-foreground">
              {completedRequired} of {totalRequired} required items completed
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-32 border-2 border-foreground bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-sm font-bold text-foreground">
              {Math.round(progress)}%
            </span>
          </div>
        </div>
        {!canSubmit() && (
          <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>
              Complete all required items to submit the inspection report
            </span>
          </div>
        )}
      </Card>

      {/* Checklist Categories */}
      {checklist.map((category) => (
        <Card
          key={category.id}
          className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
        >
          <h4 className="mb-4 text-lg font-bold text-foreground">
            {category.category}
          </h4>
          <div className="space-y-4">
            {category.items.map((item) => (
              <div key={item.id} className="space-y-2">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={item.id}
                    checked={item.completed}
                    onCheckedChange={() => toggleItem(category.id, item.id)}
                    className="mt-1 border-2 border-foreground"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={item.id}
                      className="flex cursor-pointer items-center gap-2 font-medium text-foreground"
                    >
                      {item.label}
                      {item.required && (
                        <span className="text-destructive">*</span>
                      )}
                      {item.completed && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </Label>
                    <Textarea
                      placeholder="Add notes (optional)"
                      value={item.notes}
                      onChange={(e) =>
                        updateNotes(category.id, item.id, e.target.value)
                      }
                      className="mt-2 border-2 border-foreground"
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
