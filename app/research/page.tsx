import { Suspense } from 'react'
import { ResearchPageClient } from './ResearchPageClient'

export default function ResearchPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-bg-base px-6 pt-12 font-mono text-amber">&gt; LOADING RESEARCH TERMINAL_</main>}>
      <ResearchPageClient />
    </Suspense>
  )
}
