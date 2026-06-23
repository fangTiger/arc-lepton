'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

type SessionResponse = { user: { address: string } | null }

const SESSION_QUERY_KEY = ['auth', 'session'] as const

async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch('/api/auth/session', { credentials: 'include' })
  if (!res.ok) return { user: null }
  return res.json()
}

export function useUser() {
  const { data, isLoading } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 60_000,
  })
  return {
    address: data?.user?.address ?? null,
    isAuthed: !!data?.user,
    isLoading,
  }
}

export function useInvalidateSession() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
}
