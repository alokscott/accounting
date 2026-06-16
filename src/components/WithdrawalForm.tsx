'use client'

import { useMemo, useState } from 'react'
import { type Client, type DepositWithClient } from '@/lib/supabase'
import { formatCurrency, todayUTC } from '@/lib/interest'
import { planWithdrawal, recordWithdrawal } from '@/lib/withdrawals'
import Select from '@/components/Select'

interface WithdrawalFormProps {
  /** Active (non-closed) deposits across the companies this form can act on. */
  deposits: DepositWithClient[]
  /** Principal already reserved/withdrawn per deposit id. */
  withdrawn: Map<string, number>
  /** Companies (with wallet addresses) this form can act on. */
  clients: Client[]
  onSuccess: () => void
  /** Pre-select this company (admin); still changeable. */
  defaultClientId?: string
  /** Lock the withdrawal to a single company (regular users). */
  fixedClientId?: string
  /** Fallback display name for the fixed company. */
  fixedClientName?: string
}

export default function WithdrawalForm({
  deposits,
  withdrawn,
  clients,
  onSuccess,
  defaultClientId,
  fixedClientId,
  fixedClientName,
}: WithdrawalFormProps) {
  const [clientId, setClientId] = useState<string>(
    fixedClientId ?? defaultClientId ?? clients[0]?.id ?? ''
  )
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedClient = clients.find((c) => c.id === clientId)
  const wallet = selectedClient?.wallet_address?.trim() || ''
  const hasWallet = wallet.length > 0

  // Active deposits for the chosen company only — never another company's.
  const companyDeposits = useMemo(
    () => deposits.filter((d) => d.client_id === clientId),
    [deposits, clientId]
  )

  const parsedAmount = parseFloat(amount)
  const validAmount = !isNaN(parsedAmount) && parsedAmount > 0

  const preview = useMemo(
    () => planWithdrawal(companyDeposits, withdrawn, validAmount ? parsedAmount : 0),
    [companyDeposits, withdrawn, validAmount, parsedAmount]
  )

  const exceeds = validAmount && preview.shortfall > 0
  const canSubmit = hasWallet && validAmount && !exceeds && preview.allocations.length > 0 && !loading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      await recordWithdrawal(clientId, todayUTC(), preview.allocations)
      setAmount('')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request withdrawal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Company */}
      <div>
        <label htmlFor="wd-client" className="block text-sm font-medium text-muted mb-2">Company</label>
        {fixedClientId ? (
          <div className="input flex items-center text-muted">{selectedClient?.name ?? fixedClientName ?? 'Your company'}</div>
        ) : (
          <Select
            id="wd-client"
            value={clientId}
            onChange={setClientId}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
      </div>

      {/* Destination wallet */}
      <div>
        <label className="block text-sm font-medium text-muted mb-2">Sends to</label>
        {hasWallet ? (
          <div className="input font-mono text-sm break-all">{wallet}</div>
        ) : (
          <div className="p-3 bg-danger-muted border border-danger/30 rounded-lg text-danger text-sm">
            This company has no withdrawal wallet address. Set one on the Companies page first.
          </div>
        )}
      </div>

      {/* Amount */}
      <div>
        <label htmlFor="wd-amount" className="block text-sm font-medium text-muted mb-2">
          Withdrawal amount (USD)
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none">$</span>
          <input
            id="wd-amount"
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input"
            style={{ paddingLeft: '2rem' }}
            placeholder="5,000.00"
            required
          />
        </div>
      </div>

      {exceeds && (
        <div className="p-3 bg-danger-muted border border-danger/30 rounded-lg text-danger text-sm">
          Amount exceeds available balance by {formatCurrency(preview.shortfall)}.
        </div>
      )}

      {error && (
        <div className="p-3 bg-danger-muted border border-danger/30 rounded-lg text-danger text-sm">{error}</div>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={!canSubmit}>
        {loading ? 'Submitting…' : 'Request Withdrawal'}
      </button>
      <p className="text-xs text-muted text-center">
        The request stays pending until an admin approves it and records the transaction.
      </p>
    </form>
  )
}
