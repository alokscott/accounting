'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useAdminData } from '@/components/admin/AdminData'
import PageHeader from '@/components/admin/PageHeader'
import { activeDeposits, liveTotals } from '@/lib/adminStats'
import { withdrawnByDeposit } from '@/lib/withdrawals'
import { formatCurrency, formatDate } from '@/lib/interest'
import { exportOverviewToPdf } from '@/lib/exportPdf'

export const dynamic = 'force-dynamic'

function StatCard({ label, value, accent, hint }: { label: string; value: string; accent?: boolean; hint?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-muted mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${accent ? 'text-accent' : ''}`}>{value}</p>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  )
}

export default function OverviewPage() {
  const { clients, users, deposits, closures, withdrawals, withdrawalAllocations, loading } = useAdminData()

  const stats = useMemo(() => {
    const withdrawn = withdrawnByDeposit(withdrawalAllocations, withdrawals)
    const active = activeDeposits(deposits, closures, withdrawn)
    const live = liveTotals(active, withdrawn)
    const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending').length
    return { active, live, withdrawn, withdrawalCount: withdrawals.length, pendingWithdrawals }
  }, [deposits, closures, withdrawals, withdrawalAllocations])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const recent = stats.active.slice(0, 6)

  // Export the all-companies overview as a chronological bank-statement PDF.
  // Deposits export on REMAINING principal (matching the figures on screen).
  const handleExport = async () => {
    const depositsForExport = stats.active.map((d) => ({
      ...d,
      amount: Math.round((Number(d.amount) - (stats.withdrawn.get(d.id) ?? 0)) * 100) / 100,
    }))
    await exportOverviewToPdf(depositsForExport, withdrawals, true)
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Overview" subtitle="Portfolio across all companies">
        <button
          onClick={handleExport}
          disabled={stats.active.length === 0 && withdrawals.length === 0}
          className="btn btn-secondary text-sm py-2 px-4 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Export PDF
        </button>
      </PageHeader>

      {/* Money KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard label="Total Principal (active)" value={formatCurrency(stats.live.principal)} />
        <StatCard label="Current Value" value={formatCurrency(stats.live.currentValue)} accent />
        <StatCard label="Interest Accrued" value={`+${formatCurrency(stats.live.interest)}`} accent />
      </div>

      {/* Count KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Companies" value={String(clients.length)} />
        <StatCard label="Users" value={String(users.length)} hint={`${users.filter(u => u.role === 'admin').length} admins`} />
        <StatCard label="Active Positions" value={String(stats.active.length)} />
        <StatCard label="Withdrawals" value={String(stats.withdrawalCount)} hint={stats.pendingWithdrawals ? `${stats.pendingWithdrawals} pending` : undefined} />
      </div>

      {/* Recent deposits */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent Deposits</h2>
        <Link href="/admin/deposits" className="text-sm text-accent hover:underline">View all →</Link>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Company</th>
              <th>Date</th>
              <th>Principal</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((d) => (
              <tr key={d.id}>
                <td className="text-sm">{d.clients?.name ?? '—'}</td>
                <td className="font-mono text-sm">{formatDate(d.deposit_date + 'T00:00:00')}</td>
                <td className="font-mono">{formatCurrency(Number(d.amount) - (stats.withdrawn.get(d.id) ?? 0))}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr><td colSpan={3} className="text-center text-muted py-6">No active deposits yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
