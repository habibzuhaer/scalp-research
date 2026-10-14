import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiSettings, OrderBookSnapshot, OrderLevel, SymbolId } from '../types'
import { depthRestUrl, depthWsUrl, resolveSymbol } from '../lib/api'

type DiffMsg = {
  U: number
  u: number
  b: [string, string][]
  a: [string, string][]
}

function parseLevels(raw: [string, string][]): OrderLevel[] {
  return raw.map(([p, q]) => ({ price: Number(p), qty: Number(q) }))
}

function applyDiff(book: Map<number, number>, updates: [string, string][]) {
  for (const [ps, qs] of updates) {
    const price = Number(ps)
    const qty = Number(qs)
    if (qty === 0) book.delete(price)
    else book.set(price, qty)
  }
}

function mapToLevels(book: Map<number, number>, side: 'bid' | 'ask'): OrderLevel[] {
  const levels = [...book.entries()].map(([price, qty]) => ({ price, qty }))
  levels.sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price))
  return levels.slice(0, 200)
}

function sanitize(bids: OrderLevel[], asks: OrderLevel[]) {
  if (!bids.length || !asks.length) return { bids, asks }
  const bestBid = bids[0].price
  const bestAsk = asks[0].price
  if (bestBid < bestAsk) return { bids, asks }
  const mid = (bestBid + bestAsk) / 2
  return {
    bids: bids.filter((l) => l.price < mid),
    asks: asks.filter((l) => l.price > mid),
  }
}

function parseRestDepth(
  api: ApiSettings,
  data: unknown,
): { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] } {
  if (api.exchange === 'bybit') {
    const root = data as {
      result?: {
        b?: [string, string][]
        a?: [string, string][]
        u?: number
        ts?: number
      }
    }
    const r = root.result ?? {}
    return {
      lastUpdateId: Number(r.u ?? r.ts ?? Date.now()),
      bids: r.b ?? [],
      asks: r.a ?? [],
    }
  }
  const d = data as {
    lastUpdateId: number
    bids: [string, string][]
    asks: [string, string][]
  }
  return d
}

export function useExchangeDepth(symbol: SymbolId, api: ApiSettings) {
  const [snapshot, setSnapshot] = useState<OrderBookSnapshot>({
    bids: [],
    asks: [],
    lastUpdateId: 0,
  })
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)

  const bidsRef = useRef(new Map<number, number>())
  const asksRef = useRef(new Map<number, number>())
  const lastIdRef = useRef(0)
  const bufferRef = useRef<DiffMsg[]>([])
  const syncedRef = useRef(false)

  // stable key so URL edits reconnect
  const apiKey = [
    api.exchange,
    api.restBaseUrl,
    api.wsBaseUrl,
    api.depthLimit,
    api.depthSpeed,
    api.customSymbol,
    api.testnet,
  ].join('|')

  const publish = useCallback(() => {
    const rawBids = mapToLevels(bidsRef.current, 'bid')
    const rawAsks = mapToLevels(asksRef.current, 'ask')
    const { bids, asks } = sanitize(rawBids, rawAsks)
    setSnapshot({
      bids,
      asks,
      lastUpdateId: lastIdRef.current,
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null
    let raf = 0
    let retryTimer = 0
    const marketSymbol = resolveSymbol(api, symbol)

    const schedulePublish = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (!cancelled) publish()
      })
    }

    const resetLocal = () => {
      bidsRef.current = new Map()
      asksRef.current = new Map()
      lastIdRef.current = 0
      bufferRef.current = []
      syncedRef.current = false
    }

    async function snapshotAndSync() {
      const res = await fetch(depthRestUrl(api, marketSymbol))
      if (!res.ok) throw new Error(`Depth HTTP ${res.status}`)
      const raw = await res.json()
      if (cancelled) return

      const data = parseRestDepth(api, raw)
      bidsRef.current = new Map(parseLevels(data.bids).map((l) => [l.price, l.qty]))
      asksRef.current = new Map(parseLevels(data.asks).map((l) => [l.price, l.qty]))
      lastIdRef.current = data.lastUpdateId

      if (api.exchange === 'bybit') {
        // Bybit: snapshot-only polling fallback (no diff sync in this build)
        syncedRef.current = true
        publish()
        if (!cancelled) setStatus('live')
        return
      }

      const buf = bufferRef.current
      bufferRef.current = []
      const start = buf.findIndex(
        (m) => m.U <= data.lastUpdateId + 1 && m.u >= data.lastUpdateId + 1,
      )
      if (start === -1) {
        bufferRef.current = buf
        syncedRef.current = false
        publish()
        if (!cancelled) setStatus('connecting')
        window.setTimeout(() => {
          if (!cancelled && !syncedRef.current) void snapshotAndSync()
        }, 800)
        return
      }

      for (let i = start; i < buf.length; i++) {
        const msg = buf[i]
        if (msg.u <= lastIdRef.current) continue
        applyDiff(bidsRef.current, msg.b)
        applyDiff(asksRef.current, msg.a)
        lastIdRef.current = msg.u
      }

      syncedRef.current = true
      publish()
      if (!cancelled) setStatus('live')
    }

    async function connect() {
      resetLocal()
      if (!cancelled) {
        setStatus('connecting')
        setError(null)
        setSnapshot({ bids: [], asks: [], lastUpdateId: 0 })
      }

      try {
        if (api.exchange === 'bybit') {
          // poll orderbook for Bybit
          const poll = async () => {
            if (cancelled) return
            try {
              await snapshotAndSync()
            } catch (e) {
              if (!cancelled) {
                setStatus('error')
                setError(e instanceof Error ? e.message : 'Bybit error')
              }
            }
            if (!cancelled) retryTimer = window.setTimeout(poll, 500)
          }
          await poll()
          return
        }

        ws = new WebSocket(depthWsUrl(api, marketSymbol))

        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data as string) as DiffMsg
          if (!syncedRef.current) {
            bufferRef.current.push(msg)
            if (bufferRef.current.length > 500) bufferRef.current.shift()
            return
          }
          if (msg.u <= lastIdRef.current) return
          if (msg.U > lastIdRef.current + 1) {
            syncedRef.current = false
            void snapshotAndSync()
            return
          }
          applyDiff(bidsRef.current, msg.b)
          applyDiff(asksRef.current, msg.a)
          lastIdRef.current = msg.u
          schedulePublish()
        }

        ws.onclose = () => {
          if (cancelled) return
          setStatus('error')
          setError('WebSocket закрыт, переподключение…')
          retryTimer = window.setTimeout(() => {
            if (!cancelled) void connect()
          }, 1500)
        }

        await snapshotAndSync()
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Не удалось подключиться')
        retryTimer = window.setTimeout(() => {
          if (!cancelled) void connect()
        }, 2000)
      }
    }

    void connect()

    return () => {
      cancelled = true
      if (raf) cancelAnimationFrame(raf)
      if (retryTimer) clearTimeout(retryTimer)
      if (ws) {
        ws.onclose = null
        ws.close()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiKey encodes api fields
  }, [symbol, apiKey, publish])

  return { snapshot, status, error }
}

/** @deprecated use useExchangeDepth */
export const useBinanceDepth = useExchangeDepth
