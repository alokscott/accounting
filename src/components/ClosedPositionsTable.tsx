'use client'

import { formatCurrency, formatDate } from '@/lib/interest'

export interface ClosedPosition {
  closureId: string
  company?: string
  depositDate: string
  closureDate: string
  principal: number
  interestRedeemed: number
  totalPayout: number
  weeksElapsed: number
}

interface ClosedPositionsTableProps {
  positions: ClosedPosition[]
  /** Show the Company column (used by admins viewing all companies). */
  showCompany?: boolean
}

export default function ClosedPositionsTable({ positions, showCompany = false }: ClosedPositionsTableProps) {
  const totals = positions.reduce(
    (acc, pos) => ({
      principal: acc.principal + pos.principal,
      interest: acc.interest + pos.interestRedeemed,
      payout: acc.payout + pos.totalPayout,
    }),
    { principal: 0, interest: 0, payout: 0 }
  )

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Closed Positions</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-muted mb-1">Total Principal Returned</p>
          <p className="text-2xl font-bold font-mono">{formatCurrency(totals.principal)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted mb-1">Total Interest Redeemed</p>
          <p className="text-2xl font-bold font-mono text-accent">+{formatCurrency(totals.interest)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted mb-1">Total Payouts</p>
          <p className="text-2xl font-bold font-mono">{formatCurrency(totals.payout)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr>
                {showCompany && <th>Company</th>}
                <th>Deposit Date</th>
                <th>Closure Date</th>
                <th>Principal</th>
                <th>Weeks</th>
                <th>Interest Redeemed</th>
                <th>Total Payout</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos, index) => (
                <tr
                  key={pos.closureId}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms`, opacity: 0 }}
                >
                  {showCompany && <td className="text-sm">{pos.company ?? '—'}</td>}
                  <td className="font-mono text-sm">{formatDate(pos.depositDate + 'T00:00:00')}</td>
                  <td className="font-mono text-sm">{formatDate(pos.closureDate + 'T00:00:00')}</td>
                  <td className="font-mono">{formatCurrency(pos.principal)}</td>
                  <td>
                    <span className="badge badge-success">
                      {pos.weeksElapsed} {pos.weeksElapsed === 1 ? 'week' : 'weeks'}
                    </span>
                  </td>
                  <td className="font-mono text-accent">+{formatCurrency(pos.interestRedeemed)}</td>
                  <td className="font-mono font-semibold">{formatCurrency(pos.totalPayout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
