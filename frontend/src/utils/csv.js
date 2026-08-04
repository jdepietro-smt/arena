// Client-side CSV export — no backend endpoint needed since every caller
// already has the full row set in hand from a query it already ran (audit
// log, recordings list). RFC 4180 quoting: only wrap a field in quotes when
// it actually needs it, so a plain CSV stays readable without quotes.
function escapeCsvField(value) {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers, rows) {
  const lines = [headers.map(escapeCsvField).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','))
  }
  // CRLF is the RFC 4180 line ending — keeps Excel from mangling the file.
  return lines.join('\r\n')
}

export function downloadCsv(filename, headers, rows) {
  const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
