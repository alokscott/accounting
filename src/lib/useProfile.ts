'use client'

import { useEffect, useState } from 'react'
import { createClient, type AccountingUserWithClient } from '@/lib/supabase'

interface UseProfileResult {
  profile: AccountingUserWithClient | null
  loading: boolean
  isAdmin: boolean
}

/**
 * Loads the signed-in user's profile (role + assigned company). Returns
 * `isAdmin` and the joined company name for convenience.
 */
export function useProfile(): UseProfileResult {
  const [profile, setProfile] = useState<AccountingUserWithClient | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let active = true

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (active) {
          setProfile(null)
          setLoading(false)
        }
        return
      }

      const { data } = await supabase
        .from('accounting_users')
        .select('*, clients(name)')
        .eq('id', user.id)
        .maybeSingle()

      if (active) {
        setProfile((data as AccountingUserWithClient) ?? null)
        setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [])

  return { profile, loading, isAdmin: profile?.role === 'admin' }
}
