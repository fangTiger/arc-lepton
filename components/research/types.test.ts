import { describe, expect, it } from 'vitest'
import type { AgentEvent, TxLogRecord } from './types'
import * as researchTypes from './types'

describe('mergeTxLogIntoEvents', () => {
  it('overlays authoritative settlement status by requestId while preserving tool result context', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_result',
        callId: 'call-news',
        name: 'news',
        payment: {
          amount: '0.0003',
          txHash: null,
          txStatus: 'pending',
          chainId: null,
          blockNumber: null,
          requestId: 'req-news',
        },
        dataPreview: '{"articles":[]}',
      },
      {
        type: 'tool_result',
        callId: 'call-twitter',
        name: 'twitter-signals',
        payment: {
          amount: '0.0001',
          txHash: null,
          txStatus: 'pending',
          chainId: null,
          blockNumber: null,
          requestId: 'req-twitter',
        },
        dataPreview: '{"topTweets":[]}',
      },
      { type: 'final', reportMd: '# Report', totalSpentUsdc: '0.0004', totalCalls: 2 },
    ]
    const txLog: TxLogRecord[] = [
      {
        id: 'tx-news',
        address: '0xabc',
        source: 'news',
        amount: '0.9999',
        txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        txStatus: 'confirmed',
        chainId: 5_042_002,
        blockNumber: '12345',
        settlementId: 'settlement-1',
        requestId: 'req-news',
        errorMessage: null,
        createdAt: '2026-07-03T00:00:00.000Z',
      },
    ]

    expect(researchTypes.mergeTxLogIntoEvents).toBeTypeOf('function')
    const merged = researchTypes.mergeTxLogIntoEvents(events, txLog)

    expect(merged).toHaveLength(events.length)
    expect(merged[0]).toMatchObject({
      type: 'tool_result',
      callId: 'call-news',
      name: 'news',
      dataPreview: '{"articles":[]}',
      payment: {
        amount: '0.0003',
        requestId: 'req-news',
        txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        txStatus: 'confirmed',
        chainId: 5_042_002,
        blockNumber: '12345',
      },
    })
    expect(merged[1]).toEqual(events[1])
    expect(merged[2]).toEqual(events[2])
  })

  it('materializes missing txLog rows as tool_result events without duplicating existing requestIds', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_result',
        callId: 'req-news',
        name: 'news',
        payment: {
          amount: '0.0003',
          txHash: null,
          txStatus: 'pending',
          chainId: null,
          blockNumber: null,
          requestId: 'req-news',
        },
        dataPreview: '{}',
      },
      { type: 'final', reportMd: '# Report', totalSpentUsdc: '0.0005', totalCalls: 2 },
    ]
    const txLog: TxLogRecord[] = [
      {
        id: 'tx-news',
        address: '0xabc',
        source: 'news',
        amount: '0.0003',
        txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        txStatus: 'confirmed',
        chainId: 5_042_002,
        blockNumber: '12345',
        settlementId: 'settlement-1',
        requestId: 'req-news',
        errorMessage: null,
        createdAt: '2026-07-03T00:00:00.000Z',
      },
      {
        id: 'tx-failed',
        address: '0xabc',
        source: 'whale-watch',
        amount: '0.0002',
        txHash: null,
        txStatus: 'failed',
        chainId: null,
        blockNumber: null,
        settlementId: 'settlement-1',
        requestId: 'req-failed',
        errorMessage: 'RPC timeout',
        createdAt: '2026-07-03T00:00:01.000Z',
      },
      {
        id: 'tx-pending-no-request',
        address: '0xabc',
        source: 'twitter-signals',
        amount: '0.0001',
        txHash: null,
        txStatus: 'pending',
        chainId: null,
        blockNumber: null,
        settlementId: null,
        requestId: null,
        errorMessage: null,
        createdAt: '2026-07-03T00:00:02.000Z',
      },
    ]

    const merged = researchTypes.mergeTxLogIntoEvents(events, txLog)

    expect(merged.filter((event) => event.type === 'tool_result')).toHaveLength(3)
    expect(merged.at(-1)).toEqual(events[1])
    expect(merged).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        callId: 'req-news',
        payment: expect.objectContaining({
          requestId: 'req-news',
          txStatus: 'confirmed',
          txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        }),
      }),
      expect.objectContaining({
        type: 'tool_result',
        callId: 'req-failed',
        name: 'whale-watch',
        dataPreview: 'RPC timeout',
        payment: expect.objectContaining({
          amount: '0.0002',
          requestId: 'req-failed',
          txStatus: 'failed',
        }),
      }),
      expect.objectContaining({
        type: 'tool_result',
        callId: 'tx-pending-no-request',
        name: 'twitter-signals',
        dataPreview: '{}',
        payment: expect.objectContaining({
          amount: '0.0001',
          requestId: 'tx-pending-no-request',
          txStatus: 'pending',
        }),
      }),
      events[1],
    ])
  })
})
