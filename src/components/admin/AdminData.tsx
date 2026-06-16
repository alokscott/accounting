'use client'

import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import {
  createClient,
  type Client,
  type DepositWithClient,
  type ClosureWithClient,
  type WithdrawalWithClient,
  type WithdrawalAllocation,
} from '@/lib/supabase'

export interface AdminUser {
  id: string
  email: string | null
  role: 'admin' | 'user'
  client_id: string | null
  clients: { name: string } | null
}

interface AdminDataValue {
  clients: Client[]
  users: AdminUser[]
  deposits: DepositWithClient[]
  closures: ClosureWithClient[]
  withdrawals: WithdrawalWithClient[]
  withdrawalAllocations: WithdrawalAllocation[]
  loading: boolean
  refresh: () => Promise<void>
  authHeader: () => Promise<HeadersInit>
}

const AdminDataContext = createContext<AdminDataValue | null>(null)

export function useAdminData(): AdminDataValue {
  const value = useContext(AdminDataContext)
  if (!value) throw new Error('useAdminData must be used inside <AdminDataProvider>')
  return value
}

export function AdminDataProvider({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [clients, setClients] = useState<Client[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [deposits, setDeposits] = useState<DepositWithClient[]>([])
  const [closures, setClosures] = useState<ClosureWithClient[]>([])
  const [withdrawals, setWithdrawals] = useState<WithdrawalWithClient[]>([])
  const [withdrawalAllocations, setWithdrawalAllocations] = useState<WithdrawalAllocation[]>([])
  const [loading, setLoading] = useState(true)

  const authHeader = useCallback(async (): Promise<HeadersInit> => {
    const { data: { session } } = await supabase.auth.getSession()
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    }
  }, [supabase])

  const refresh = useCallback(async () => {
    const headers = await authHeader()
    const [clientsRes, depositsRes, closuresRes, withdrawalsRes, allocationsRes, usersRes] = await Promise.all([
      supabase.from('clients').select('*').order('name', { ascending: true }),
      supabase.from('deposits').select('*, clients(name)').order('deposit_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('closures').select('*, clients(name)').order('closure_date', { ascending: false }),
      supabase.from('withdrawals').select('*, clients(name)').order('withdrawal_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('withdrawal_allocations').select('*'),
      fetch('/api/admin/users', { headers }),
    ])

    setClients((clientsRes.data as Client[]) ?? [])
    setDeposits((depositsRes.data as DepositWithClient[]) ?? [])
    setClosures((closuresRes.data as ClosureWithClient[]) ?? [])
    setWithdrawals((withdrawalsRes.data as WithdrawalWithClient[]) ?? [])
    setWithdrawalAllocations((allocationsRes.data as WithdrawalAllocation[]) ?? [])

    const usersJson = await usersRes.json().catch(() => ({}))
    setUsers(usersRes.ok ? ((usersJson.users as AdminUser[]) ?? []) : [])
    setLoading(false)
  }, [supabase, authHeader])

  // Load admin data once on mount (and when refresh identity changes).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [refresh])

  return (
    <AdminDataContext.Provider value={{ clients, users, deposits, closures, withdrawals, withdrawalAllocations, loading, refresh, authHeader }}>
      {children}
    </AdminDataContext.Provider>
  )
}
