import type { ApiSettings, DomSettings } from '../types'

const DOM_KEY = 'scalp-dom-settings'
const API_KEY = 'scalp-api-settings'

export function formatVolume(
  qty: number,
  settings: Pick<DomSettings, 'volumeDecimals' | 'shortenThousands'>,
): string {
  if (settings.shortenThousands) {
    if (qty >= 1_000_000) return `${(qty / 1_000_000).toFixed(2)}M`
    if (qty >= 1_000) return `${(qty / 1_000).toFixed(2)}K`
  }
  return qty.toFixed(settings.volumeDecimals)
}

export function formatPrice(price: number, tickSize: number): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(tickSize)))
  return price.toFixed(decimals)
}

export function aggregateLevels(
  levels: { price: number; qty: number }[],
  step: number,
  side: 'bid' | 'ask',
): { price: number; qty: number }[] {
  if (step <= 0) return levels
  const map = new Map<number, number>()

  for (const { price, qty } of levels) {
    const bucket =
      side === 'bid'
        ? Math.floor(price / step) * step
        : Math.ceil(price / step) * step
    const key = Number(bucket.toFixed(10))
    map.set(key, (map.get(key) ?? 0) + qty)
  }

  const sorted = [...map.entries()].map(([price, qty]) => ({ price, qty }))
  sorted.sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price))
  return sorted
}

export function loadSettings(): DomSettings | null {
  try {
    const raw = localStorage.getItem(DOM_KEY)
    if (!raw) return null
    return JSON.parse(raw) as DomSettings
  } catch {
    return null
  }
}

export function saveSettings(settings: DomSettings) {
  localStorage.setItem(DOM_KEY, JSON.stringify(settings))
}

export function loadApiSettings(): ApiSettings | null {
  try {
    const raw = localStorage.getItem(API_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ApiSettings
  } catch {
    return null
  }
}

export function saveApiSettings(settings: ApiSettings) {
  localStorage.setItem(API_KEY, JSON.stringify(settings))
}

export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}
