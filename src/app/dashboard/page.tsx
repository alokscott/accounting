'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  createClient,
  type Client,
  type DepositWithClient,
  type ClosureWithClient,
  type WithdrawalWithClient,
  type WithdrawalAllocation,
} from '@/lib/supabase'
import { useProfile } from '@/lib/useProfile'
import { exportToPdf, exportWithdrawalsToPdf, exportOverviewToPdf } from '@/lib/exportPdf'
import { withdrawnByDeposit } from '@/lib/withdrawals'
import { liveTotals } from '@/lib/adminStats'
import { formatCurrency } from '@/lib/interest'
import AuthGuard from '@/components/AuthGuard'
import DepositForm from '@/components/DepositForm'
import DepositTable from '@/components/DepositTable'
import WithdrawalForm from '@/components/WithdrawalForm'
import WithdrawalsTable from '@/components/WithdrawalsTable'
import ApiCredentials from '@/components/ApiCredentials'
import Select from '@/components/Select'
import Modal from '@/components/admin/Modal'

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

function DashboardContent() {
  const [deposits, setDeposits] = useState<DepositWithClient[]>([])
  const [closures, setClosures] = useState<ClosureWithClient[]>([])
  const [withdrawals, setWithdrawals] = useState<WithdrawalWithClient[]>([])
  const [withdrawalAllocations, setWithdrawalAllocations] = useState<WithdrawalAllocation[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [companyFilter, setCompanyFilter] = useState<string>('all')
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [tab, setTab] = useState<'overview' | 'deposits' | 'withdrawals' | 'api'>('overview')
  const router = useRouter()
  const supabase = createClient()
  const { isAdmin, profile, loading: profileLoading } = useProfile()

  const fetchData = useCallback(async () => {
    try {
      const [depositsResult, closuresResult, withdrawalsResult, allocationsResult, clientsResult] = await Promise.all([
        supabase.from('deposits').select('*, clients(name)').order('deposit_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('closures').select('*, clients(name)').order('closure_date', { ascending: false }),
        supabase.from('withdrawals').select('*, clients(name)').order('withdrawal_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('withdrawal_allocations').select('*'),
        supabase.from('clients').select('*').order('name', { ascending: true }),
      ])

      if (depositsResult.error) throw depositsResult.error
      if (closuresResult.error) throw closuresResult.error
      if (clientsResult.error) throw clientsResult.error

      // Withdrawals are optional: if the 0004 migration hasn't been applied yet,
      // these queries fail — don't let that hide deposits. Just default to empty.
      if (withdrawalsResult.error || allocationsResult.error) {
        console.warn('Withdrawals unavailable (is migration 0004 applied?):', withdrawalsResult.error ?? allocationsResult.error)
      }

      setDeposits((depositsResult.data as DepositWithClient[]) || [])
      setClosures((closuresResult.data as ClosureWithClient[]) || [])
      setWithdrawals((withdrawalsResult.data as WithdrawalWithClient[]) || [])
      setWithdrawalAllocations((allocationsResult.data as WithdrawalAllocation[]) || [])
      setClients((clientsResult.data as Client[]) || [])
    } catch (err) {
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUserEmail(user?.email || null)
    }

    getUser()
    fetchData()
  }, [fetchData, supabase.auth])

  // Admins use the full admin panel; send them there.
  useEffect(() => {
    if (!profileLoading && isAdmin) router.replace('/admin')
  }, [profileLoading, isAdmin, router])

  // Restore the active tab from the URL (?tab=…) so a refresh stays put.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab')
    if (fromUrl && ['overview', 'deposits', 'withdrawals', 'api'].includes(fromUrl)) {
      setTab(fromUrl as typeof tab)
    }
  }, [])

  // Switch tab and reflect it in the URL without adding history entries.
  const selectTab = (id: typeof tab) => {
    setTab(id)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', id)
    window.history.replaceState(null, '', url.toString())
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // Export reflects the tab you're viewing. Deposits export on REMAINING
  // principal so partly-withdrawn positions aren't over-reported.
  const handleExport = async () => {
    const depositsForExport = activeDeposits.map((d) => ({
      ...d,
      amount: Math.round((Number(d.amount) - (withdrawn.get(d.id) ?? 0)) * 100) / 100,
    }))
    if (tab === 'withdrawals') {
      await exportWithdrawalsToPdf(visibleWithdrawals)
    } else if (tab === 'overview') {
      await exportOverviewToPdf(depositsForExport, visibleWithdrawals)
    } else {
      await exportToPdf(depositsForExport)
    }
  }

  const withdrawn = useMemo(() => withdrawnByDeposit(withdrawalAllocations, withdrawals), [withdrawalAllocations, withdrawals])

  // Derive active deposits (exclude closed + fully-withdrawn), then apply the company filter.
  const { activeDeposits, visibleWithdrawals } = useMemo(() => {
    const closedDepositIds = new Set(closures.map(c => c.deposit_id))
    const matchesFilter = (clientId: string) =>
      !isAdmin || companyFilter === 'all' || clientId === companyFilter

    const active = deposits
      .filter(d => !closedDepositIds.has(d.id))
      .filter(d => Number(d.amount) - (withdrawn.get(d.id) ?? 0) > 0.005)
      .filter(d => matchesFilter(d.client_id))

    const visibleWithdrawals = withdrawals.filter(w => matchesFilter(w.client_id))

    return { activeDeposits: active, visibleWithdrawals }
  }, [deposits, closures, withdrawals, withdrawn, isAdmin, companyFilter])

  // The signed-in user's own company (used for the API Access tab).
  const apiCompany = !isAdmin && profile?.client_id
    ? clients.find((c) => c.id === profile.client_id) ?? null
    : null

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'deposits' as const, label: 'Deposits' },
    { id: 'withdrawals' as const, label: 'Withdrawals' },
    ...(apiCompany ? [{ id: 'api' as const, label: 'API Access' }] : []),
  ]

  // Portfolio overview figures.
  const live = liveTotals(activeDeposits, withdrawn)
  const withdrawalTotals = visibleWithdrawals.reduce(
    (acc, w) => w.status === 'rejected'
      ? acc
      : { principal: acc.principal + Number(w.amount), payout: acc.payout + Number(w.total_payout) },
    { principal: 0, payout: 0 }
  )
  const pendingWithdrawals = visibleWithdrawals.filter((w) => w.status === 'pending').length

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 min-h-16 py-2 flex-wrap">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/inessa-logo.svg" alt="Inessa Holdings" className="h-6 w-auto" />
              <p className="text-xs text-muted">
                {isAdmin ? 'Admin · Fund Tracker' : profile?.clients?.name ? `${profile.clients.name} · Fund Tracker` : 'Fund Tracker'}
              </p>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
              <span className="text-sm text-muted hidden sm:block">{userEmail}</span>
              {isAdmin && (
                <Link href="/admin" className="btn btn-secondary text-sm py-2 px-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Admin
                </Link>
              )}
              {!isAdmin && profile?.client_id && (
                <button
                  onClick={() => setShowWithdraw(true)}
                  disabled={activeDeposits.length === 0}
                  className="btn btn-secondary text-sm py-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Withdraw
                </button>
              )}
              {tab !== 'api' && (
                <button
                  onClick={handleExport}
                  disabled={
                    tab === 'withdrawals'
                      ? visibleWithdrawals.length === 0
                      : tab === 'overview'
                        ? activeDeposits.length === 0 && visibleWithdrawals.length === 0
                        : activeDeposits.length === 0
                  }
                  className="btn btn-primary text-sm py-2 px-4 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export PDF
                </button>
              )}
              <button
                onClick={handleSignOut}
                className="btn btn-secondary text-sm py-2 px-4"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="border-b border-border mb-6 flex gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              style={{ outline: 'none' }}
              className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id ? 'text-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
              )}
            </button>
          ))}
        </div>

        {loading || profileLoading ? (
          <div className="card flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-muted">Loading…</p>
            </div>
          </div>
        ) : (
          <>
            {/* Overview */}
            {tab === 'overview' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatCard label="Total Principal" value={formatCurrency(live.principal)} />
                  <StatCard label="Current Value" value={formatCurrency(live.currentValue)} accent />
                  <StatCard label="Interest Accrued" value={`+${formatCurrency(live.interest)}`} accent />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <StatCard label="Active Positions" value={String(activeDeposits.length)} />
                  <StatCard
                    label="Total Withdrawn"
                    value={formatCurrency(withdrawalTotals.principal)}
                    hint={pendingWithdrawals ? `${pendingWithdrawals} pending` : undefined}
                  />
                  <StatCard label="Total Payouts" value={formatCurrency(withdrawalTotals.payout)} />
                </div>
              </div>
            )}

            {/* Deposits */}
            {tab === 'deposits' && (
              <div className={isAdmin ? 'grid grid-cols-1 lg:grid-cols-3 gap-8' : ''}>
                {isAdmin && (
                  <div className="lg:col-span-1">
                    <DepositForm onSuccess={fetchData} clients={clients} />
                  </div>
                )}
                <div className={isAdmin ? 'lg:col-span-2' : ''}>
                  {isAdmin && clients.length > 1 && (
                    <div className="mb-4 flex items-center gap-3">
                      <label htmlFor="companyFilter" className="text-sm text-muted">Company</label>
                      <Select
                        id="companyFilter"
                        value={companyFilter}
                        onChange={setCompanyFilter}
                        options={[{ value: 'all', label: 'All companies' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                        className="max-w-xs"
                      />
                    </div>
                  )}
                  <DepositTable
                    deposits={activeDeposits}
                    onRefresh={fetchData}
                    readOnly={!isAdmin}
                    showCompany={isAdmin}
                    withdrawn={withdrawn}
                  />
                </div>
              </div>
            )}

            {/* Withdrawals */}
            {tab === 'withdrawals' && (
              visibleWithdrawals.length > 0 ? (
                <WithdrawalsTable withdrawals={visibleWithdrawals} showCompany={isAdmin} />
              ) : (
                <div className="card text-center py-12 text-muted">No withdrawals yet.</div>
              )
            )}

            {/* API Access */}
            {tab === 'api' && apiCompany && (
              <div>
                <h2 className="text-lg font-semibold mb-4">API Access</h2>
                <div className="card">
                  <ApiCredentials
                    clientId={apiCompany.id}
                    apiKey={apiCompany.api_key}
                    apiSecret={apiCompany.api_secret}
                    onRegenerated={fetchData}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer Info */}
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-6 text-xs text-muted">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
              <span>Live calculations</span>
            </div>
            <span>•</span>
            <span>0.5% weekly compound interest</span>
            <span>•</span>
            <span>Interest starts after first complete week</span>
          </div>
        </div>
      </main>

      {!isAdmin && profile?.client_id && (
        <Modal open={showWithdraw} onClose={() => setShowWithdraw(false)} title="Withdraw">
          <WithdrawalForm
            deposits={activeDeposits}
            withdrawn={withdrawn}
            clients={clients}
            fixedClientId={profile.client_id}
            fixedClientName={profile.clients?.name}
            onSuccess={() => { fetchData(); setShowWithdraw(false) }}
          />
        </Modal>
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  )
}
