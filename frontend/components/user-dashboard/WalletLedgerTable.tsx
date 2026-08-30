import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDateTime } from "@/lib/i18n-utils";
import type { WalletLedgerEntry } from "@/lib/types/dashboard";

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

function isDebit(type: WalletLedgerEntry["type"]): boolean {
  return ["withdrawal", "stake", "stake_reserve", "conversion_debit"].includes(type);
}

export function WalletLedgerTable({
  entries,
}: {
  entries: WalletLedgerEntry[];
}) {
  if (entries.length === 0) {
    return (
      <div className="border-3 border-foreground border-dashed p-12 text-center bg-muted/30">
        <p className="font-mono text-lg font-bold text-muted-foreground">
          No transactions yet
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Your wallet transactions will appear here.
        </p>
      </div>
    );
  }

  return (
    <Table aria-label="Wallet transaction ledger">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Type</TableHead>
          <TableHead scope="col">Amount</TableHead>
          <TableHead scope="col">Status</TableHead>
          <TableHead scope="col">When</TableHead>
          <TableHead scope="col">Reference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => {
          const status = statusPresentation(e.status);
          const debit = isDebit(e.type);
          return (
            <TableRow key={e.id}>
              <TableCell className="font-bold text-foreground">
                {typeLabel(e.type)}
              </TableCell>
              <TableCell>
                <div
                  className={`font-mono font-bold ${debit ? "text-destructive" : "text-foreground"}`}
                >
                  {debit ? "-" : ""}
                  {formatCurrency(e.amountNgn, "NGN", "en")}
                </div>
                {typeof e.amountUsdc === "string" && (
                  <div className="text-xs text-muted-foreground">
                    {e.amountUsdc} USDC
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={status.variant}>
                  <span aria-hidden="true">{status.label}</span>
                  <span className="sr-only">Status: {status.label}</span>
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateTime(e.timestamp, "en", {
                  year: "numeric",
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
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
