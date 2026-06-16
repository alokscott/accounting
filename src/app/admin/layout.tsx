'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useProfile } from '@/lib/useProfile'
import AuthGuard from '@/components/AuthGuard'
import { AdminDataProvider, useAdminData } from '@/components/admin/AdminData'

const NAV = [
  {
    href: '/admin',
    label: 'Overview',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
  {
    href: '/admin/companies',
    label: 'Companies',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  },
  {
    href: '/admin/users',
    label: 'Users',
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  },
  {
    href: '/admin/deposits',
    label: 'Deposits',
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    href: '/admin/withdrawals',
    label: 'Withdrawals',
    icon: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3',
  },
]

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { profile } = useProfile()
  const { withdrawals } = useAdminData()
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending').length

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  return (
    <>
      {/* Backdrop — mobile only, when the drawer is open */}
      {open && (
        <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={onClose} aria-hidden />
      )}
      <aside
        className={`fixed inset-y-0 left-0 w-60 bg-card border-r border-border flex flex-col z-40 transform transition-transform duration-200 ease-out lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      {/* Brand */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/inessa-logo.svg" alt="Inessa Holdings" className="h-5 w-auto" />
        <p className="text-xs text-muted leading-tight">Admin</p>
        {/* Close — mobile only */}
        <button onClick={onClose} className="ml-auto lg:hidden p-1 text-muted hover:text-foreground" aria-label="Close menu">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              isActive(item.href)
                ? 'bg-accent-muted text-accent font-medium'
                : 'text-muted hover:text-foreground hover:bg-card-hover'
            }`}
          >
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
            </svg>
            {item.label}
            {item.href === '/admin/withdrawals' && pendingWithdrawals > 0 && (
              <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-xs font-semibold rounded-full bg-accent text-black">
                {pendingWithdrawals}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border space-y-1">
        <div className="px-3 pt-2">
          <p className="text-xs text-muted truncate" title={profile?.email ?? ''}>{profile?.email}</p>
          <button
            onClick={handleSignOut}
            className="mt-2 w-full btn btn-secondary text-sm py-2"
          >
            Sign Out
          </button>
        </div>
      </div>
      </aside>
    </>
  )
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAdmin, loading } = useProfile()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!loading && !isAdmin) router.replace('/dashboard')
  }, [loading, isAdmin, router])

  // Auto-close the mobile drawer on navigation.
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  if (loading || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <AdminDataProvider>
      <div className="min-h-screen">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Mobile top bar with hamburger — hidden on lg where the sidebar is static */}
        <div className="lg:hidden sticky top-0 z-20 h-14 flex items-center gap-3 px-4 bg-card/80 backdrop-blur-sm border-b border-border">
          <button onClick={() => setSidebarOpen(true)} className="p-1 -ml-1 text-muted hover:text-foreground" aria-label="Open menu">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/inessa-logo.svg" alt="Inessa Holdings" className="h-5 w-auto" />
          <span className="text-xs text-muted">Admin</span>
        </div>

        <main className="lg:pl-60">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">{children}</div>
        </main>
      </div>
    </AdminDataProvider>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AdminShell>{children}</AdminShell>
    </AuthGuard>
  )
}
