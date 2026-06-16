import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase-admin'
import { ALTURA_CLIENT_ID } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/users
 * Lists all profiles with their company name (service role — does not depend on
 * the shared profiles table's RLS). Admin only.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { data, error } = await auth.admin
    .from('accounting_users')
    .select('id, email, role, client_id, clients(name)')
    .order('email', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ users: data ?? [] })
}

/**
 * POST /api/admin/users
 * Creates an auth user (service role) and sets their profile role + company.
 * Admin only.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { admin } = auth

  let body: {
    email?: string
    password?: string
    role?: 'admin' | 'user'
    client_id?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  const role = body.role === 'admin' ? 'admin' : 'user'
  const clientId = body.client_id ?? ALTURA_CLIENT_ID

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
  }

  // Create the auth user (auto-confirmed so they can log in immediately).
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !created.user) {
    return NextResponse.json(
      { error: createError?.message ?? 'Failed to create user.' },
      { status: 400 }
    )
  }

  // Record the accounting-app role + company for the new auth user.
  const { error: profileError } = await admin
    .from('accounting_users')
    .upsert({ id: created.user.id, email, role, client_id: clientId })

  if (profileError) {
    // Roll back the auth user so we don't leave an account without a record.
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({
    user: { id: created.user.id, email, role, client_id: clientId },
  })
}
