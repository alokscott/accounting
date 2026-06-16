'use client'

import { useMemo, useState } from 'react'
import { ALTURA_CLIENT_ID } from '@/lib/supabase'
import { useAdminData, type AdminUser } from '@/components/admin/AdminData'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'
import Select from '@/components/Select'

export const dynamic = 'force-dynamic'

export default function UsersPage() {
  const { clients, users, loading, refresh, authHeader } = useAdminData()

  const [showForm, setShowForm] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // create form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [clientId, setClientId] = useState<string>(ALTURA_CLIENT_ID)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => (u.email ?? '').toLowerCase().includes(q))
  }, [users, query])

  // Pagination (client-side). Clamp the page so deletes/filtering never strand it.
  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const pageItems = filtered.slice(pageStart, pageStart + pageSize)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ email, password, role, client_id: clientId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create user')
      setEmail(''); setPassword(''); setRole('user'); setClientId(ALTURA_CLIENT_ID)
      setShowForm(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async (id: string, patch: { role?: 'admin' | 'user'; client_id?: string | null }) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { alert(data.error || 'Failed to update user'); return }
    await refresh()
  }

  const handleDelete = async (u: AdminUser) => {
    if (!confirm(`Delete ${u.email ?? u.id}? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE', headers: await authHeader() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { alert(data.error || 'Failed to delete user'); return }
    await refresh()
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Users" subtitle="Accounts, roles and company assignment">
        <button onClick={() => setShowForm(true)} className="btn btn-primary text-sm py-2 px-4 whitespace-nowrap">
          + Add User
        </button>
      </PageHeader>

      {/* Create form */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Add User">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="person@company.com" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Temporary Password</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="At least 6 characters" minLength={6} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Role</label>
            <Select
              value={role}
              onChange={(v) => setRole(v as 'admin' | 'user')}
              options={[{ value: 'user', label: 'User (read-only)' }, { value: 'admin', label: 'Admin' }]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Company</label>
            <Select
              value={clientId}
              onChange={setClientId}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
          {error && (
            <div className="p-3 bg-danger-muted border border-danger/30 rounded-lg text-danger text-sm">{error}</div>
          )}
          <button type="submit" className="btn btn-primary w-full" disabled={saving}>{saving ? 'Creating…' : 'Create User'}</button>
        </form>
      </Modal>

      {/* Search */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1) }}
          className="input max-w-sm"
          placeholder="Search by email…"
        />
        <div className="flex items-center gap-2 text-sm text-muted">
          <span>Rows</span>
          <Select
            value={String(pageSize)}
            onChange={(v) => { setPageSize(Number(v)); setPage(1) }}
            options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))}
            className="w-auto"
            sizeClassName="py-1.5 px-3"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-x-auto">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Company</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((u) => (
              <tr key={u.id}>
                <td className="text-sm">{u.email ?? '—'}</td>
                <td>
                  {editingId === u.id ? (
                    <Select
                      value={u.role}
                      onChange={(v) => handleEdit(u.id, { role: v as 'admin' | 'user' })}
                      options={[{ value: 'user', label: 'User' }, { value: 'admin', label: 'Admin' }]}
                      sizeClassName="py-1.5 px-3"
                    />
                  ) : (
                    <span className={`badge ${u.role === 'admin' ? 'badge-success' : ''}`}>{u.role}</span>
                  )}
                </td>
                <td className="text-sm text-muted">
                  {editingId === u.id ? (
                    <Select
                      value={u.client_id ?? ''}
                      onChange={(v) => handleEdit(u.id, { client_id: v || null })}
                      options={[{ value: '', label: '— none —' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                      sizeClassName="py-1.5 px-3"
                    />
                  ) : (
                    u.clients?.name ?? '—'
                  )}
                </td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => setEditingId(editingId === u.id ? null : u.id)}
                      className="text-sm text-muted hover:text-foreground hover:underline"
                    >
                      {editingId === u.id ? 'Done' : 'Edit'}
                    </button>
                    <button onClick={() => handleDelete(u)} className="text-sm text-muted hover:text-danger hover:underline">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={4} className="text-center text-muted py-6">{query ? 'No matches.' : 'No users yet.'}</td></tr>
            )}
          </tbody>
        </table>

        {total > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border text-sm">
            <span className="text-muted">
              {pageStart + 1}–{Math.min(pageStart + pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
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
