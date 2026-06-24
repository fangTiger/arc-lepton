'use client'

import { useEffect, useState } from 'react'
import { ARC_CHAIN_ID } from '@/lib/constants'

function formatUtcTime(date: Date) {
  return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}:${date
    .getUTCSeconds()
    .toString()
    .padStart(2, '0')} UTC`
}

function formatBlock(block: number) {
  return `#${block.toLocaleString('en-US')}`
}

export function TopBar() {
  const [time, setTime] = useState('--:--:-- UTC')
  const [block, setBlock] = useState(1_247_891)
  const displayChainId = ARC_CHAIN_ID || 5_042_002

  useEffect(() => {
    setTime(formatUtcTime(new Date()))
    const timer = window.setInterval(() => {
      setTime(formatUtcTime(new Date()))
      setBlock((current) => current + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="fixed left-0 right-0 top-0 z-[100] flex h-8 items-center overflow-hidden border-b border-border bg-bg-base px-2 font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-amber md:px-4">
      <div className="flex min-w-max items-center gap-2">
        <span className="text-amber">ARC│LEPTON</span>
        <span className="text-text-muted">·</span>
        <span>TIME: {time}</span>
        <span className="text-text-muted">·</span>
        <span>BLOCK: {formatBlock(block)}</span>
        <span className="text-text-muted">·</span>
        <span>CHAIN: ARC-TESTNET ({displayChainId})</span>
        <span className="text-text-muted">·</span>
        <span>USDC: $1.0001</span>
      </div>
    </div>
  )
}
