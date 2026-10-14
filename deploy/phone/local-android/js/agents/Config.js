/* Defaults + storage helpers */
(function (global) {
  'use strict'

  var EXCHANGE_PRESETS = {
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
    'bybit-futures': {
      label: 'Bybit Linear',
      market: 'futures',
      rest: 'https://api.bybit.com',
      ws: 'wss://stream.bybit.com',
      testnetRest: 'https://api-testnet.bybit.com',
      testnetWs: 'wss://stream-testnet.bybit.com',
    },
  }

  var SPOT_EXCHANGES = ['binance', 'bybit']
  var FUTURES_EXCHANGES = ['binance-futures', 'bybit-futures']

  function makePane(exchange, symbol) {
    var p = EXCHANGE_PRESETS[exchange]
    return {
      exchange: exchange,
      market: p.market,
      symbol: symbol,
      testnet: false,
      restBaseUrl: p.rest,
      wsBaseUrl: p.ws,
      depthLimit: 1000,
      depthSpeed: '100ms',
      aggSteps: 1,
      apiKey: '',
      apiSecret: '',
      viewOnly: true,
    }
  }

  var DEFAULT_TICKERS = {
    linkSymbols: true,
    spot: makePane('bybit', 'btcusdt'),
    futures: makePane('bybit-futures', 'btcusdt'),
  }

  var DEFAULT_API = Object.assign({}, DEFAULT_TICKERS.spot)

  var DEFAULT_DOM = {
    priceStepMultiplier: 1,
    volumeDecimals: 4,
    volumeDecimalsAuto: true,
    volumeGrouping: true,
    shortenThousands: false,
    volumeShowBoth: true,
    autoScroll: true,
    showRuler: true,
    rulerMode: 'percent',
    highlightLarge: true,
    largeVolumeThreshold: 5,
    largeNotionalUsd: 25000,
    wallNotionalUsd: 100000,
    showWallBadge: true,
    levelsPerSide: 24,
    throwDistance: 10,
    stopLoss: 0.5,
    takeProfit: 1,
    takeProfit2: 0,
    attachSlTp: true,
    pnlMode: 'percent',
    workVolumes: [0.001, 0.01, 0.05, 0.1, 0.5],
    activeVolumeIndex: 1,
    volumeUnit: 'lots',
    tradeConfirm: true,
    rowHeight: 24,
    fontSize: 12,
    theme: 'dark',
    // UI стакана
    domChrome: 'full',
    showQuickPanel: false,
    // расширенные настройки стакана
    showSpreadRow: true,
    showVolumeBars: true,
    showEmptyLevels: false,
    cumVolumeMode: false,
    filterMinQty: 0,
    flashUpdates: true,
    stickyCenter: true,
    showMidPrice: true,
    showImbalance: true,
    imbalanceThreshold: 0.65,
    barOpacity: 0.28,
    priceAlign: 'center',
    densifyGaps: false,
    quoteFilter: 'USDT',
    maxSymbolOptions: 400,
    preferUsdtPairs: true,
    // цвета по объёму
    volumeColorMode: 'heat',
    volumeHeatScale: 'sqrt',
    wallHighlight: true,
    wallThreshold: 0.65,
    heatBoost: 1.15,
    askBarHue: 350,
    bidBarHue: 150,
  }

  var SYMBOLS = [
    { id: 'btcusdt', label: 'BTCUSDT', tickSize: 0.1 },
    { id: 'ethusdt', label: 'ETHUSDT', tickSize: 0.01 },
    { id: 'solusdt', label: 'SOLUSDT', tickSize: 0.01 },
    { id: 'bnbusdt', label: 'BNBUSDT', tickSize: 0.01 },
    { id: 'xrpusdt', label: 'XRPUSDT', tickSize: 0.0001 },
    { id: 'dogeusdt', label: 'DOGEUSDT', tickSize: 0.00001 },
  ]

  function applyExchangePreset(exchange, testnet) {
    var p = EXCHANGE_PRESETS[exchange]
    return {
      exchange: exchange,
      market: p.market,
      testnet: !!testnet,
      restBaseUrl: testnet ? p.testnetRest : p.rest,
      wsBaseUrl: testnet ? p.testnetWs : p.ws,
    }
  }

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key)
      if (!raw) return deepMerge(fallback, {})
      return deepMerge(fallback, JSON.parse(raw))
    } catch (e) {
      return deepMerge(fallback, {})
    }
  }

  function deepMerge(base, over) {
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base)
    if (!over || typeof over !== 'object') return out
    Object.keys(over).forEach(function (k) {
      if (
        over[k] &&
        typeof over[k] === 'object' &&
        !Array.isArray(over[k]) &&
        base[k] &&
        typeof base[k] === 'object'
      ) {
        out[k] = deepMerge(base[k], over[k])
      } else if (over[k] !== undefined) {
        out[k] = over[k]
      }
    })
    return out
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value))
  }

  function trimVolZeros(s) {
    if (s.indexOf('.') === -1) return s
    return s.replace(/\.?0+$/, '') || '0'
  }

  function groupThousands(s) {
    var parts = String(s).split('.')
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    return parts.join('.')
  }

  function volumeDecimalsFor(qty, settings) {
    var base = settings.volumeDecimals != null ? settings.volumeDecimals : 4
    if (settings.volumeDecimalsAuto === false) return base
    var a = Math.abs(Number(qty))
    if (!isFinite(a) || a === 0) return base
    if (a >= 1e6) return Math.min(base, 2)
    if (a >= 1e4) return Math.min(base, 3)
    if (a >= 1) return Math.max(base, 3)
    if (a >= 0.01) return Math.max(base, 4)
    if (a >= 0.0001) return Math.max(base, 5)
    return Math.max(base, 6)
  }

  function formatVolume(qty, settings) {
    settings = settings || {}
    var q = Number(qty)
    if (!isFinite(q)) return '—'
    if (q === 0) return '0'
    var decimals = volumeDecimalsFor(q, settings)
    var sign = q < 0 ? '-' : ''
    q = Math.abs(q)

    if (settings.shortenThousands) {
      if (q >= 1e6) {
        return sign + trimVolZeros((q / 1e6).toFixed(Math.max(2, Math.min(decimals, 3)))) + 'M'
      }
      // сокращаем только от 10K, чтобы мелкие уровни оставались точными
      if (q >= 1e4) {
        return sign + trimVolZeros((q / 1e3).toFixed(Math.max(2, Math.min(decimals, 3)))) + 'K'
      }
    }

    var s = q.toFixed(decimals)
    if (settings.volumeDecimalsAuto !== false) s = trimVolZeros(s)
    if (settings.volumeGrouping !== false && q >= 1000) s = groupThousands(s)
    return sign + s
  }

  function formatUsdVolume(usd, settings) {
    settings = settings || {}
    var q = Number(usd)
    if (!isFinite(q) || q === 0) return '$0'
    var sign = q < 0 ? '-' : ''
    q = Math.abs(q)
    if (settings.shortenThousands !== false) {
      if (q >= 1e6) return sign + '$' + trimVolZeros((q / 1e6).toFixed(2)) + 'M'
      if (q >= 1e4) return sign + '$' + trimVolZeros((q / 1e3).toFixed(2)) + 'K'
    }
    if (q >= 1000) return sign + '$' + groupThousands(q.toFixed(0))
    if (q >= 100) return sign + '$' + q.toFixed(1)
    if (q >= 1) return sign + '$' + q.toFixed(2)
    if (q >= 0.01) return sign + '$' + q.toFixed(3)
    return sign + '$' + q.toFixed(4)
  }

  function formatDomVolume(qty, price, settings) {
    settings = settings || {}
    var lots = Number(qty)
    var px = Number(price)
    var usd = isFinite(lots) && isFinite(px) ? lots * px : 0
    var unit = settings.volumeUnit === 'usd' ? 'usd' : 'lots'
    var both = settings.volumeShowBoth !== false
    var main =
      unit === 'usd' ? formatUsdVolume(usd, settings) : formatVolume(lots, settings)
    if (!both) return { main: main, sub: '', html: main }
    var sub =
      unit === 'usd' ? formatVolume(lots, settings) : formatUsdVolume(usd, settings)
    return {
      main: main,
      sub: sub,
      html:
        '<span class="qty-main">' +
        main +
        '</span><span class="qty-sub">' +
        sub +
        '</span>',
    }
  }

  function decimalsFromTick(tickSize) {
    if (!(tickSize > 0) || !isFinite(tickSize)) return null
    return Math.max(0, Math.round(-Math.log10(tickSize) + 1e-12))
  }

  function decimalsFromPrice(price) {
    var a = Math.abs(Number(price))
    if (!isFinite(a) || a === 0) return 2
    if (a >= 1000) return 2
    if (a >= 1) return 4
    // 0.00778 → ceil(2.11)+3 = 6 знаков
    return Math.min(10, Math.max(4, Math.ceil(-Math.log10(a)) + 3))
  }

  /** Оценка tick, если биржа ещё не отдала PRICE_FILTER */
  function inferTickSize(price) {
    var a = Math.abs(Number(price))
    if (!isFinite(a) || a === 0) return 0.0001
    if (a < 0.001) return 0.0000001
    if (a < 0.01) return 0.00001
    if (a < 0.1) return 0.0001
    if (a < 1) return 0.0001
    if (a < 10) return 0.001
    if (a < 100) return 0.01
    if (a < 1000) return 0.1
    return 1
  }

  function formatPrice(price, tickSize) {
    var p = Number(price)
    if (!isFinite(p)) return '—'
    var dTick = decimalsFromTick(tickSize)
    var dPrice = decimalsFromPrice(p)
    var decimals = dTick != null ? Math.max(dTick, 0) : dPrice
    // если tick слишком грубый (0.01 при цене 0.00778) — не округляем в «0.01»
    var rounded = Number(p.toFixed(decimals))
    if (p !== 0 && (rounded === 0 || Math.abs(rounded - p) / Math.abs(p) > 0.02)) {
      decimals = Math.max(decimals, dPrice)
    }
    decimals = Math.min(12, decimals)
    return p.toFixed(decimals)
  }

  function aggregateLevels(levels, step, side) {
    if (!(step > 0)) return levels.slice()
    var map = {}
    for (var i = 0; i < levels.length; i++) {
      var price = levels[i].price
      var qty = levels[i].qty
      var bucket = side === 'bid' ? Math.floor(price / step) * step : Math.ceil(price / step) * step
      var key = Number(bucket.toFixed(12))
      map[key] = (map[key] || 0) + qty
    }
    var out = Object.keys(map).map(function (k) {
      return { price: Number(k), qty: map[k] }
    })
    out.sort(function (a, b) {
      return side === 'bid' ? b.price - a.price : a.price - b.price
    })
    return out
  }

  function exchangesForMarket(market) {
    return market === 'futures' ? FUTURES_EXCHANGES.slice() : SPOT_EXCHANGES.slice()
  }

  /** App chrome themes (shell / panels). Separate from DOM_THEMES (order book hues). */
  var UI_THEMES = {
    dark: { label: 'Тёмная' },
    light: { label: 'Светлая' },
    midnight: { label: 'Полночь' },
    slate: { label: 'Сланец' },
  }

  var DOM_THEMES = {
    dark: {
      label: 'Тёмная',
      askHue: 350,
      bidHue: 150,
    },
    classic: {
      label: 'Классика',
      askHue: 0,
      bidHue: 145,
    },
    midnight: {
      label: 'Полночь',
      askHue: 330,
      bidHue: 200,
    },
    ocean: {
      label: 'Океан',
      askHue: 345,
      bidHue: 175,
    },
    ember: {
      label: 'Угли',
      askHue: 12,
      bidHue: 85,
    },
    lime: {
      label: 'Лайм',
      askHue: 355,
      bidHue: 120,
    },
    violet: {
      label: 'Фиолет',
      askHue: 320,
      bidHue: 265,
    },
    mono: {
      label: 'Моно',
      askHue: 0,
      bidHue: 0,
    },
    contrast: {
      label: 'Контраст',
      askHue: 0,
      bidHue: 140,
    },
    scalp: {
      label: 'sCalp',
      askHue: 355,
      bidHue: 48,
    },
    arctic: {
      label: 'Арктика',
      askHue: 350,
      bidHue: 195,
    },
    matrix: {
      label: 'Matrix',
      askHue: 10,
      bidHue: 125,
    },
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.Config = {
    EXCHANGE_PRESETS: EXCHANGE_PRESETS,
    SPOT_EXCHANGES: SPOT_EXCHANGES,
    FUTURES_EXCHANGES: FUTURES_EXCHANGES,
    DEFAULT_API: DEFAULT_API,
    DEFAULT_DOM: DEFAULT_DOM,
    DEFAULT_TICKERS: DEFAULT_TICKERS,
    DOM_THEMES: DOM_THEMES,
    SYMBOLS: SYMBOLS,
    makePane: makePane,
    applyExchangePreset: applyExchangePreset,
    exchangesForMarket: exchangesForMarket,
    load: load,
    save: save,
    formatVolume: formatVolume,
    formatUsdVolume: formatUsdVolume,
    formatDomVolume: formatDomVolume,
    formatPrice: formatPrice,
    inferTickSize: inferTickSize,
    decimalsFromPrice: decimalsFromPrice,
    aggregateLevels: aggregateLevels,
    DEFAULT_CHART: {
      source: 'spot',
      interval: '1m',
      limit: 180,
      showGrid: true,
      showVolume: true,
      showRsi: true,
      tool: 'crosshair',
      liveWs: true,
      followLive: true,
      showLiqLevels: true,
      showLiquidityLevels: true,
      liqOpacity: 0.55,
      liquidityOpacity: 0.5,
      indicators: {
        sma20: true,
        sma50: false,
        ema12: true,
        ema26: false,
        bb: false,
        vwap: false,
      },
    },
    DEFAULT_PROFILE: {
      name: 'Trader',
      timezone: 'local',
      layout: 'chart-dual',
      showHistoryBar: true,
      showChart: true,
      autosave: true,
      confirmClearHistory: true,
      defaultTab: 'tickers',
      uiTheme: 'dark',
    },
    UI_THEMES: UI_THEMES,
    CHART_INTERVALS: [
      { id: '1s', label: '1с', bybit: null, sec: 1 },
      { id: '5s', label: '5с', bybit: null, sec: 5 },
      { id: '15s', label: '15с', bybit: null, sec: 15 },
      { id: '30s', label: '30с', bybit: null, sec: 30 },
      { id: '1m', label: '1м', bybit: '1' },
      { id: '3m', label: '3м', bybit: '3' },
      { id: '5m', label: '5м', bybit: '5' },
      { id: '15m', label: '15м', bybit: '15' },
      { id: '30m', label: '30м', bybit: '30' },
      { id: '1h', label: '1ч', bybit: '60' },
      { id: '2h', label: '2ч', bybit: '120' },
      { id: '4h', label: '4ч', bybit: '240' },
      { id: '6h', label: '6ч', bybit: '360' },
      { id: '12h', label: '12ч', bybit: '720' },
      { id: '1d', label: '1д', bybit: 'D' },
      { id: '1w', label: '1н', bybit: 'W' },
    ],
    CHART_TOOLS: [
      { id: 'crosshair', label: 'Курсор', icon: '✚' },
      { id: 'hline', label: 'Горизонталь', icon: '―' },
      { id: 'vline', label: 'Вертикаль', icon: '┃' },
      { id: 'trend', label: 'Тренд', icon: '╱' },
      { id: 'ray', label: 'Луч', icon: '↗' },
      { id: 'rect', label: 'Прямоугольник', icon: '▢' },
      { id: 'fib', label: 'Фибо', icon: 'φ' },
      { id: 'measure', label: 'Линейка', icon: '↔' },
    ],
    KEYS: {
      api: 'scalp-api-settings',
      dom: 'scalp-dom-settings',
      symbol: 'scalp-symbol',
      tickers: 'scalp-tickers-v3',
      chart: 'scalp-chart-v1',
      profile: 'scalp-profile-v1',
      history: 'scalp-history-v1',
      layout: 'scalp-layout-v1',
      screener: 'scalp-screener-v1',
      screenerMeta: 'scalp-screener-meta-v1',
      top25: 'scalp-top25-v1',
      atr30: 'scalp-atr30-v1',
      atr30Cache: 'scalp-atr30-cache-v1',
      atr30Meta: 'scalp-atr30-meta-v1',
      coinglass: 'scalp-coinglass-v1',
      telegram: 'scalp-telegram-v1',
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
