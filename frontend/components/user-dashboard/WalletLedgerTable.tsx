import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WalletLedgerEntry } from "@/lib/mockData/userDashboard";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-NG", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatNgn(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
}

function typeLabel(type: WalletLedgerEntry["type"]) {
  switch (type) {
    case "top_up":
      return "Top up";
    case "topup_pending":
      return "Top up (pending)";
    case "topup_confirmed":
      return "Top up (confirmed)";
    case "top_up_reversed":
    case "topup_reversed":
      return "Top up (reversed)";
    case "withdrawal":
      return "Withdrawal";
    case "stake":
      return "Stake";
    case "stake_reserve":
      return "Stake (reserve)";
    case "stake_release":
      return "Stake (release)";
    case "unstake":
      return "Unstake";
    case "reward":
      return "Reward";
    case "conversion_debit":
      return "Conversion";
  }
}

function statusPresentation(status: WalletLedgerEntry["status"]) {
  switch (status) {
    case "confirmed":
      return { label: "Confirmed", variant: "secondary" as const };
    case "pending":
      return { label: "Pending", variant: "default" as const };
    case "approved":
      return { label: "Approved", variant: "secondary" as const };
    case "rejected":
      return { label: "Rejected", variant: "destructive" as const };
    case "failed":
      return { label: "Failed", variant: "destructive" as const };
    case "reversed":
      return { label: "Reversed", variant: "outline" as const };
  }
}

export function WalletLedgerTable({ entries }: { entries: WalletLedgerEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>When</TableHead>
          <TableHead>Reference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => {
          const status = statusPresentation(e.status);
          return (
            <TableRow key={e.id}>
              <TableCell className="font-bold text-foreground">
                {typeLabel(e.type)}
              </TableCell>
              <TableCell>
                <div className="font-mono font-bold">{formatNgn(e.amountNgn)}</div>
                {typeof e.amountUsdc === "string" && (
                  <div className="text-xs text-muted-foreground">
                    {e.amountUsdc} USDC
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={status.variant}>{status.label}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateTime(e.timestamp)}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {e.reference ?? "-"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
