import { createClient, type DepositWithClient, type Withdrawal, type WithdrawalAllocation } from '@/lib/supabase'
import { calculateCurrentValue, getCompleteWeeks, parseDate } from '@/lib/interest'

/** Cent-level tolerance for floating-point money comparisons. */
const EPS = 0.005

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Total principal reserved/withdrawn per deposit id. Pending AND approved
 * withdrawals both count (a pending request reserves the principal); rejected
 * ones are released. Pass `withdrawals` to know each allocation's status.
 */
export function withdrawnByDeposit(
  allocations: Pick<WithdrawalAllocation, 'deposit_id' | 'principal_withdrawn' | 'withdrawal_id'>[],
  withdrawals?: Pick<Withdrawal, 'id' | 'status'>[]
): Map<string, number> {
  const rejected = new Set((withdrawals ?? []).filter((w) => w.status === 'rejected').map((w) => w.id))
  const map = new Map<string, number>()
  for (const a of allocations) {
    if (rejected.has(a.withdrawal_id)) continue
    map.set(a.deposit_id, (map.get(a.deposit_id) ?? 0) + Number(a.principal_withdrawn))
  }
  return map
}

/** Principal still invested in a deposit (original minus everything withdrawn). */
export function remainingPrincipal(
  deposit: Pick<DepositWithClient, 'id' | 'amount'>,
  withdrawn: Map<string, number>
): number {
  return round2(Number(deposit.amount) - (withdrawn.get(deposit.id) ?? 0))
}

/** One deposit's slice of a planned withdrawal. */
export interface AllocationDraft {
  deposit_id: string
  principal_withdrawn: number
  interest_withdrawn: number
  weeks_elapsed: number
  /** Display-only context for the preview. */
  depositDate: string
  remainingBefore: number
}

export interface WithdrawalPreview {
  allocations: AllocationDraft[]
  /** Total principal that will be removed from deposits. */
  principal: number
  /** Interest portion of the payout. */
  interest: number
  /** Total cash paid out = the amount the user requested (principal + interest). */
  payout: number
  /** Requested amount that can't be covered (>0 ⇒ exceeds available current value). */
  shortfall: number
  /** Total current value in the company's pool (principal + accrued interest). */
  available: number
}

/**
 * Plan a withdrawal where `amount` is the **total payout** the user wants to
 * receive (cash they get). We consume each deposit's CURRENT VALUE (principal
 * + accrued interest) oldest-first until the payout is reached, and back out
 * the principal vs interest portion per deposit (principal = take / (1+r)^w).
 * Any untouched remainder of a deposit keeps its original deposit date and
 * keeps compounding.
 *
 * `deposits` should already be the company's ACTIVE (non-closed) deposits.
 */
export function planWithdrawal(
  deposits: DepositWithClient[],
  withdrawn: Map<string, number>,
  amount: number,
  asOf: Date = new Date()
): WithdrawalPreview {
  // Oldest first: deposit_date asc, created_at asc as a stable tiebreak.
  const ordered = [...deposits].sort((a, b) => {
    if (a.deposit_date !== b.deposit_date) return a.deposit_date < b.deposit_date ? -1 : 1
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
    return 0
  })

  // Helper: prefer the DB-stored current_value (refreshed by the weekly cron
  // and by the withdraw/reject RPCs) and fall back to live compute if a row
  // hasn't been refreshed yet.
  const currentValueOf = (d: DepositWithClient, remaining: number): number =>
    d.current_value != null
      ? Number(d.current_value)
      : calculateCurrentValue(remaining, parseDate(d.deposit_date), asOf)

  // Available = total CURRENT VALUE across remaining principal (principal + accrued interest).
  const available = round2(
    ordered.reduce((sum, d) => {
      const remaining = remainingPrincipal(d, withdrawn)
      if (remaining <= EPS) return sum
      return sum + currentValueOf(d, remaining)
    }, 0)
  )

  const requested = round2(Math.max(0, amount))
  let left = requested
  let principal = 0
  let interest = 0
  const allocations: AllocationDraft[] = []

  for (const d of ordered) {
    if (left <= EPS) break
    const remaining = remainingPrincipal(d, withdrawn)
    if (remaining <= EPS) continue

    const date = parseDate(d.deposit_date)
    const weeks = getCompleteWeeks(date, asOf)
    const currentValue = currentValueOf(d, remaining)
    if (currentValue <= EPS) continue

    // Consume current value oldest-first; split back into principal + interest.
    // factor = (1 + r)^weeks  →  principal_taken = takeCv / factor
    const factor = currentValue / remaining
    const takeCv = Math.min(left, currentValue)
    const principalTaken = round2(takeCv / factor)
    const interestTaken = round2(takeCv - principalTaken)

    if (principalTaken > 0) {
      allocations.push({
        deposit_id: d.id,
        principal_withdrawn: principalTaken,
        interest_withdrawn: interestTaken,
        weeks_elapsed: weeks,
        depositDate: d.deposit_date,
        remainingBefore: remaining,
      })
      principal = round2(principal + principalTaken)
      interest = round2(interest + interestTaken)
    }

    left = round2(left - takeCv)
  }

  return {
    allocations,
    principal,
    interest,
    payout: round2(principal + interest),
    shortfall: round2(Math.max(0, requested - available)),
    available,
  }
}

/**
 * Persist a planned withdrawal atomically via the record_withdrawal RPC.
 * Returns the new withdrawal's id (so the admin close flow can approve it).
 */
export async function recordWithdrawal(
  clientId: string,
  withdrawalDate: string,
  allocations: AllocationDraft[]
): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('record_withdrawal', {
    p_client_id: clientId,
    p_withdrawal_date: withdrawalDate,
    p_allocations: allocations.map((a) => ({
      deposit_id: a.deposit_id,
      principal_withdrawn: a.principal_withdrawn,
      interest_withdrawn: a.interest_withdrawn,
      weeks_elapsed: a.weeks_elapsed,
    })),
  })
  if (error) {
    // Supabase returns a plain PostgrestError (not an Error), so surface its
    // message/hint explicitly instead of letting callers show a generic string.
    const detail = [error.message, error.hint].filter(Boolean).join(' — ')
    throw new Error(detail || 'Failed to record withdrawal')
  }
  return data as string
}

function rpcError(error: { message?: string; hint?: string } | null, fallback: string) {
  if (!error) return
  const detail = [error.message, error.hint].filter(Boolean).join(' — ')
  throw new Error(detail || fallback)
}

/** Approve a pending withdrawal, recording its on-chain transaction hash. */
export async function approveWithdrawal(withdrawalId: string, txHash: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('approve_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_tx_hash: txHash,
  })
  rpcError(error, 'Failed to approve withdrawal')
}

/** Reject a pending withdrawal, releasing the reserved principal. */
export async function rejectWithdrawal(withdrawalId: string, reason: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('reject_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_reason: reason,
  })
  rpcError(error, 'Failed to reject withdrawal')
}
