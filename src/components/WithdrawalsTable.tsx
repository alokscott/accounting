'use client'

import { useState } from 'react'
import { formatCurrency, formatDate } from '@/lib/interest'
import type { WithdrawalWithClient } from '@/lib/supabase'
import Select from '@/components/Select'

interface WithdrawalsTableProps {
  withdrawals: WithdrawalWithClient[]
  /** Show the Company column (used by admins viewing all companies). */
  showCompany?: boolean
}

function StatusBadge({ status }: { status?: WithdrawalWithClient['status'] | null }) {
  // Default to 'pending' so rows from before migration 0005 (no status column)
  // don't crash the table.
  const s = status ?? 'pending'
  const cls =
    s === 'approved' ? 'badge badge-success'
    : s === 'rejected' ? 'badge badge-danger'
    : 'badge'
  const label = s.charAt(0).toUpperCase() + s.slice(1)
  return <span className={cls}>{label}</span>
}

function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash
}

function CopyableHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (e.g. non-HTTPS) — ignore silently.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied!' : `Copy ${hash}`}
      className="inline-flex items-center gap-1.5 font-mono text-sm text-muted hover:text-foreground transition-colors"
    >
      <span>{shortHash(hash)}</span>
      {copied ? (
        <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  )
}

export default function WithdrawalsTable({ withdrawals, showCompany = false }: WithdrawalsTableProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  if (withdrawals.length === 0) return null

  // Summary excludes rejected requests (their principal was released).
  const totals = withdrawals.reduce(
    (acc, w) => {
      if (w.status === 'rejected') return acc
      return {
        principal: acc.principal + Number(w.amount),
        interest: acc.interest + Number(w.interest_paid),
        payout: acc.payout + Number(w.total_payout),
      }
    },
    { principal: 0, interest: 0, payout: 0 }
  )
  const pendingCount = withdrawals.filter((w) => w.status === 'pending').length

  // Pagination (rows only — summary cards reflect the full set).
  const total = withdrawals.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const pageItems = withdrawals.slice(pageStart, pageStart + pageSize)

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Withdrawals</h2>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-muted mb-1">Total Principal Withdrawn</p>
          <p className="text-2xl font-bold font-mono">{formatCurrency(totals.principal)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted mb-1">Total Interest Paid</p>
          <p className="text-2xl font-bold font-mono text-accent">+{formatCurrency(totals.interest)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted mb-1">Total Payouts</p>
          <p className="text-2xl font-bold font-mono">{formatCurrency(totals.payout)}</p>
          {pendingCount > 0 && (
            <p className="text-xs text-muted mt-1">{pendingCount} pending</p>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr>
                {showCompany && <th>Company</th>}
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((w, index) => (
                <tr
                  key={w.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms`, opacity: 0 }}
                >
                  {showCompany && <td className="text-sm">{w.clients?.name ?? '—'}</td>}
                  <td className="font-mono text-sm">{formatDate(w.withdrawal_date + 'T00:00:00')}</td>
                  <td className="font-mono font-semibold">{formatCurrency(Number(w.total_payout))}</td>
                  <td><StatusBadge status={w.status} /></td>
                  <td className="font-mono text-sm text-muted">
                    {w.tx_hash ? (
                      <CopyableHash hash={w.tx_hash} />
                    ) : w.status === 'rejected' && w.rejected_reason ? (
                      <span className="text-danger" title={w.rejected_reason}>Rejected</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > pageSize && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border text-sm">
            <span className="text-muted">
              {pageStart + 1}–{Math.min(pageStart + pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-muted">
                <span>Rows</span>
                <Select
                  value={String(pageSize)}
                  onChange={(v) => { setPageSize(Number(v)); setPage(1) }}
                  options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))}
                  className="w-auto"
                  sizeClassName="py-1 px-3"
                />
              </div>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="btn btn-secondary py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="text-muted">Page {currentPage} / {pageCount}</span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={currentPage >= pageCount}
                className="btn btn-secondary py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
