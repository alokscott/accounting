import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client. Bypasses RLS — server-side use ONLY.
 * Never import this from a Client Component.
 */
export function createAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.'
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

type AdminGuardOk = { ok: true; admin: SupabaseClient; userId: string }
type AdminGuardErr = { ok: false; status: 401 | 403 | 500; error: string }

/**
 * Validates the `Authorization: Bearer <access_token>` header against Supabase
 * and confirms the caller has an admin profile. Returns a service-role client
 * on success so the caller can perform privileged operations.
 */
export async function requireAdmin(request: Request): Promise<AdminGuardOk | AdminGuardErr> {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return { ok: false, status: 401, error: 'Missing authorization token.' }
  }

  let admin: SupabaseClient
  try {
    admin = createAdminClient()
  } catch {
    return { ok: false, status: 500, error: 'Server is missing Supabase admin credentials.' }
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) {
    return { ok: false, status: 401, error: 'Invalid or expired session.' }
  }

  const { data: profile } = await admin
    .from('accounting_users')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profile?.role !== 'admin') {
    return { ok: false, status: 403, error: 'Admin access required.' }
  }

  return { ok: true, admin, userId: userData.user.id }
}
