import type { AgentEvent } from './research-agent'

type Subscriber = {
  onEvent: (event: AgentEvent) => void
  onDone?: () => void
}

type ResearchEventState = {
  events: AgentEvent[]
  subscribers: Set<Subscriber>
  done: boolean
  abortController: AbortController
  cleanupTimer?: ReturnType<typeof setTimeout>
}

const EVENT_TTL_MS = 30 * 60 * 1000

const eventBusGlobal = globalThis as typeof globalThis & {
  __arcLeptonResearchEventBus?: Map<string, ResearchEventState>
}

function states() {
  eventBusGlobal.__arcLeptonResearchEventBus ??= new Map()
  return eventBusGlobal.__arcLeptonResearchEventBus
}

function getState(researchId: string) {
  const map = states()
  let state = map.get(researchId)
  if (!state) {
    state = {
      events: [],
      subscribers: new Set(),
      done: false,
      abortController: new AbortController(),
    }
    map.set(researchId, state)
  }
  return state
}

function scheduleCleanup(researchId: string, state: ResearchEventState) {
  if (state.cleanupTimer) clearTimeout(state.cleanupTimer)
  state.cleanupTimer = setTimeout(() => {
    states().delete(researchId)
  }, EVENT_TTL_MS)
  state.cleanupTimer.unref?.()
}

export function publishResearchEvent(researchId: string, event: AgentEvent) {
  const state = getState(researchId)
  state.events.push(event)
  for (const subscriber of state.subscribers) subscriber.onEvent(event)
}

export function markResearchDone(researchId: string) {
  const state = getState(researchId)
  state.done = true
  for (const subscriber of state.subscribers) subscriber.onDone?.()
  state.subscribers.clear()
  scheduleCleanup(researchId, state)
}

export function getResearchEvents(researchId: string) {
  const state = getState(researchId)
  return { events: [...state.events], done: state.done }
}

export function subscribeResearchEvents(researchId: string, subscriber: Subscriber) {
  const state = getState(researchId)
  state.subscribers.add(subscriber)

  return () => {
    state.subscribers.delete(subscriber)
  }
}

export function getResearchAbortController(researchId: string) {
  return getState(researchId).abortController
}

export function abortResearch(researchId: string) {
  getState(researchId).abortController.abort()
}
