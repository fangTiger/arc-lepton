import {
  InvalidResearchBackendConfigError,
  getResearchBackendConfig,
} from '@/lib/research/backend-config'

export async function GET() {
  try {
    return Response.json(getResearchBackendConfig())
  } catch (error) {
    if (error instanceof InvalidResearchBackendConfigError) {
      return Response.json({ error: error.code }, { status: 500 })
    }
    throw error
  }
}
