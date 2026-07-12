import { timingSafeEqual } from 'node:crypto'

export class ResearchWorkerAuthError extends Error {
  constructor(
    readonly code: 'DURABLE_DB_REQUIRED' | 'WORKER_UNAUTHORIZED',
    readonly status: 401 | 503,
  ) {
    super(code)
    this.name = 'ResearchWorkerAuthError'
  }
}

export function assertResearchWorkerAuthRuntimeReady(env: Record<string, string | undefined> = process.env) {
  const secret = env.ARC_RESEARCH_WORKER_AUTH_SECRET?.trim()
  if (!secret || secret.length < 32) {
    throw new ResearchWorkerAuthError('DURABLE_DB_REQUIRED', 503)
  }
  return secret
}

export function requireResearchWorkerAuth(req: Request, env: Record<string, string | undefined> = process.env) {
  const secret = assertResearchWorkerAuthRuntimeReady(env)
  const authorization = req.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match || !safeEqual(match[1].trim(), secret)) {
    throw new ResearchWorkerAuthError('WORKER_UNAUTHORIZED', 401)
  }
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  if (leftBytes.length !== rightBytes.length) return false
  return timingSafeEqual(leftBytes, rightBytes)
}
