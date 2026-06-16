'use client'

import { useState } from 'react'
import { regenerateApiCredentials } from '@/lib/apiCredentials'

interface ApiCredentialsProps {
  clientId: string
  apiKey: string | null
  apiSecret: string | null
  /** Called after a successful regenerate so the parent can refresh its data. */
  onRegenerated?: () => void
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (non-HTTPS) — ignore.
    }
  }
  return (
    <button type="button" onClick={copy} className="btn btn-secondary text-xs py-1.5 px-3 whitespace-nowrap" title={`Copy ${label}`}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

export default function ApiCredentials({ clientId, apiKey, apiSecret, onRegenerated }: ApiCredentialsProps) {
  const [key, setKey] = useState(apiKey ?? '')
  const [secret, setSecret] = useState(apiSecret ?? '')
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const endpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/transactions` : '/api/transactions'

  const regenerate = async () => {
    if (!confirm('Regenerate API credentials? The current key and secret will stop working immediately.')) return
    setBusy(true)
    setError(null)
    try {
      const creds = await regenerateApiCredentials(clientId)
      setKey(creds.api_key)
      setSecret(creds.api_secret)
      setRevealed(true)
      onRegenerated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
    } finally {
      setBusy(false)
    }
  }

  const maskedSecret = secret ? `${secret.slice(0, 6)}${'•'.repeat(Math.max(0, secret.length - 6))}` : ''

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-muted mb-2">API key</label>
        <div className="flex items-center gap-2">
          <code className="input font-mono text-sm break-all flex-1">{key || '—'}</code>
          {key && <CopyButton value={key} label="API key" />}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted mb-2">API secret</label>
        <div className="flex items-center gap-2">
          <code className="input font-mono text-sm break-all flex-1">{revealed ? (secret || '—') : (maskedSecret || '—')}</code>
          {secret && (
            <button type="button" onClick={() => setRevealed((r) => !r)} className="btn btn-secondary text-xs py-1.5 px-3 whitespace-nowrap">
              {revealed ? 'Hide' : 'Reveal'}
            </button>
          )}
          {secret && <CopyButton value={secret} label="API secret" />}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-danger-muted border border-danger/30 rounded-lg text-danger text-sm">{error}</div>
      )}

      {/* Usage */}
      <div className="rounded-lg border border-border bg-card-hover/40 p-4">
        <p className="text-sm font-medium mb-2">Fetch your transaction history</p>
        <pre className="text-xs text-muted font-mono whitespace-pre-wrap break-all">
{`curl "${endpoint}" \\
  -H "x-api-key: ${key || '<api-key>'}" \\
  -H "x-api-secret: <api-secret>"`}
        </pre>
        <p className="mt-2 text-xs text-muted">
          Returns this company&apos;s deposits, withdrawals and closed positions.
        </p>
      </div>

      <button type="button" onClick={regenerate} disabled={busy} className="btn btn-secondary text-sm disabled:opacity-50">
        {busy ? 'Regenerating…' : 'Regenerate credentials'}
      </button>
    </div>
  )
}
