'use client'

import { useMemo, useState } from 'react'
import { useAdminData } from '@/components/admin/AdminData'
import PageHeader from '@/components/admin/PageHeader'
import DepositForm from '@/components/DepositForm'
import DepositTable from '@/components/DepositTable'
import Modal from '@/components/admin/Modal'
import Select from '@/components/Select'
import { activeDeposits } from '@/lib/adminStats'
import { withdrawnByDeposit } from '@/lib/withdrawals'
import { exportToPdf } from '@/lib/exportPdf'

export const dynamic = 'force-dynamic'

export default function DepositsPage() {
  const { clients, deposits, closures, withdrawals, withdrawalAllocations, loading, refresh } = useAdminData()
  const [showForm, setShowForm] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [filter, setFilter] = useState('all')

  const withdrawn = useMemo(() => withdrawnByDeposit(withdrawalAllocations, withdrawals), [withdrawalAllocations, withdrawals])

  const active = useMemo(
    () => activeDeposits(deposits, closures, withdrawn).filter((d) => filter === 'all' || d.client_id === filter),
    [deposits, closures, withdrawn, filter]
  )

  // Apply the optional From/To range (on deployment date) for the export only.
  const inRange = (date: string) =>
    (!fromDate || date >= fromDate) && (!toDate || date <= toDate)

  // Export on REMAINING principal (a partly-withdrawn deposit must not export its
  // original amount), matching what the table shows.
  const exportActive = active
    .filter((d) => inRange(d.deposit_date))
    .map((d) => ({ ...d, amount: Math.round((Number(d.amount) - (withdrawn.get(d.id) ?? 0)) * 100) / 100 }))

  const handleExport = async () => {
    let rangeLabel: string | undefined
    if (fromDate && toDate) rangeLabel = `${fromDate} to ${toDate}`
    else if (fromDate) rangeLabel = `From ${fromDate}`
    else if (toDate) rangeLabel = `Up to ${toDate}`

    await exportToPdf(exportActive, [], rangeLabel, true)
    setShowExport(false)
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Deposits" subtitle="All deposits across companies">
        {/* Keep the filter + all action buttons together on one line. */}
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: 'All companies' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            className="w-auto max-w-[150px] shrink-0"
            sizeClassName="py-2 px-2 text-sm"
          />
          <button
            onClick={() => setShowExport(true)}
            disabled={active.length === 0}
            className="btn btn-secondary text-sm py-2 px-4 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export PDF
          </button>
          <button onClick={() => setShowForm(true)} className="btn btn-primary text-sm py-2 px-4 whitespace-nowrap shrink-0">
            + Add Deposit
          </button>
        </div>
      </PageHeader>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Add Deposit">
        <DepositForm bare clients={clients} onSuccess={() => { refresh(); setShowForm(false) }} />
      </Modal>

      <Modal open={showExport} onClose={() => setShowExport(false)} title="Export PDF">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Optionally limit the export to a deployment-date range. Leave blank to include everything
            {filter !== 'all' ? ' for the selected company' : ''}.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fromDate" className="block text-sm font-medium text-muted mb-2">From</label>
              <input id="fromDate" type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} className="input" />
            </div>
            <div>
              <label htmlFor="toDate" className="block text-sm font-medium text-muted mb-2">To</label>
              <input id="toDate" type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} className="input" />
            </div>
          </div>
          <p className="text-xs text-muted">
            {exportActive.length} deposit{exportActive.length === 1 ? '' : 's'} in range
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exportActive.length === 0}
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
        <DepositTable deposits={active} onRefresh={refresh} showCompany withdrawn={withdrawn} />
      )}
    </div>
  )
}
