import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
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
  user_id: string
  amount: number | string
  deposit_date: string
  current_value: number | string | null
  interest_accrued: number | string | null
  created_at: string
}

type ClosureRow = {
  id: string
  deposit_id: string
  user_id: string
  principal: number | string
  interest_redeemed: number | string
  total_payout: number | string
  weeks_elapsed: number
  closure_date: string
  created_at: string
}

type AllocationRow = {
  deposit_id: string
  principal_withdrawn: number | string
  withdrawal_id: string
}

type WithdrawalStatusRow = {
  id: string
  status: 'pending' | 'approved' | 'rejected'
}

type ApiDeposit = {
  id: string
  userId: string
  amount: number
  depositDate: string
  firstWeekStart: string
  interestStartDate: string
  completeWeeks: number
  interest: number
  currentValue: number
}

type ApiClosedDeposit = {
  id: string
  depositId: string
  userId: string
  principal: number
  interestRedeemed: number
  totalPayout: number
  weeksElapsed: number
  depositDate: string
  closureDate: string
}

const corsOrigins = (process.env.PUBLIC_API_CORS_ORIGINS ?? '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const allowAnyOrigin = corsOrigins.length === 0 || corsOrigins.includes('*')

function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin')

  if (!origin || allowAnyOrigin) {
    return true
  }

  return corsOrigins.includes(origin)
}

function getCorsHeaders(request: Request): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
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

export async function OPTIONS(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json(
      { error: 'CORS origin not allowed.' },
      { status: 403, headers: getCorsHeaders(request) }
    )
  }

  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  })
}

export async function GET(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json(
      { error: 'CORS origin not allowed.' },
      { status: 403, headers: getCorsHeaders(request) }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')
    const supabase = createSupabaseAdminClient()

    let depositsQuery = supabase
      .from('deposits')
      .select('id, user_id, amount, deposit_date, current_value, interest_accrued, created_at')
      .order('deposit_date', { ascending: false })
      .order('created_at', { ascending: false })

    let closuresQuery = supabase
      .from('closures')
      .select('id, deposit_id, user_id, principal, interest_redeemed, total_payout, weeks_elapsed, closure_date, created_at')
      .order('closure_date', { ascending: false })

    if (userId) {
      depositsQuery = depositsQuery.eq('user_id', userId)
      closuresQuery = closuresQuery.eq('user_id', userId)
    }

    const [allocationsResult, withdrawalStatusResult] = await Promise.all([
      supabase.from('withdrawal_allocations').select('deposit_id, principal_withdrawn, withdrawal_id'),
      supabase.from('withdrawals').select('id, status'),
    ])

    const [depositsResult, closuresResult] = await Promise.all([depositsQuery, closuresQuery])

    if (depositsResult.error) throw depositsResult.error
    if (closuresResult.error) throw closuresResult.error
    if (allocationsResult.error) throw allocationsResult.error
    if (withdrawalStatusResult.error) throw withdrawalStatusResult.error

    const rows = (depositsResult.data ?? []) as DepositRow[]
    const closureRows = (closuresResult.data ?? []) as ClosureRow[]
    const allocationRows = (allocationsResult.data ?? []) as AllocationRow[]
    const withdrawalRows = (withdrawalStatusResult.data ?? []) as WithdrawalStatusRow[]

    const closedDepositIds = new Set(closureRows.map(c => c.deposit_id))
    const depositMap = new Map(rows.map(r => [r.id, r]))

    // Principal reserved/withdrawn per deposit. Pending + approved both reduce
    // it (a request reserves the principal); rejected withdrawals are released.
    const rejectedWithdrawalIds = new Set(withdrawalRows.filter(w => w.status === 'rejected').map(w => w.id))
    const withdrawnByDeposit = new Map<string, number>()
    for (const a of allocationRows) {
      if (rejectedWithdrawalIds.has(a.withdrawal_id)) continue
      withdrawnByDeposit.set(a.deposit_id, (withdrawnByDeposit.get(a.deposit_id) ?? 0) + toNumber(a.principal_withdrawn))
    }

    // Active deposits: not closed and with remaining principal left. Every figure
    // reflects the REMAINING principal (interest is linear in principal).
    const activeRows = rows.filter(r =>
      !closedDepositIds.has(r.id) &&
      toNumber(r.amount) - (withdrawnByDeposit.get(r.id) ?? 0) > 0.005
    )
    const activeDeposits: ApiDeposit[] = activeRows.map((row) => {
      const amount = toNumber(row.amount) - (withdrawnByDeposit.get(row.id) ?? 0)
      const depositDate = parseDate(row.deposit_date)

      // Trust the stored current_value / interest_accrued snapshot (refreshed by
      // the weekly recompound cron and the withdraw/reject RPCs); only fall back
      // to a live compute when a row has no snapshot yet.
      const currentValue = row.current_value != null
        ? toNumber(row.current_value)
        : calculateCurrentValue(amount, depositDate)
      const interest = row.interest_accrued != null
        ? toNumber(row.interest_accrued)
        : calculateInterestEarned(amount, depositDate)

      return {
        id: row.id,
        userId: row.user_id,
        amount: roundMoney(amount),
        depositDate: row.deposit_date,
        firstWeekStart: toDateOnly(getFirstWeekStart(depositDate)),
        interestStartDate: toDateOnly(getInterestStartDate(depositDate)),
        completeWeeks: getCompleteWeeks(depositDate),
        interest: roundMoney(interest),
        currentValue: roundMoney(currentValue),
      }
    })

    // Closed deposits
    const closedDeposits: ApiClosedDeposit[] = closureRows.map((closure) => {
      const deposit = depositMap.get(closure.deposit_id)
      return {
        id: closure.id,
        depositId: closure.deposit_id,
        userId: closure.user_id,
        principal: roundMoney(toNumber(closure.principal)),
        interestRedeemed: roundMoney(toNumber(closure.interest_redeemed)),
        totalPayout: roundMoney(toNumber(closure.total_payout)),
        weeksElapsed: closure.weeks_elapsed,
        depositDate: deposit?.deposit_date ?? closure.closure_date,
        closureDate: closure.closure_date,
      }
    })

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

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        filters: {
          userId: userId ?? null,
        },
        activeTotals: {
          principal: roundMoney(activeTotals.principal),
          currentValue: roundMoney(activeTotals.currentValue),
          interest: roundMoney(activeTotals.interest),
        },
        closedTotals: {
          principal: roundMoney(closedTotals.principal),
          interestRedeemed: roundMoney(closedTotals.interestRedeemed),
          totalPayout: roundMoney(closedTotals.totalPayout),
        },
        stats: {
          activeDepositCount: activeDeposits.length,
          closedDepositCount: closedDeposits.length,
          averageDeposit: roundMoney(activeDeposits.length ? activeTotals.principal / activeDeposits.length : 0),
          firstDepositDate: activeDeposits.length > 0 ? activeDeposits[activeDeposits.length - 1].depositDate : null,
          latestDepositDate: activeDeposits.length > 0 ? activeDeposits[0].depositDate : null,
        },
        activeDeposits,
        closedDeposits,
      },
      {
        headers: {
          ...getCorsHeaders(request),
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (error) {
    console.error('Public deposits API error:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch deposits.',
      },
      {
        status: 500,
        headers: getCorsHeaders(request),
      }
    )
  }
}
