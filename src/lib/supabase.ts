import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Stable id of the default company ("Altura"). Must match the seeded row and
 * the column defaults in supabase/accounting-project/01_schema.sql.
 */
export const ALTURA_CLIENT_ID = 'cmp_ZVsWOFqVpB'

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env.local file.'
    )
  }
  
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

export type Database = {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string
          name: string
          wallet_address: string | null
          api_key: string | null
          api_secret: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          wallet_address?: string | null
          api_key?: string | null
          api_secret?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          wallet_address?: string | null
          api_key?: string | null
          api_secret?: string | null
          created_at?: string
        }
      }
      accounting_users: {
        Row: {
          id: string
          email: string | null
          role: 'admin' | 'user'
          client_id: string | null
          created_at: string
        }
        Insert: {
          id: string
          email?: string | null
          role?: 'admin' | 'user'
          client_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          role?: 'admin' | 'user'
          client_id?: string | null
          created_at?: string
        }
      }
      deposits: {
        Row: {
          id: string
          user_id: string
          client_id: string
          amount: number
          deposit_date: string
          interest_rate: number
          current_value: number | null
          interest_accrued: number
          last_compounded_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          client_id?: string
          amount: number
          deposit_date: string
          interest_rate?: number
          current_value?: number | null
          interest_accrued?: number
          last_compounded_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          client_id?: string
          amount?: number
          deposit_date?: string
          interest_rate?: number
          current_value?: number | null
          interest_accrued?: number
          last_compounded_at?: string | null
          created_at?: string
        }
      }
      deposit_interest_accruals: {
        Row: {
          id: string
          deposit_id: string
          client_id: string
          week_number: number
          period_start: string
          period_end: string
          accrual_date: string
          interest_rate: number
          principal_base: number
          opening_value: number
          interest_amount: number
          closing_value: number
          created_at: string
        }
        Insert: {
          id?: string
          deposit_id: string
          client_id: string
          week_number: number
          period_start: string
          period_end: string
          accrual_date: string
          interest_rate: number
          principal_base: number
          opening_value: number
          interest_amount: number
          closing_value: number
          created_at?: string
        }
        Update: {
          id?: string
          deposit_id?: string
          client_id?: string
          week_number?: number
          period_start?: string
          period_end?: string
          accrual_date?: string
          interest_rate?: number
          principal_base?: number
          opening_value?: number
          interest_amount?: number
          closing_value?: number
          created_at?: string
        }
      }
      closures: {
        Row: {
          id: string
          deposit_id: string
          user_id: string
          client_id: string
          principal: number
          interest_redeemed: number
          total_payout: number
          weeks_elapsed: number
          closure_date: string
          created_at: string
        }
        Insert: {
          id?: string
          deposit_id: string
          user_id: string
          client_id?: string
          principal: number
          interest_redeemed: number
          total_payout: number
          weeks_elapsed: number
          closure_date: string
          created_at?: string
        }
        Update: {
          id?: string
          deposit_id?: string
          user_id?: string
          client_id?: string
          principal?: number
          interest_redeemed?: number
          total_payout?: number
          weeks_elapsed?: number
          closure_date?: string
          created_at?: string
        }
      }
      withdrawals: {
        Row: {
          id: string
          client_id: string
          user_id: string
          amount: number
          interest_paid: number
          total_payout: number
          withdrawal_date: string
          status: 'pending' | 'approved' | 'rejected'
          tx_hash: string | null
          wallet_address: string | null
          approved_by: string | null
          approved_at: string | null
          rejected_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          user_id: string
          amount: number
          interest_paid?: number
          total_payout: number
          withdrawal_date: string
          status?: 'pending' | 'approved' | 'rejected'
          tx_hash?: string | null
          wallet_address?: string | null
          approved_by?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          user_id?: string
          amount?: number
          interest_paid?: number
          total_payout?: number
          withdrawal_date?: string
          status?: 'pending' | 'approved' | 'rejected'
          tx_hash?: string | null
          wallet_address?: string | null
          approved_by?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
          created_at?: string
        }
      }
      withdrawal_allocations: {
        Row: {
          id: string
          withdrawal_id: string
          deposit_id: string
          principal_withdrawn: number
          interest_withdrawn: number
          weeks_elapsed: number
          created_at: string
        }
        Insert: {
          id?: string
          withdrawal_id: string
          deposit_id: string
          principal_withdrawn: number
          interest_withdrawn?: number
          weeks_elapsed?: number
          created_at?: string
        }
        Update: {
          id?: string
          withdrawal_id?: string
          deposit_id?: string
          principal_withdrawn?: number
          interest_withdrawn?: number
          weeks_elapsed?: number
          created_at?: string
        }
      }
    }
  }
}

export type Client = Database['public']['Tables']['clients']['Row']
export type AccountingUser = Database['public']['Tables']['accounting_users']['Row']
export type Deposit = Database['public']['Tables']['deposits']['Row']
export type Closure = Database['public']['Tables']['closures']['Row']
export type Withdrawal = Database['public']['Tables']['withdrawals']['Row']
export type WithdrawalAllocation = Database['public']['Tables']['withdrawal_allocations']['Row']
/** One weekly interest-accrual ledger row for a deposit (the per-week trail). */
export type DepositInterestAccrual = Database['public']['Tables']['deposit_interest_accruals']['Row']

/** A deposit row with its joined company (from `select('*, clients(name)')`). */
export type DepositWithClient = Deposit & { clients: { name: string } | null }
/** A closure row with its joined company. */
export type ClosureWithClient = Closure & { clients: { name: string } | null }
/** A withdrawal row with its joined company. */
export type WithdrawalWithClient = Withdrawal & { clients: { name: string } | null }
/** An accounting user row with its joined company. */
export type AccountingUserWithClient = AccountingUser & { clients: { name: string } | null }
