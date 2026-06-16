'use client'

import { useMemo, useState } from 'react'
import { useAdminData } from '@/components/admin/AdminData'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'
import WithdrawalsTable from '@/components/WithdrawalsTable'
import WithdrawalForm from '@/components/WithdrawalForm'
import { approveWithdrawal, rejectWithdrawal, withdrawnByDeposit } from '@/lib/withdrawals'
import { activeDeposits } from '@/lib/adminStats'
import { exportWithdrawalsToPdf } from '@/lib/exportPdf'
import { formatCurrency, formatDate } from '@/lib/interest'
import type { WithdrawalWithClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}

export default function WithdrawalRequestsPage() {
  const { clients, deposits, closures, withdrawals, withdrawalAllocations, loading, refresh } = useAdminData()

  const [action, setAction] = useState<{ type: 'approve' | 'reject'; w: WithdrawalWithClient } | null>(null)
  const [txHash, setTxHash] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showExport, setShowExport] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const withdrawn = useMemo(() => withdrawnByDeposit(withdrawalAllocations, withdrawals), [withdrawalAllocations, withdrawals])
  const openDeposits = useMemo(() => activeDeposits(deposits, closures, withdrawn), [deposits, closures, withdrawn])

  const { pending, processed } = useMemo(() => {
    const pending = withdrawals.filter((w) => w.status === 'pending')
    const processed = withdrawals.filter((w) => w.status !== 'pending')
    return { pending, processed }
  }, [withdrawals])

  // Optional From/To range (on withdrawal date) for the export only.
  const inRange = (date: string) =>
    (!fromDate || date >= fromDate) && (!toDate || date <= toDate)
  const exportRows = withdrawals.filter((w) => inRange(w.withdrawal_date))

  const handleExport = async () => {
    let rangeLabel: string | undefined
    if (fromDate && toDate) rangeLabel = `${fromDate} to ${toDate}`
    else if (fromDate) rangeLabel = `From ${fromDate}`
    else if (toDate) rangeLabel = `Up to ${toDate}`

    await exportWithdrawalsToPdf(exportRows, rangeLabel, true)
    setShowExport(false)
  }

  const openApprove = (w: WithdrawalWithClient) => { setAction({ type: 'approve', w }); setTxHash(''); setError(null) }
  const openReject = (w: WithdrawalWithClient) => { setAction({ type: 'reject', w }); setReason(''); setError(null) }
  const close = () => { if (!submitting) setAction(null) }

  const submit = async () => {
    if (!action) return
    setSubmitting(true)
    setError(null)
    try {
      if (action.type === 'approve') {
        await approveWithdrawal(action.w.id, txHash)
      } else {
        await rejectWithdrawal(action.w.id, reason)
      }
      await refresh()
      setAction(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Withdrawals"
        subtitle={pending.length > 0 ? `${pending.length} pending request${pending.length === 1 ? '' : 's'}` : 'Withdrawal requests'}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExport(true)}
            disabled={withdrawals.length === 0}
            className="btn btn-secondary text-sm py-2 px-4 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export PDF
          </button>
          <button
            onClick={() => setShowWithdraw(true)}
            disabled={openDeposits.length === 0}
            className="btn btn-primary text-sm py-2 px-4 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Request Withdrawal
          </button>
        </div>
      </PageHeader>

      <Modal open={showWithdraw} onClose={() => setShowWithdraw(false)} title="Request Withdrawal">
        <WithdrawalForm
          clients={clients}
          deposits={openDeposits}
          withdrawn={withdrawn}
          onSuccess={() => { refresh(); setShowWithdraw(false) }}
        />
      </Modal>

      <Modal open={showExport} onClose={() => setShowExport(false)} title="Export PDF">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Optionally limit the export to a withdrawal-date range. Leave blank to include everything.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="wFrom" className="block text-sm font-medium text-muted mb-2">From</label>
              <input id="wFrom" type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} className="input" />
            </div>
            <div>
              <label htmlFor="wTo" className="block text-sm font-medium text-muted mb-2">To</label>
              <input id="wTo" type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} className="input" />
            </div>
          </div>
          <p className="text-xs text-muted">
            {exportRows.length} withdrawal{exportRows.length === 1 ? '' : 's'} in range
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exportRows.length === 0}
              className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Export
            </button>
            {(fromDate || toDate) && (
              <button onClick={() => { setFromDate(''); setToDate('') }} className="btn btn-secondary">
                Clear
              </button>
            )}
          </div>
        </div>
      </Modal>

      {loading ? (
        <div className="card flex items-center justify-center py-16">
          <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Pending requests */}
          <h2 className="text-lg font-semibold mb-3">Pending Requests</h2>
          <div className="card p-0 overflow-hidden mb-10">
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Requested</th>
                    <th>Amount</th>
                    <th>Wallet</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((w) => (
                    <tr key={w.id}>
                      <td className="text-sm">{w.clients?.name ?? '—'}</td>
                      <td className="font-mono text-sm">{formatDate(w.withdrawal_date + 'T00:00:00')}</td>
                      <td className="font-mono font-semibold">{formatCurrency(Number(w.total_payout))}</td>
                      <td className="font-mono text-sm text-muted" title={w.wallet_address ?? ''}>
                        {w.wallet_address ? shortHash(w.wallet_address) : '—'}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openApprove(w)} className="btn btn-primary text-sm py-1.5 px-3">Approve</button>
                          <button onClick={() => openReject(w)} className="btn btn-secondary text-sm py-1.5 px-3">Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pending.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-muted py-8">No pending requests.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Processed history */}
          {processed.length > 0 && <WithdrawalsTable withdrawals={processed} showCompany />}
        </>
      )}

      {/* Approve / Reject modal */}
      <Modal
        open={action !== null}
        onClose={close}
        title={action?.type === 'approve' ? 'Approve withdrawal' : 'Reject withdrawal'}
      >
        {action && (
          <div className="space-y-4">
            <div className="text-sm text-muted">
              <span className="text-foreground font-medium">{action.w.clients?.name ?? 'Company'}</span>
              {' · '}{formatCurrency(Number(action.w.total_payout))}
            </div>

            {action.type === 'approve' ? (
              <>
                <div className="text-sm">
                  <span className="text-muted">Sends to: </span>
                  <span className="font-mono break-all">{action.w.wallet_address ?? '—'}</span>
                </div>
                <div>
                  <label htmlFor="txhash" className="block text-sm font-medium text-muted mb-2">Transaction hash</label>
                  <input
                    id="txhash"
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    className="input font-mono"
                    placeholder="0x…"
                    autoFocus
                  />
                </div>
              </>
            ) : (
              <div>
                <label htmlFor="reason" className="block text-sm font-medium text-muted mb-2">Reason (optional)</label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="input"
                  rows={3}
                  placeholder="Why is this request being rejected?"
                />
                <p className="mt-2 text-xs text-muted">Rejecting releases the reserved principal back to the company.</p>
              </div>
            )}

            {error && (
              <div className="p-3 bg-danger-muted border border-danger/30 rounded-lg text-danger text-sm">{error}</div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={submit}
                disabled={submitting || (action.type === 'approve' && txHash.trim() === '')}
                className={`btn flex-1 disabled:opacity-50 disabled:cursor-not-allowed ${action.type === 'approve' ? 'btn-primary' : 'btn-secondary'}`}
              >
                {submitting ? 'Working…' : action.type === 'approve' ? 'Approve & record' : 'Reject request'}
              </button>
              <button onClick={close} disabled={submitting} className="btn btn-secondary">Cancel</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
