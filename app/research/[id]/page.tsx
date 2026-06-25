import { ResearchDetailClient } from './ResearchDetailClient'

export default function ResearchDetailPage({ params }: { params: { id: string } }) {
  return <ResearchDetailClient id={params.id} />
}
