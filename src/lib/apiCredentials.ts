import { createClient } from '@/lib/supabase'

export interface ApiCredentialPair {
  api_key: string
  api_secret: string
}

/**
 * Regenerate a company's API key + secret (admin or a member of that company).
 * Returns the freshly generated pair; the old credentials stop working at once.
 */
export async function regenerateApiCredentials(clientId: string): Promise<ApiCredentialPair> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('regenerate_company_api_credentials', {
    p_client_id: clientId,
  })
  if (error) {
    const detail = [error.message, error.hint].filter(Boolean).join(' — ')
    throw new Error(detail || 'Failed to regenerate API credentials')
  }
  // RETURNS TABLE → array of rows.
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.api_key || !row?.api_secret) throw new Error('Regeneration returned no credentials')
  return { api_key: row.api_key, api_secret: row.api_secret }
}
