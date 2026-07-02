import { calculateCurrentValue, parseDate } from '@/lib/interest'
import type { DepositWithClient, ClosureWithClient } from '@/lib/supabase'

export interface Totals {
  principal: number
  currentValue: number
  interest: number
  count: number
}

/** Cent-level tolerance for floating-point money comparisons. */
const EPS = 0.005

/** Remaining principal of a deposit given an optional withdrawn-by-deposit map. */
function remaining(deposit: DepositWithClient, withdrawn?: Map<string, number>): number {
  return Number(deposit.amount) - (withdrawn?.get(deposit.id) ?? 0)
}

/**
 * Deposits that are still live: not closed, and not fully withdrawn. Pass the
 * withdrawn-by-deposit map to drop deposits whose principal has been fully
 * withdrawn (a partially-withdrawn deposit stays active with reduced principal).
 */
export function activeDeposits(
  deposits: DepositWithClient[],
  closures: ClosureWithClient[],
  withdrawn?: Map<string, number>
): DepositWithClient[] {
  const closedIds = new Set(closures.map((c) => c.deposit_id))
  return deposits.filter((d) => {
    if (closedIds.has(d.id)) return false
    if (withdrawn && remaining(d, withdrawn) <= EPS) return false
    return true
  })
}

/**
 * Live totals (principal + accrued interest) for a set of active deposits.
 * When `withdrawn` is supplied, every figure is computed on each deposit's
 * REMAINING principal (interest is linear in principal, so this is exact).
 */
export function liveTotals(
  deposits: DepositWithClient[],
  withdrawn?: Map<string, number>
): Totals {
  return deposits.reduce<Totals>(
    (acc, d) => {
      const principal = remaining(d, withdrawn)
      // Trust the DB snapshot for current_value / interest_accrued (refreshed by
      // the weekly recompound cron and by the withdraw/reject RPCs, which update
      // it to the remaining principal). Only fall back to a live compute when a
      // row has no snapshot yet.
      const cv = d.current_value != null
        ? Number(d.current_value)
        : calculateCurrentValue(principal, parseDate(d.deposit_date))
      const interest = d.interest_accrued != null
        ? Number(d.interest_accrued)
        : Math.max(0, cv - principal)
      return {
        principal: acc.principal + principal,
        currentValue: acc.currentValue + cv,
        interest: acc.interest + interest,
        count: acc.count + 1,
      }
    },
    { principal: 0, currentValue: 0, interest: 0, count: 0 }
  )
}

/** Totals frozen at closure time. */
export function closedTotals(closures: ClosureWithClient[]) {
  return closures.reduce(
    (acc, c) => ({
      principal: acc.principal + Number(c.principal),
      interest: acc.interest + Number(c.interest_redeemed),
      payout: acc.payout + Number(c.total_payout),
      count: acc.count + 1,
    }),
    { principal: 0, interest: 0, payout: 0, count: 0 }
  )
}
