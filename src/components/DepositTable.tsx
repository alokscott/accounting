'use client'

import { useState } from 'react'
import { createClient, type DepositWithClient, type DepositInterestAccrual } from '@/lib/supabase'
import { remainingPrincipal, recordWithdrawal, approveWithdrawal } from '@/lib/withdrawals'
import Modal from '@/components/admin/Modal'
import Select from '@/components/Select'
import {
  calculateCurrentValue,
  getCompleteWeeks,
  getFirstWeekStart,
  formatCurrency,
  formatDate,
  getDayOfWeek,
  parseDate,
  todayUTC,
} from '@/lib/interest'

interface DepositTableProps {
  deposits: DepositWithClient[]
  onRefresh: () => void
  /** Read-only viewers (non-admins) cannot close or delete positions. */
  readOnly?: boolean
  /** Show the Company column (used by admins viewing all companies). */
  showCompany?: boolean
  /** Principal already withdrawn per deposit id; figures reflect the remainder. */
  withdrawn?: Map<string, number>
}

export default function DepositTable({ deposits, onRefresh, readOnly = false, showCompany = false, withdrawn }: DepositTableProps) {
  // Principal still invested in a deposit (original minus anything withdrawn).
  const principalOf = (deposit: DepositWithClient) =>
    withdrawn ? remainingPrincipal(deposit, withdrawn) : Number(deposit.amount)

  // Remaining principal + its current value & accrued interest, always kept
  // consistent with each other. The stored current_value / interest_accrued
  // columns are a DB snapshot that may not yet reflect a pending withdrawal's
  // reservation, so once a deposit is partly withdrawn we recompute value and
  // interest live from the remaining principal instead of trusting the snapshot.
  const valueOf = (deposit: DepositWithClient) => {
    const principal = principalOf(deposit)
    const partlyWithdrawn = principal < Number(deposit.amount) - 0.005
    const depositDate = parseDate(deposit.deposit_date)
    const currentValue = !partlyWithdrawn && deposit.current_value != null
      ? Number(deposit.current_value)
      : calculateCurrentValue(principal, depositDate)
    const interest = !partlyWithdrawn && deposit.interest_accrued != null
      ? Number(deposit.interest_accrued)
      : Math.max(0, currentValue - principal)
    return { principal, currentValue, interest }
  }
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [withdrawTarget, setWithdrawTarget] = useState<DepositWithClient | null>(null)
  const [txHash, setTxHash] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  // Interest-history (weekly trail) modal.
  const [historyTarget, setHistoryTarget] = useState<DepositWithClient | null>(null)
  const [historyRows, setHistoryRows] = useState<DepositInterestAccrual[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const supabase = createClient()

  const openHistory = async (deposit: DepositWithClient) => {
    setHistoryTarget(deposit)
    setHistoryRows(null)
    setHistoryError(null)
    const { data, error } = await supabase
      .from('deposit_interest_accruals')
      .select('*')
      .eq('deposit_id', deposit.id)
      .order('week_number', { ascending: true })
    if (error) {
      setHistoryError(error.message)
      setHistoryRows([])
    } else {
      setHistoryRows(data ?? [])
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this deposit?')) return

    setDeletingId(id)
    try {
      const { error } = await supabase
        .from('deposits')
        .delete()
        .eq('id', id)

      if (error) throw error
      onRefresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete deposit')
    } finally {
      setDeletingId(null)
    }
  }

  // Withdrawing a position = a full withdrawal of its remaining principal.
  // The admin enters the transaction hash, so it's created AND approved at once.
  const round2 = (n: number) => Math.round(n * 100) / 100

  const submitWithdraw = async () => {
    const deposit = withdrawTarget
    if (!deposit) return
    const depositDate = parseDate(deposit.deposit_date)
    const value = valueOf(deposit)
    const principal = round2(value.principal)
    const interest = round2(value.interest)
    const weeks = getCompleteWeeks(depositDate)

    setSubmitting(true)
    setWithdrawError(null)
    try {
      const withdrawalId = await recordWithdrawal(deposit.client_id, todayUTC(), [{
        deposit_id: deposit.id,
        principal_withdrawn: principal,
        interest_withdrawn: interest,
        weeks_elapsed: weeks,
        depositDate: deposit.deposit_date,
        remainingBefore: principal,
      }])
      await approveWithdrawal(withdrawalId, txHash)
      setWithdrawTarget(null)
      onRefresh()
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'Failed to withdraw position')
    } finally {
      setSubmitting(false)
    }
  }

  // Payout figures for the position currently being withdrawn (for the modal).
  const wt = withdrawTarget
  const wtValue = wt ? valueOf(wt) : { principal: 0, currentValue: 0, interest: 0 }
  const wtPrincipal = round2(wtValue.principal)
  const wtInterest = round2(wtValue.interest)

  // Calculate totals. Current value is read from the DB column; only fall back
  // to a live compute for rows that haven't been refreshed yet.
  const totals = deposits.reduce(
    (acc, deposit) => {
      const { principal, currentValue, interest } = valueOf(deposit)
      return {
        principal: acc.principal + principal,
        currentValue: acc.currentValue + currentValue,
        interest: acc.interest + interest,
      }
    },
    { principal: 0, currentValue: 0, interest: 0 }
  )

  // Pagination (rows only — the summary cards above always reflect the full set).
  const total = deposits.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const pageItems = deposits.slice(pageStart, pageStart + pageSize)

  if (deposits.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-card-hover rounded-full mb-4">
          <svg className="w-8 h-8 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <h3 className="text-lg font-medium mb-2">No Deposits Yet</h3>
        <p className="text-muted text-sm">Add your first deposit to start tracking.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-muted mb-1">Total Principal</p>
          <p className="text-2xl font-bold font-mono">{formatCurrency(totals.principal)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted mb-1">Current Value</p>
          <p className="text-2xl font-bold font-mono text-accent">{formatCurrency(totals.currentValue)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted mb-1">Total Interest</p>
          <p className="text-2xl font-bold font-mono">
            <span className="text-accent">+{formatCurrency(totals.interest)}</span>
          </p>
        </div>
      </div>

      {/* Deposits Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr>
                {showCompany && <th>Company</th>}
                <th>Deposit Date</th>
                <th>Day</th>
                <th>Principal</th>
                <th>Week 1 Starts</th>
                <th>Weeks Earned</th>
                <th>Interest</th>
                <th>Current Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((deposit, index) => {
                const depositDate = parseDate(deposit.deposit_date)
                const { principal, currentValue, interest } = valueOf(deposit)
                const partlyWithdrawn = principal < Number(deposit.amount) - 0.005
                const weeks = getCompleteWeeks(depositDate)
                const firstWeekStart = getFirstWeekStart(depositDate)

                return (
                  <tr 
                    key={deposit.id}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms`, opacity: 0 }}
                  >
                    {showCompany && (
                      <td className="text-sm">{deposit.clients?.name ?? '—'}</td>
                    )}
                    <td className="font-mono text-sm">{formatDate(depositDate)}</td>
                    <td className="text-sm text-muted">{getDayOfWeek(depositDate)}</td>
                    <td className="font-mono">
                      {formatCurrency(principal)}
                      {partlyWithdrawn && (
                        <span className="block text-xs text-muted">of {formatCurrency(Number(deposit.amount))}</span>
                      )}
                    </td>
                    <td className="text-sm text-muted">{formatDate(firstWeekStart)}</td>
                    <td>
                      <span className={`badge ${weeks > 0 ? 'badge-success' : 'badge-danger'}`}>
                        {weeks} {weeks === 1 ? 'week' : 'weeks'}
                      </span>
                    </td>
                    <td className="font-mono text-accent">
                      +{formatCurrency(interest)}
                    </td>
                    <td className="font-mono font-semibold">{formatCurrency(currentValue)}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openHistory(deposit)}
                          className="p-2 text-muted hover:text-accent transition-colors rounded-lg hover:bg-accent-muted"
                          title="Interest history"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        {!readOnly && (
                        <>
                        <button
                          onClick={() => { setWithdrawTarget(deposit); setTxHash(''); setWithdrawError(null) }}
                          className="p-2 text-muted hover:text-accent transition-colors rounded-lg hover:bg-accent-muted"
                          title="Withdraw position"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(deposit.id)}
                          disabled={deletingId === deposit.id}
                          className="p-2 text-muted hover:text-danger transition-colors rounded-lg hover:bg-danger-muted disabled:opacity-50"
                          title="Delete deposit"
                        >
                          {deletingId === deposit.id ? (
                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                        </button>
                        </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
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

      {/* Withdraw position — admin records the tx hash, settling it at once */}
      <Modal open={wt !== null} onClose={() => { if (!submitting) setWithdrawTarget(null) }} title="Withdraw position">
        {wt && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="card py-3">
                <p className="text-xs text-muted mb-0.5">Principal</p>
                <p className="font-mono font-semibold">{formatCurrency(wtPrincipal)}</p>
              </div>
              <div className="card py-3">
                <p className="text-xs text-muted mb-0.5">Interest</p>
                <p className="font-mono font-semibold text-accent">+{formatCurrency(wtInterest)}</p>
              </div>
              <div className="card py-3">
                <p className="text-xs text-muted mb-0.5">Total payout</p>
                <p className="font-mono font-semibold">{formatCurrency(wtPrincipal + wtInterest)}</p>
              </div>
            </div>

            <div>
              <label htmlFor="position-tx" className="block text-sm font-medium text-muted mb-2">Transaction hash</label>
              <input
                id="position-tx"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                className="input font-mono"
                placeholder="0x…"
                autoFocus
              />
              <p className="mt-2 text-xs text-muted">Withdraws the full remaining principal of this position and settles it with this transaction.</p>
            </div>

            {withdrawError && (
              <div className="p-3 bg-danger-muted border border-danger/30 rounded-lg text-danger text-sm">{withdrawError}</div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={submitWithdraw}
                disabled={submitting || txHash.trim() === ''}
                className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Withdrawing…' : 'Withdraw & settle'}
              </button>
              <button onClick={() => setWithdrawTarget(null)} disabled={submitting} className="btn btn-secondary">Cancel</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Interest history — the weekly accrual trail for one deposit */}
      <Modal open={historyTarget !== null} onClose={() => setHistoryTarget(null)} title="Interest history" maxWidthClassName="max-w-2xl">
        {historyTarget && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {historyTarget.clients?.name ? `${historyTarget.clients.name} · ` : ''}
              Deposited {formatCurrency(Number(historyTarget.amount))} on {formatDate(historyTarget.deposit_date)}
            </p>

            {historyError && (
              <div className="p-3 bg-danger-muted border border-danger/30 rounded-lg text-danger text-sm">{historyError}</div>
            )}

            {historyRows === null ? (
              <p className="text-sm text-muted py-6 text-center">Loading…</p>
            ) : historyRows.length === 0 ? (
              <p className="text-sm text-muted py-6 text-center">
                No interest weeks recorded yet. The first 0.5% is credited the second Monday after the deposit.
              </p>
            ) : (
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="data-table w-full">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Awarded</th>
                        <th>Rate</th>
                        <th>Interest added</th>
                        <th>Balance after</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((r) => (
                        <tr key={r.id}>
                          <td className="text-sm">{r.week_number}</td>
                          <td className="font-mono text-sm">{formatDate(r.accrual_date)}</td>
                          <td className="text-sm text-muted">{(Number(r.interest_rate) * 100).toFixed(2)}%</td>
                          <td className="font-mono text-accent">+{formatCurrency(Number(r.interest_amount))}</td>
                          <td className="font-mono">{formatCurrency(Number(r.closing_value))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border text-sm">
                  <span className="text-muted">{historyRows.length} {historyRows.length === 1 ? 'week' : 'weeks'}</span>
                  <span className="font-mono text-accent">
                    +{formatCurrency(historyRows.reduce((s, r) => s + Number(r.interest_amount), 0))} total
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
