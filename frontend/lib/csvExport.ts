import type { WalletLedgerEntry } from './walletApi'

/**
 * Escapes a CSV field value
 */
function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return ''
  }

  const stringValue = String(value)
  
  // If the value contains comma, newline, or double quote, wrap it in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  
  return stringValue
}

/**
 * Formats a date string for CSV export
 */
function formatDateForCsv(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

/**
 * Formats amount for CSV export
 */
function formatAmountForCsv(amountNgn: number): string {
  return amountNgn.toFixed(2)
}

/**
 * Generates CSV content from ledger entries
 */
export function generateLedgerCsv(entries: WalletLedgerEntry[]): string {
  // CSV header
  const headers = ['Date', 'Type', 'Amount (NGN)', 'Status', 'Reference ID']
  const headerRow = headers.map(escapeCsvField).join(',')

  // CSV rows
  const rows = entries.map((entry) => {
    const date = formatDateForCsv(entry.timestamp)
    const type = escapeCsvField(entry.type)
    const amount = formatAmountForCsv(entry.amountNgn)
    const status = escapeCsvField(entry.status)
    const referenceId = escapeCsvField(entry.reference || entry.id)

    return [date, type, amount, status, referenceId].join(',')
  })

  // Combine header and rows
  return [headerRow, ...rows].join('\n')
}

/**
 * Triggers download of CSV file
 */
export function downloadCsv(content: string, filename: string): void {
  // Create blob with CSV content
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  
  // Create download link
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  
  // Trigger download
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  
  // Clean up URL
  URL.revokeObjectURL(url)
}
