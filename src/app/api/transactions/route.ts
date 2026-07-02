import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import {
  calculateCurrentValue,
  calculateInterestEarned,
  getCompleteWeeks,
  getFirstWeekStart,
  getInterestStartDate,
  parseDate,
} from '@/lib/interest'

export const dynamic = 'force-dynamic'

type DepositRow = {
  id: string
  amount: number | string
  deposit_date: string
  current_value: number | string | null
  interest_accrued: number | string | null
  created_at: string
}

type ClosureRow = {
  id: string
  deposit_id: string
  principal: number | string
  interest_redeemed: number | string
  total_payout: number | string
  weeks_elapsed: number
  closure_date: string
}

type WithdrawalRow = {
  id: string
  amount: number | string
  interest_paid: number | string
  total_payout: number | string
  withdrawal_date: string
  status: 'pending' | 'approved' | 'rejected'
  tx_hash: string | null
}

type AllocationRow = {
  deposit_id: string
  principal_withdrawn: number | string
  withdrawal_id: string
}

const corsOrigins = (process.env.PUBLIC_API_CORS_ORIGINS ?? '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const allowAnyOrigin = corsOrigins.length === 0 || corsOrigins.includes('*')

function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin || allowAnyOrigin) return true
  return corsOrigins.includes(origin)
}

function getCorsHeaders(request: Request): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, x-api-secret',
    'Access-Control-Max-Age': '0',
  }
  if (allowAnyOrigin) {
    headers['Access-Control-Allow-Origin'] = '*'
    return headers
  }
  const origin = request.headers.get('origin')
  if (origin && corsOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Vary'] = 'Origin'
  }
  return headers
}

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function toDateOnly(date: Date): string {
  // Dates from the interest helpers are UTC instants; emit the UTC calendar date.
  return date.toISOString().slice(0, 10)
}

function toNumber(val: number | string): number {
  const n = typeof val === 'string' ? Number.parseFloat(val) : val
  return Number.isFinite(n) ? n : 0
}

