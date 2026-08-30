"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { apiGet, apiPost } from "@/lib/apiClient"

type Withdrawal = { id: string; amountNgn: number; status: string; reference: string; createdAt: string; bankAccount: { accountNumber: string; accountName: string; bankName: string }; failureReason: string | null }
const confirmation = (action: string, amount: number) => `${action} ${amount}`

export default function AdminWithdrawalsPage() {
  const [items, setItems] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ item: Withdrawal; action: "approve" | "reject" } | null>(null)
  const [typed, setTyped] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiGet<{ entries: Withdrawal[] }>("/admin/withdrawals?limit=100")
      setItems(response.entries.filter((item) => item.status === "pending"))
      setError(null)
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load withdrawals") }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const submit = async () => {
    if (!selected || typed !== confirmation(selected.action.toUpperCase(), selected.item.amountNgn) || (selected.action === "reject" && !reason.trim())) return
    setSaving(true)
    try {
      await apiPost(`/admin/withdrawals/${selected.item.id}/${selected.action}`, selected.action === "reject" ? { reason: reason.trim() } : {})
      setSelected(null); setTyped(""); setReason(""); await load()
    } catch (err) { setError(err instanceof Error ? err.message : "Action failed") }
    finally { setSaving(false) }
  }

  return <main className="min-h-screen bg-background p-6"><div className="mx-auto max-w-5xl">
    <div className="mb-8 flex items-start justify-between"><div><h1 className="text-3xl font-black">Withdrawal Approval Queue</h1><p className="text-muted-foreground">Emergency control for pending funds movement.</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    {error && <Card className="mb-4 border-2 border-destructive bg-destructive/10 p-4 text-destructive"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</Card>}
    <Card className="overflow-hidden border-2 border-foreground"><div className="overflow-x-auto"><table className="w-full" aria-label="Pending withdrawals"><thead className="border-b-2 border-foreground bg-muted"><tr>{["Reference","Amount","Recipient","Created","Actions"].map((h) => <th key={h} className="px-4 py-3 text-left text-sm font-bold">{h}</th>)}</tr></thead><tbody>{!loading && items.map((item) => <tr key={item.id} className="border-b border-foreground"><td className="px-4 py-3 font-mono text-sm">{item.reference}</td><td className="px-4 py-3 font-bold">₦{item.amountNgn.toLocaleString("en-NG")}</td><td className="px-4 py-3 text-sm">{item.bankAccount.accountName}<br /><span className="text-muted-foreground">{item.bankAccount.bankName} · {item.bankAccount.accountNumber}</span></td><td className="px-4 py-3 text-sm">{new Date(item.createdAt).toLocaleString()}</td><td className="px-4 py-3"><div className="flex gap-2"><Button size="sm" className="bg-green-600" onClick={() => setSelected({ item, action: "approve" })}>Approve</Button><Button size="sm" variant="destructive" onClick={() => setSelected({ item, action: "reject" })}>Reject</Button></div></td></tr>)}</tbody></table></div>{loading && <p className="p-8 text-center">Loading withdrawals...</p>}{!loading && items.length === 0 && <p className="p-8 text-center text-muted-foreground">No pending withdrawals.</p>}</Card>
    {selected && <Card className="mt-6 border-2 border-destructive p-6"><h2 className="text-xl font-bold">Confirm {selected.action}</h2><p className="mt-2 text-sm">This action is logged and changes the movement of ₦{selected.item.amountNgn.toLocaleString("en-NG")}.</p><Label className="mt-4 block">Type <strong>{confirmation(selected.action.toUpperCase(), selected.item.amountNgn)}</strong> to continue</Label><Input className="mt-2 border-2 border-foreground" value={typed} onChange={(e) => setTyped(e.target.value)} />{selected.action === "reject" && <><Label className="mt-4 block">Reason</Label><Textarea className="mt-2 border-2 border-foreground" value={reason} onChange={(e) => setReason(e.target.value)} /></>}<div className="mt-4 flex gap-2"><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button disabled={saving || typed !== confirmation(selected.action.toUpperCase(), selected.item.amountNgn) || (selected.action === "reject" && !reason.trim())} onClick={() => void submit()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{selected.action === "approve" ? <CheckCircle2 className="mr-2 h-4 w-4" /> : null}Confirm {selected.action}</Button></div></Card>}
  </div></main>
}
