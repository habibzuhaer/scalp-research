export type SymbolId = 'btcusdt' | 'ethusdt' | 'solusdt' | 'bnbusdt'

export type ExchangeId = 'binance' | 'binance-futures' | 'bybit'

export interface OrderLevel {
  price: number
  qty: number
}

export interface OrderBookSnapshot {
  bids: OrderLevel[]
  asks: OrderLevel[]
  lastUpdateId: number
}

export interface ApiSettings {
  exchange: ExchangeId
  /** spot | futures */
  market: 'spot' | 'futures'
  testnet: boolean
  restBaseUrl: string
  wsBaseUrl: string
  apiKey: string
  apiSecret: string
  /** Глубина REST snapshot */
  depthLimit: number
  /** Интервал WS diff: 100ms | 1000ms */
  depthSpeed: '100ms' | '1000ms'
  /** Только просмотр (без ключей) */
  viewOnly: boolean
  /** Произвольный символ (если не из списка) */
  customSymbol: string
}

export interface DomSettings {
  priceStepMultiplier: number
  volumeDecimals: number
  shortenThousands: boolean
  autoScroll: boolean
  showRuler: boolean
  rulerMode: 'percent' | 'points'
  highlightLarge: boolean
  largeVolumeThreshold: number
  levelsPerSide: number
  throwDistance: number
  stopLoss: number
  takeProfit: number
  pnlMode: 'percent' | 'usdt'
  workVolumes: number[]
  activeVolumeIndex: number
  volumeUnit: 'lots' | 'usd'
  rowHeight: number
  fontSize: number
  theme: 'dark' | 'classic'
}

export const EXCHANGE_PRESETS: Record<
  ExchangeId,
  {
    label: string
    market: 'spot' | 'futures'
    rest: string
    ws: string
    testnetRest: string
    testnetWs: string
  }
> = {
  binance: {
    label: 'Binance Spot',
    market: 'spot',
    rest: 'https://api.binance.com',
    ws: 'wss://stream.binance.com:9443',
    testnetRest: 'https://testnet.binance.vision',
    testnetWs: 'wss://stream.testnet.binance.vision',
  },
  'binance-futures': {
    label: 'Binance Futures USD-M',
    market: 'futures',
    rest: 'https://fapi.binance.com',
    ws: 'wss://fstream.binance.com',
    testnetRest: 'https://testnet.binancefuture.com',
    testnetWs: 'wss://stream.binancefuture.com',
  },
  bybit: {
    label: 'Bybit Spot',
    market: 'spot',
    rest: 'https://api.bybit.com',
    ws: 'wss://stream.bybit.com',
    testnetRest: 'https://api-testnet.bybit.com',
    testnetWs: 'wss://stream-testnet.bybit.com',
  },
}

export const DEFAULT_API: ApiSettings = {
  exchange: 'binance',
  market: 'spot',
  testnet: false,
  restBaseUrl: EXCHANGE_PRESETS.binance.rest,
  wsBaseUrl: EXCHANGE_PRESETS.binance.ws,
  apiKey: '',
  apiSecret: '',
  depthLimit: 1000,
  depthSpeed: '100ms',
  viewOnly: true,
  customSymbol: '',
}

export const DEFAULT_SETTINGS: DomSettings = {
  priceStepMultiplier: 1,
  volumeDecimals: 3,
  shortenThousands: true,
  autoScroll: true,
  showRuler: true,
  rulerMode: 'percent',
  highlightLarge: true,
  largeVolumeThreshold: 5,
  levelsPerSide: 24,
  throwDistance: 10,
  stopLoss: 0,
  takeProfit: 0,
  pnlMode: 'percent',
  workVolumes: [0.001, 0.01, 0.05, 0.1, 0.5],
  activeVolumeIndex: 1,
  volumeUnit: 'lots',
  rowHeight: 22,
  fontSize: 12,
  theme: 'dark',
}

export const SYMBOLS: { id: SymbolId; label: string; tickSize: number }[] = [
  { id: 'btcusdt', label: 'BTCUSDT', tickSize: 0.1 },
  { id: 'ethusdt', label: 'ETHUSDT', tickSize: 0.01 },
  { id: 'solusdt', label: 'SOLUSDT', tickSize: 0.01 },
  { id: 'bnbusdt', label: 'BNBUSDT', tickSize: 0.01 },
]

export function applyExchangePreset(
  exchange: ExchangeId,
  testnet: boolean,
): Pick<ApiSettings, 'exchange' | 'market' | 'testnet' | 'restBaseUrl' | 'wsBaseUrl'> {
  const p = EXCHANGE_PRESETS[exchange]
  return {
    exchange,
    market: p.market,
    testnet,
    restBaseUrl: testnet ? p.testnetRest : p.rest,
    wsBaseUrl: testnet ? p.testnetWs : p.ws,
  }
}
