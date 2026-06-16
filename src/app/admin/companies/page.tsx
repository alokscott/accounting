'use client'

import { useMemo, useState } from 'react'
import { createClient, ALTURA_CLIENT_ID, type Client } from '@/lib/supabase'
import { useAdminData } from '@/components/admin/AdminData'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'
import ApiCredentials from '@/components/ApiCredentials'
import { activeDeposits, liveTotals } from '@/lib/adminStats'
import { withdrawnByDeposit } from '@/lib/withdrawals'
import { formatCurrency } from '@/lib/interest'

export const dynamic = 'force-dynamic'

export default function CompaniesPage() {
  const { clients, users, deposits, closures, withdrawals, withdrawalAllocations, loading, refresh } = useAdminData()
  const [supabase] = useState(() => createClient())

  const [name, setName] = useState('')
  const [wallet, setWallet] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editWallet, setEditWallet] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [apiClient, setApiClient] = useState<Client | null>(null)

  const startEdit = (c: Client) => {
    setEditingId(c.id)
    setEditName(c.name)
    setEditWallet(c.wallet_address ?? '')
    setEditError(null)
  }

  const withdrawn = useMemo(() => withdrawnByDeposit(withdrawalAllocations, withdrawals), [withdrawalAllocations, withdrawals])
  const active = useMemo(() => activeDeposits(deposits, closures, withdrawn), [deposits, closures, withdrawn])

  const rows = useMemo(() => clients.map((c) => {
    const companyActive = active.filter((d) => d.client_id === c.id)
    return {
      ...c,
      userCount: users.filter((u) => u.client_id === c.id).length,
      depositCount: companyActive.length,
      totals: liveTotals(companyActive, withdrawn),
    }
  }), [clients, users, active, withdrawn])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const { error } = await supabase
        .from('clients')
        .insert({ name: name.trim(), wallet_address: wallet.trim() })
      if (error) throw error
      setName('')
      setWallet('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company')
    } finally {
      setCreating(false)
    }
  }

  const handleSaveEdit = async (id: string) => {
    const trimmedName = editName.trim()
    const trimmedWallet = editWallet.trim()
    if (!trimmedName) { setEditError('Company name is required.'); return }
    if (!trimmedWallet) { setEditError('Wallet address is required.'); return }

    setSavingEdit(true)
    setEditError(null)
    try {
      // .select() returns the updated rows — an empty result means the UPDATE
      // matched 0 rows (e.g. RLS blocked it), which PostgREST reports without
      // an error. Surface that instead of silently "succeeding".
      const { data, error } = await supabase
        .from('clients')
        .update({ name: trimmedName, wallet_address: trimmedWallet })
        .eq('id', id)
        .select()
      if (error) { setEditError(error.message); return }
      if (!data || data.length === 0) {
        setEditError('Could not save — you may not have permission (admin required).')
        return
      }
      setEditingId(null)
      await refresh()
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Companies" subtitle="Clients that deposits and users belong to" />

      {/* Create */}
      <div className="card mb-6">
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label htmlFor="name" className="block text-sm font-medium text-muted mb-2">New company name</label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="Acme Corp"
              required
            />
          </div>
          <div className="flex-1">
            <label htmlFor="wallet" className="block text-sm font-medium text-muted mb-2">Withdrawal wallet address</label>
            <input
              id="wallet"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              className="input font-mono"
              placeholder="0x… / wallet address"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary whitespace-nowrap" disabled={creating}>
            {creating ? 'Adding…' : '+ Add Company'}
          </button>
        </form>
        {error && (
          <div className="mt-3 p-3 bg-danger-muted border border-danger/30 rounded-lg text-danger text-sm">{error}</div>
        )}
      </div>

      {/* List */}
      <div className="card p-0 overflow-x-auto">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Company</th>
              <th>Wallet</th>
              <th>Users</th>
              <th>Active Deposits</th>
              <th>Principal</th>
              <th>Current Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">
                  {editingId === c.id ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(c.id)}
                      className="input py-1.5"
                      autoFocus
                    />
                  ) : (
                    <span className="flex items-center gap-2">
                      {c.name}
                      {c.id === ALTURA_CLIENT_ID && <span className="badge badge-success">default</span>}
                    </span>
                  )}
                </td>
                <td className="font-mono text-sm">
                  {editingId === c.id ? (
                    <input
                      value={editWallet}
                      onChange={(e) => setEditWallet(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(c.id)}
                      className="input py-1.5 font-mono"
                      placeholder="wallet address"
                    />
                  ) : c.wallet_address ? (
                    <span className="text-muted" title={c.wallet_address}>
                      {c.wallet_address.length > 16
                        ? `${c.wallet_address.slice(0, 8)}…${c.wallet_address.slice(-6)}`
                        : c.wallet_address}
                    </span>
                  ) : (
                    <span className="badge badge-danger">missing</span>
                  )}
                </td>
                <td className="text-muted text-sm">{c.userCount}</td>
                <td className="text-muted text-sm">{c.depositCount}</td>
                <td className="font-mono text-sm">{formatCurrency(c.totals.principal)}</td>
                <td className="font-mono text-sm text-accent">{formatCurrency(c.totals.currentValue)}</td>
                <td className="text-right">
                  {editingId === c.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleSaveEdit(c.id)} disabled={savingEdit} className="text-accent text-sm hover:underline disabled:opacity-50">
                          {savingEdit ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => { setEditingId(null); setEditError(null) }} className="text-muted text-sm hover:underline">Cancel</button>
                      </div>
                      {editError && <span className="text-danger text-xs">{editError}</span>}
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => startEdit(c)}
                        className="text-muted text-sm hover:text-foreground hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setApiClient(clients.find((x) => x.id === c.id) ?? null)}
                        className="text-muted text-sm hover:text-foreground hover:underline"
                      >
                        API
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {clients.length === 0 && !loading && (
              <tr><td colSpan={7} className="text-center text-muted py-6">No companies yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={apiClient !== null} onClose={() => setApiClient(null)} title={apiClient ? `${apiClient.name} · API access` : 'API access'}>
        {apiClient && (
          <ApiCredentials
            clientId={apiClient.id}
            apiKey={apiClient.api_key}
            apiSecret={apiClient.api_secret}
            onRegenerated={refresh}
          />
        )}
      </Modal>
    </div>
  )
}