/** Constant-time string comparison that won't throw on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function OPTIONS(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: 'CORS origin not allowed.' }, { status: 403, headers: getCorsHeaders(request) })
  }
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) })
}

export async function GET(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: 'CORS origin not allowed.' }, { status: 403, headers: getCorsHeaders(request) })
  }

  const cors = getCorsHeaders(request)

  try {
    const apiKey = request.headers.get('x-api-key')?.trim()
    const apiSecret = request.headers.get('x-api-secret')?.trim()

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'Missing credentials. Provide x-api-key and x-api-secret headers.' },
        { status: 401, headers: cors }
      )
    }

    const supabase = createSupabaseAdminClient()

    const { data: company, error: companyError } = await supabase
      .from('clients')
      .select('id, name, api_secret')
      .eq('api_key', apiKey)
      .maybeSingle()

    if (companyError) throw companyError

    // Same response for unknown key and wrong secret — don't leak which failed.
    if (!company || !company.api_secret || !safeEqual(String(company.api_secret), apiSecret)) {
      return NextResponse.json({ error: 'Invalid API credentials.' }, { status: 401, headers: cors })
    }

    const clientId = company.id as string

    const [depositsResult, closuresResult, withdrawalsResult, allocationsResult] = await Promise.all([
      supabase.from('deposits').select('id, amount, deposit_date, current_value, interest_accrued, created_at').eq('client_id', clientId).order('deposit_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('closures').select('id, deposit_id, principal, interest_redeemed, total_payout, weeks_elapsed, closure_date').eq('client_id', clientId).order('closure_date', { ascending: false }),
      supabase.from('withdrawals').select('id, amount, interest_paid, total_payout, withdrawal_date, status, tx_hash, created_at').eq('client_id', clientId).order('withdrawal_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('withdrawal_allocations').select('deposit_id, principal_withdrawn, withdrawal_id'),
    ])

    if (depositsResult.error) throw depositsResult.error
    if (closuresResult.error) throw closuresResult.error
    if (withdrawalsResult.error) throw withdrawalsResult.error
    if (allocationsResult.error) throw allocationsResult.error

    const depositRows = (depositsResult.data ?? []) as DepositRow[]
    const closureRows = (closuresResult.data ?? []) as ClosureRow[]
    const withdrawalRows = (withdrawalsResult.data ?? []) as WithdrawalRow[]
    const allocationRows = (allocationsResult.data ?? []) as AllocationRow[]

    const depositIds = new Set(depositRows.map((d) => d.id))
    const closedDepositIds = new Set(closureRows.map((c) => c.deposit_id))

    // Reserved/withdrawn principal per deposit. Pending + approved reduce it;
    // rejected withdrawals are released. Scoped to this company's deposits.
    const rejectedWithdrawalIds = new Set(withdrawalRows.filter((w) => w.status === 'rejected').map((w) => w.id))
    const withdrawnByDeposit = new Map<string, number>()
    for (const a of allocationRows) {
      if (!depositIds.has(a.deposit_id)) continue
      if (rejectedWithdrawalIds.has(a.withdrawal_id)) continue
      withdrawnByDeposit.set(a.deposit_id, (withdrawnByDeposit.get(a.deposit_id) ?? 0) + toNumber(a.principal_withdrawn))
    }

    // Active deposits — not closed, with remaining principal. Figures use the
    // remaining principal (interest is linear in principal).
    const activeDeposits = depositRows
      .filter((d) => !closedDepositIds.has(d.id) && toNumber(d.amount) - (withdrawnByDeposit.get(d.id) ?? 0) > 0.005)
      .map((d) => {
        const amount = toNumber(d.amount) - (withdrawnByDeposit.get(d.id) ?? 0)
        const depositDate = parseDate(d.deposit_date)
        // Trust the stored current_value / interest_accrued snapshot (refreshed by
        // the weekly recompound cron and the withdraw/reject RPCs); only fall back
        // to a live compute when a row has no snapshot yet.
        const currentValue = d.current_value != null
          ? toNumber(d.current_value)
          : calculateCurrentValue(amount, depositDate)
        const interest = d.interest_accrued != null
          ? toNumber(d.interest_accrued)
          : calculateInterestEarned(amount, depositDate)
        return {
          id: d.id,
          amount: roundMoney(amount),
          depositDate: d.deposit_date,
          firstWeekStart: toDateOnly(getFirstWeekStart(depositDate)),
          interestStartDate: toDateOnly(getInterestStartDate(depositDate)),
          completeWeeks: getCompleteWeeks(depositDate),
          interest: roundMoney(interest),
          currentValue: roundMoney(currentValue),
        }
      })

    const closedDeposits = closureRows.map((c) => ({
      id: c.id,
      depositId: c.deposit_id,
      principal: roundMoney(toNumber(c.principal)),
      interestRedeemed: roundMoney(toNumber(c.interest_redeemed)),
      totalPayout: roundMoney(toNumber(c.total_payout)),
      weeksElapsed: c.weeks_elapsed,
      closureDate: c.closure_date,
    }))

    const withdrawals = withdrawalRows.map((w) => ({
      id: w.id,
      amount: roundMoney(toNumber(w.amount)),
      interestPaid: roundMoney(toNumber(w.interest_paid)),
      totalPayout: roundMoney(toNumber(w.total_payout)),
      status: w.status,
      txHash: w.tx_hash,
      date: w.withdrawal_date,
    }))

    // Unified, newest-first transaction history.
    const transactions = [
      ...depositRows.map((d) => ({
        type: 'deposit' as const,
        date: d.deposit_date,
        amount: roundMoney(toNumber(d.amount)),
        id: d.id,
      })),
      ...withdrawals.map((w) => ({
        type: 'withdrawal' as const,
        date: w.date,
        amount: w.amount,
        interestPaid: w.interestPaid,
        totalPayout: w.totalPayout,
        status: w.status,
        txHash: w.txHash,
        id: w.id,
      })),
      ...closedDeposits.map((c) => ({
        type: 'closure' as const,
        date: c.closureDate,
        principal: c.principal,
        interestRedeemed: c.interestRedeemed,
        totalPayout: c.totalPayout,
        id: c.id,
      })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

    const activeTotals = activeDeposits.reduce(
      (acc, d) => ({
        principal: acc.principal + d.amount,
        currentValue: acc.currentValue + d.currentValue,
        interest: acc.interest + d.interest,
      }),
      { principal: 0, currentValue: 0, interest: 0 }
    )

    const closedTotals = closedDeposits.reduce(
      (acc, d) => ({
        principal: acc.principal + d.principal,
        interestRedeemed: acc.interestRedeemed + d.interestRedeemed,
        totalPayout: acc.totalPayout + d.totalPayout,
      }),
      { principal: 0, interestRedeemed: 0, totalPayout: 0 }
    )

    const withdrawalTotals = withdrawals.reduce(
      (acc, w) => {
        if (w.status === 'rejected') return acc
        return {
          principal: acc.principal + w.amount,
          interestPaid: acc.interestPaid + w.interestPaid,
          totalPayout: acc.totalPayout + w.totalPayout,
        }
      },
      { principal: 0, interestPaid: 0, totalPayout: 0 }
    )

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        company: { id: company.id, name: company.name },
        summary: {
          activePrincipal: roundMoney(activeTotals.principal),
          currentValue: roundMoney(activeTotals.currentValue),
          interestAccrued: roundMoney(activeTotals.interest),
          closedPrincipal: roundMoney(closedTotals.principal),
          closedInterestRedeemed: roundMoney(closedTotals.interestRedeemed),
          closedPayout: roundMoney(closedTotals.totalPayout),
          withdrawnPrincipal: roundMoney(withdrawalTotals.principal),
          withdrawnInterestPaid: roundMoney(withdrawalTotals.interestPaid),
          withdrawnPayout: roundMoney(withdrawalTotals.totalPayout),
          activeDepositCount: activeDeposits.length,
          closedDepositCount: closedDeposits.length,
          withdrawalCount: withdrawals.length,
          pendingWithdrawalCount: withdrawals.filter((w) => w.status === 'pending').length,
        },
        transactions,
        deposits: activeDeposits,
        closures: closedDeposits,
        withdrawals,
      },
      { headers: { ...cors, 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('Public transactions API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch transactions.' },
      { status: 500, headers: cors }
    )
  }
}
