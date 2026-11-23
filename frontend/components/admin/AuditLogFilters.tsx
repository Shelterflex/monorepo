"use client";

import { useState, useCallback } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AuditLogQueryParams } from "@/lib/auditLogsApi";

const ACTION_TYPES = [
  "AUTH_OTP_REQUESTED",
  "AUTH_LOGIN_SUCCESS",
  "AUTH_LOGIN_FAILED",
  "AUTH_LOGOUT",
  "AUTH_LOGOUT_ALL",
  "AUTH_WALLET_LOGIN_SUCCESS",
  "AUTH_WALLET_LOGIN_FAILED",
  "WALLET_CREATED",
  "WALLET_SIGNING_USED",
  "WALLET_EXPORT_ATTEMPT",
  "ADMIN_WALLET_ACTION",
  "DEAL_CREATED",
  "DEAL_UPDATED",
  "DEAL_STATUS_CHANGED",
  "LISTING_CREATED",
  "LISTING_APPROVED",
  "LISTING_REJECTED",
  "NGN_DEPOSIT_INITIATED",
  "NGN_WITHDRAWAL_INITIATED",
  "PAYMENT_INITIATED",
  "STAKING_INITIATED",
  "REWARD_MARKED_PAID",
  "ADMIN_OUTBOX_MARK_DEAD",
  "ADMIN_OUTBOX_RETRY",
  "ADMIN_INDEXER_PAUSE",
  "ADMIN_INDEXER_RESUME",
  "ADMIN_SECRET_ROTATED",
  "RISK_ACCOUNT_FROZEN",
] as const;

const RESOURCE_TYPES = [
  "deal",
  "user",
  "property",
  "listing",
  "wallet",
  "reward",
  "payment",
  "stake",
] as const;

export interface ActiveFilters extends AuditLogQueryParams {}

interface AuditLogFiltersProps {
  readonly filters: ActiveFilters;
  readonly onFiltersChange: (filters: ActiveFilters) => void;
}

export function AuditLogFilters({ filters, onFiltersChange }: AuditLogFiltersProps) {
  const [actorId, setActorId] = useState(filters.actorId ?? "");

  const update = useCallback(
    (patch: Partial<ActiveFilters>) => {
      onFiltersChange({ ...filters, ...patch, page: 1 });
    },
    [filters, onFiltersChange],
  );

  const handleActorIdSubmit = useCallback(() => {
    update({ actorId: actorId.trim() || undefined });
  }, [actorId, update]);

  const clearAll = useCallback(() => {
    setActorId("");
    onFiltersChange({ page: 1, limit: filters.limit });
  }, [filters.limit, onFiltersChange]);

  const hasActiveFilters =
    Boolean(actorId.trim()) ||
    Boolean(filters.actorId) ||
    Boolean(filters.action) ||
    Boolean(filters.resourceType) ||
    Boolean(filters.resourceId) ||
    Boolean(filters.startDate) ||
    Boolean(filters.endDate);

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-4">
        {/* Actor ID text search */}
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <Label htmlFor="actor-id-input" className="text-xs font-medium">
            Actor ID
          </Label>
          <div className="flex gap-2">
            <Input
              id="actor-id-input"
              placeholder="Search by user / actor ID"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleActorIdSubmit()}
              className="h-9 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleActorIdSubmit}
              aria-label="Search by actor ID"
              className="h-9 px-3"
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Action type multiselect */}
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <Label className="text-xs font-medium">Action Type</Label>
          <Select
            value={filters.action ?? "all"}
            onValueChange={(v) => update({ action: v === "all" ? undefined : v })}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {ACTION_TYPES.map((a) => (
                <SelectItem key={a} value={a} className="font-mono text-xs">
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Resource type multiselect */}
        <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
          <Label className="text-xs font-medium">Resource Type</Label>
          <Select
            value={filters.resourceType ?? "all"}
            onValueChange={(v) => update({ resourceType: v === "all" ? undefined : v })}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="All resources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All resources</SelectItem>
              {RESOURCE_TYPES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Resource ID text search */}
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <Label htmlFor="resource-id-input" className="text-xs font-medium">
            Resource ID
          </Label>
          <Input
            id="resource-id-input"
            placeholder="Filter by resource ID"
            value={filters.resourceId ?? ""}
            onChange={(e) =>
              update({ resourceId: e.target.value.trim() || undefined })
            }
            className="h-9 text-sm"
          />
        </div>

        {/* Date range: start */}
        <div className="flex min-w-[160px] flex-col gap-1.5">
          <Label htmlFor="start-date-input" className="text-xs font-medium">
            From
          </Label>
          <Input
            id="start-date-input"
            type="datetime-local"
            value={filters.startDate ? filters.startDate.slice(0, 16) : ""}
            onChange={(e) =>
              update({
                startDate: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              })
            }
            className="h-9 text-sm"
          />
        </div>

        {/* Date range: end */}
        <div className="flex min-w-[160px] flex-col gap-1.5">
          <Label htmlFor="end-date-input" className="text-xs font-medium">
            To
          </Label>
          <Input
            id="end-date-input"
            type="datetime-local"
            value={filters.endDate ? filters.endDate.slice(0, 16) : ""}
            onChange={(e) =>
              update({
                endDate: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              })
            }
            className="h-9 text-sm"
          />
        </div>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
