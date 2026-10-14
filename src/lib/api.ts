import type { ApiSettings, ExchangeId } from '../types'

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, '')
}

export type ApiTestResult = {
  ok: boolean
  latencyMs: number
  message: string
  serverTime?: number
}

/** Проверка публичного REST (время сервера) */
export async function testPublicApi(api: ApiSettings): Promise<ApiTestResult> {
  const started = performance.now()
  try {
    const url = publicTimeUrl(api)
    const res = await fetch(url)
    const latencyMs = Math.round(performance.now() - started)
    if (!res.ok) {
      return { ok: false, latencyMs, message: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as Record<string, unknown>
    const serverTime = Number(data.serverTime ?? data.time ?? Date.now())
    return {
      ok: true,
      latencyMs,
      serverTime,
      message: `OK · ${latencyMs} мс · время сервера ${new Date(serverTime).toLocaleTimeString()}`,
    }
  } catch (e) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      message: e instanceof Error ? e.message : 'Ошибка сети',
    }
  }
}

/** Проверка ключей (signed ping / account) — только Binance-семейство */
export async function testSignedApi(api: ApiSettings): Promise<ApiTestResult> {
  if (!api.apiKey || !api.apiSecret) {
    return { ok: false, latencyMs: 0, message: 'Укажите API Key и Secret' }
  }
  if (api.exchange === 'bybit') {
    return {
      ok: false,
      latencyMs: 0,
      message: 'Подписанный тест для Bybit пока не реализован — используйте публичный',
    }
  }

  const started = performance.now()
  try {
    const timestamp = Date.now()
    const query = `timestamp=${timestamp}`
    const signature = await hmacSha256Hex(api.apiSecret, query)
    const path =
      api.exchange === 'binance-futures' || api.market === 'futures'
        ? '/fapi/v2/account'
        : '/api/v3/account'
    const url = `${trimSlash(api.restBaseUrl)}${path}?${query}&signature=${signature}`
    const res = await fetch(url, {
      headers: { 'X-MBX-APIKEY': api.apiKey },
    })
    const latencyMs = Math.round(performance.now() - started)
    if (!res.ok) {
      const body = await res.text()
      return {
        ok: false,
        latencyMs,
        message: `HTTP ${res.status}: ${body.slice(0, 120)}`,
      }
    }
    return {
      ok: true,
      latencyMs,
      message: `Ключи валидны · ${latencyMs} мс`,
    }
  } catch (e) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      message: e instanceof Error ? e.message : 'Ошибка подписи',
    }
  }
}

function publicTimeUrl(api: ApiSettings): string {
  const base = trimSlash(api.restBaseUrl)
  switch (api.exchange as ExchangeId) {
    case 'binance-futures':
      return `${base}/fapi/v1/time`
    case 'bybit':
      return `${base}/v5/market/time`
    case 'binance':
    default:
      return api.market === 'futures' ? `${base}/fapi/v1/time` : `${base}/api/v3/time`
  }
}

export function depthRestUrl(api: ApiSettings, symbol: string): string {
  const base = trimSlash(api.restBaseUrl)
  const sym = symbol.toUpperCase()
  const limit = api.depthLimit

  if (api.exchange === 'bybit') {
    return `${base}/v5/market/orderbook?category=spot&symbol=${sym}&limit=${Math.min(limit, 200)}`
  }
  if (api.exchange === 'binance-futures' || api.market === 'futures') {
    return `${base}/fapi/v1/depth?symbol=${sym}&limit=${limit}`
  }
  return `${base}/api/v3/depth?symbol=${sym}&limit=${limit}`
}

export function depthWsUrl(api: ApiSettings, symbol: string): string {
  const base = trimSlash(api.wsBaseUrl)
  const sym = symbol.toLowerCase()

  if (api.exchange === 'bybit') {
    return `${base}/v5/public/spot`
  }
  if (api.exchange === 'binance-futures' || api.market === 'futures') {
    return `${base}/ws/${sym}@depth@${api.depthSpeed}`
  }
  return `${base}/ws/${sym}@depth@${api.depthSpeed}`
}

export function resolveSymbol(api: ApiSettings, selected: string): string {
  const custom = api.customSymbol.trim()
  return custom || selected
}
