import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/users/[id]
 * Updates a user's role and/or company assignment. Admin only.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params
  let body: { role?: 'admin' | 'user'; client_id?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const update: { role?: 'admin' | 'user'; client_id?: string | null } = {}
  if (body.role === 'admin' || body.role === 'user') update.role = body.role
  if ('client_id' in body) update.client_id = body.client_id

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  if (id === auth.userId && update.role === 'user') {
    return NextResponse.json({ error: 'You cannot remove your own admin role.' }, { status: 400 })
  }

  const { error } = await auth.admin.from('accounting_users').update(update).eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}

/**
 * DELETE /api/admin/users/[id]
 * Removes an auth user (profile cascades via FK). Admin only.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params

  if (id === auth.userId) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
  }

  const { error } = await auth.admin.auth.admin.deleteUser(id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
