import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiSettings, DomSettings, SymbolId } from '../types'
import { EXCHANGE_PRESETS, SYMBOLS } from '../types'
import { aggregateLevels, formatPrice, formatVolume } from '../lib/format'
import { useExchangeDepth } from '../hooks/useBinanceDepth'
import { SettingsPanel } from './SettingsPanel'

interface Props {
  symbol: SymbolId
  onSymbolChange: (s: SymbolId) => void
  settings: DomSettings
  api: ApiSettings
  onSettingsChange: <K extends keyof DomSettings>(key: K, value: DomSettings[K]) => void
  onApiChange: <K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) => void
  onApiPatch: (partial: Partial<ApiSettings>) => void
  onSettingsReset: () => void
  onApiReset: () => void
}

interface LadderRow {
  price: number
  bidQty: number
  askQty: number
  side: 'ask' | 'bid' | 'spread'
}

export function OrderBook({
  symbol,
  onSymbolChange,
  settings,
  api,
  onSettingsChange,
  onApiChange,
  onApiPatch,
  onSettingsReset,
  onApiReset,
}: Props) {
  const meta = SYMBOLS.find((s) => s.id === symbol)!
  const { snapshot, status, error } = useExchangeDepth(symbol, api)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'api' | 'general' | 'dom' | 'trade'>('api')
  const [hoverPrice, setHoverPrice] = useState<number | null>(null)
  const [flash, setFlash] = useState<{ price: number; side: 'buy' | 'sell' } | null>(null)
  const [aggSteps, setAggSteps] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const centeredRef = useRef(false)

  const step = meta.tickSize * settings.priceStepMultiplier * aggSteps

  const { bids, asks, bestBid, bestAsk, mid, maxQty } = useMemo(() => {
    const bidsAgg = aggregateLevels(snapshot.bids, step, 'bid')
    const asksAgg = aggregateLevels(snapshot.asks, step, 'ask')
    const bb = bidsAgg[0]?.price ?? 0
    const ba = asksAgg[0]?.price ?? 0
    const midPrice = bb && ba ? (bb + ba) / 2 : bb || ba
    const max = Math.max(
      1,
      ...bidsAgg.slice(0, settings.levelsPerSide).map((l) => l.qty),
      ...asksAgg.slice(0, settings.levelsPerSide).map((l) => l.qty),
    )
    return {
      bids: bidsAgg,
      asks: asksAgg,
      bestBid: bb,
      bestAsk: ba,
      mid: midPrice,
      maxQty: max,
    }
  }, [snapshot, step, settings.levelsPerSide])

  const rows = useMemo(() => {
    const bidMap = new Map(bids.map((l) => [l.price, l.qty]))
    const askMap = new Map(asks.map((l) => [l.price, l.qty]))
    const n = settings.levelsPerSide

    const askRows: LadderRow[] = asks.slice(0, n).reverse().map((l) => ({
      price: l.price,
      bidQty: 0,
      askQty: l.qty,
      side: 'ask' as const,
    }))

    const bidRows: LadderRow[] = bids.slice(0, n).map((l) => ({
      price: l.price,
      bidQty: l.qty,
      askQty: 0,
      side: 'bid' as const,
    }))

    // if gap / no overlap fill from maps for denser look
    void bidMap
    void askMap

    return [...askRows, ...bidRows]
  }, [bids, asks, settings.levelsPerSide])

  useEffect(() => {
    centeredRef.current = false
  }, [symbol, step])

  useEffect(() => {
    if (!settings.autoScroll || !scrollRef.current || !mid) return
    if (centeredRef.current) return
    const el = scrollRef.current
    const midEl = el.querySelector('[data-spread]') as HTMLElement | null
    if (midEl) {
      const top = midEl.offsetTop - el.clientHeight / 2 + midEl.clientHeight / 2
      el.scrollTop = Math.max(0, top)
      centeredRef.current = true
    }
  }, [rows, settings.autoScroll, mid])

  const workQty = settings.workVolumes[settings.activeVolumeIndex] ?? settings.workVolumes[0]

  const rulerText = (price: number) => {
    if (!settings.showRuler || hoverPrice !== price || !bestBid || !bestAsk) return null
    const ref = price >= bestAsk ? bestAsk : bestBid
    if (settings.rulerMode === 'percent') {
      const pct = ((price - ref) / ref) * 100
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(3)}%`
    }
    const pts = Math.round((price - ref) / meta.tickSize)
    return `${pts >= 0 ? '+' : ''}${pts}`
  }

  const place = (price: number, side: 'buy' | 'sell') => {
    setFlash({ price, side })
    window.setTimeout(() => setFlash(null), 400)
  }

  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0
  const spreadPct = mid ? (spread / mid) * 100 : 0

  return (
    <div
      className={`dom theme-${settings.theme}`}
      style={
        {
          '--row-h': `${settings.rowHeight}px`,
          '--font-size': `${settings.fontSize}px`,
        } as React.CSSProperties
      }
    >
      <header className="dom-header">
        <div className="dom-title">
          <select
            className="symbol-select"
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value as SymbolId)}
          >
            {SYMBOLS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <span className={`status-dot ${status}`} title={error ?? status} />
          <span className="status-label">
            {status === 'live' ? 'LIVE' : status === 'connecting' ? '…' : 'ERR'}
          </span>
          <span className="exchange-pill">
            {EXCHANGE_PRESETS[api.exchange].label}
            {api.testnet ? ' · testnet' : ''}
          </span>
        </div>

        <div className="dom-toolbar">
          <button
            type="button"
            className="tool-btn"
            title="Разобрать шаг"
            onClick={() => setAggSteps((s) => Math.max(1, Math.floor(s / 2) || 1))}
          >
            −
          </button>
          <span className="step-label" title="Шаг цены">
            {formatPrice(step, Math.min(step, meta.tickSize))}
          </span>
          <button
            type="button"
            className="tool-btn"
            title="Сжать стакан"
            onClick={() => setAggSteps((s) => Math.min(1000, s * 2))}
          >
            +
          </button>
          <button
            type="button"
            className="tool-btn"
            title="К спреду"
            onClick={() => {
              centeredRef.current = false
              const el = scrollRef.current
              const midEl = el?.querySelector('[data-spread]') as HTMLElement | null
              if (el && midEl) {
                el.scrollTop = midEl.offsetTop - el.clientHeight / 2 + midEl.clientHeight / 2
                centeredRef.current = true
              }
            }}
          >
            ⌖
          </button>
          <button
            type="button"
            className="tool-btn"
            title="Настройки"
            onClick={() => {
              setSettingsTab('api')
              setSettingsOpen(true)
            }}
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="dom-meta">
        <span className="ask-tag">ASK {bestAsk ? formatPrice(bestAsk, step) : '—'}</span>
        <span className="spread-tag">
          {spread ? `${formatPrice(spread, step)} · ${spreadPct.toFixed(3)}%` : '—'}
        </span>
        <span className="bid-tag">BID {bestBid ? formatPrice(bestBid, step) : '—'}</span>
      </div>

      <div className="dom-cols">
        <span>Ask</span>
        <span>Цена</span>
        <span>Bid</span>
      </div>

      <div
        className="dom-scroll"
        ref={scrollRef}
        onWheel={(e) => {
          if (e.shiftKey) {
            e.preventDefault()
            if (e.deltaY > 0) setAggSteps((s) => Math.min(1000, s * 2))
            else setAggSteps((s) => Math.max(1, Math.floor(s / 2) || 1))
          }
        }}
      >
        {rows.map((row, i) => {
          const isAsk = row.side === 'ask'
          const qty = isAsk ? row.askQty : row.bidQty
          const width = Math.min(100, (qty / maxQty) * 100)
          const large =
            settings.highlightLarge && qty >= settings.largeVolumeThreshold
          const isBestAsk = isAsk && row.price === bestAsk
          const ruler = rulerText(row.price)
          const flashed = flash?.price === row.price

          return (
            <div key={`${row.side}-${row.price}-${i}`}>
              <div
                className={[
                  'dom-row',
                  isAsk ? 'ask' : 'bid',
                  large ? 'large' : '',
                  flashed ? `flash-${flash?.side}` : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ height: settings.rowHeight }}
                onMouseEnter={() => setHoverPrice(row.price)}
                onMouseLeave={() => setHoverPrice(null)}
              >
                <button
                  type="button"
                  className="cell ask-cell"
                  onClick={() => place(row.price, 'sell')}
                  title={`Sell ${workQty}`}
                >
                  <span className="bar ask-bar" style={{ width: `${isAsk ? width : 0}%` }} />
                  <span className="qty">
                    {isAsk && qty > 0 ? formatVolume(qty, settings) : ''}
                  </span>
                </button>

                <button
                  type="button"
                  className="cell price-cell"
                  onClick={() => place(row.price, isAsk ? 'sell' : 'buy')}
                >
                  {formatPrice(row.price, step)}
                  {ruler && <span className="ruler">{ruler}</span>}
                </button>

                <button
                  type="button"
                  className="cell bid-cell"
                  onClick={() => place(row.price, 'buy')}
                  title={`Buy ${workQty}`}
                >
                  <span className="bar bid-bar" style={{ width: `${!isAsk ? width : 0}%` }} />
                  <span className="qty">
                    {!isAsk && qty > 0 ? formatVolume(qty, settings) : ''}
                  </span>
                </button>
              </div>
              {isBestAsk && (
                <div className="spread-row" data-spread>
                  <span>спред</span>
                  <span>
                    {formatPrice(spread, step)} ({spreadPct.toFixed(3)}%)
                  </span>
                </div>
              )}
            </div>
          )
        })}

        {!rows.length && (
          <div className="dom-empty">
            {status === 'error' ? error ?? 'Нет данных' : 'Загрузка стакана…'}
          </div>
        )}
      </div>

      <footer className="dom-footer">
        <div className="volume-slots">
          {settings.workVolumes.map((v, i) => (
            <button
              key={`${v}-${i}`}
              type="button"
              className={i === settings.activeVolumeIndex ? 'active' : ''}
              onClick={() => onSettingsChange('activeVolumeIndex', i)}
              onDoubleClick={() => {
                const next = window.prompt('Объём', String(v))
                if (!next) return
                const n = Number(next)
                if (!Number.isFinite(n) || n <= 0) return
                const vols = [...settings.workVolumes]
                vols[i] = n
                onSettingsChange('workVolumes', vols)
              }}
            >
              {v}
            </button>
          ))}
          <button
            type="button"
            className="unit-btn"
            onClick={() =>
              onSettingsChange(
                'volumeUnit',
                settings.volumeUnit === 'lots' ? 'usd' : 'lots',
              )
            }
            title="Лоты / $"
          >
            {settings.volumeUnit === 'lots' ? 'L' : '$'}
          </button>
        </div>
        <div className="dom-hint">
          клик — заявка · Shift+колёсико — сжатие · ⚙ — настройки
        </div>
      </footer>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          api={api}
          onChange={onSettingsChange}
          onApiChange={onApiChange}
          onApiPatch={onApiPatch}
          onReset={onSettingsReset}
          onApiReset={onApiReset}
          onClose={() => setSettingsOpen(false)}
          initialTab={settingsTab}
        />
      )}
    </div>
  )
}
