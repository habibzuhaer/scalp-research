/* Atr30Agent — топ-25 по дневному ATR% за 30 дней, кандидаты = топ-80 ликвидных */
(function (global) {
  'use strict'

  var DEFAULT_STATE = {
    pane: 'futures',
    search: '',
    quote: 'USDT',
    sort: 'atrPct',
    dir: 'desc',
    minVolume: 10000000,
    openPane: 'futures',
    onlyFav: true,
  }

  var DEFAULT_META = { favs: {} }

  /** Watchlist: стабильная ликвидность + ATR% ~5–10 */
  var SEED_FAVS = [
    'WLDUSDT',
    'FETUSDT',
    'PENGUUSDT',
    'UNIUSDT',
    'ZECUSDT',
    'NEARUSDT',
    'APTUSDT',
    'ONDOUSDT',
  ]

  var CACHE_TTL = 6 * 60 * 60 * 1000
  var CANDIDATES = 80
  var DAY_LIMIT = 40
  var ATR_PERIOD = 14

  function parseKlines(raw, exchange) {
    if (exchange === 'bybit' || exchange === 'bybit-futures') {
      var list = ((raw && raw.result && raw.result.list) || []).slice().reverse()
      return list.map(function (r) {
        return {
          time: Number(r[0]),
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
        }
      })
    }
    return (raw || []).map(function (r) {
      return {
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
      }
    })
  }

  function klineUrl(cfg, symbol) {
    if (!cfg) return null
    var base = String(cfg.restBaseUrl || '').replace(/\/+$/, '')
    var sym = String(symbol || '').toUpperCase()
    var ex = cfg.exchange
    if (ex === 'bybit' || ex === 'bybit-futures') {
      var cat = ex === 'bybit-futures' ? 'linear' : 'spot'
      return (
        base +
        '/v5/market/kline?category=' +
        cat +
        '&symbol=' +
        encodeURIComponent(sym) +
        '&interval=D&limit=' +
        DAY_LIMIT
      )
    }
    if (ex === 'binance-futures') {
      return base + '/fapi/v1/klines?symbol=' + encodeURIComponent(sym) + '&interval=1d&limit=' + DAY_LIMIT
    }
    return base + '/api/v3/klines?symbol=' + encodeURIComponent(sym) + '&interval=1d&limit=' + DAY_LIMIT
  }

  function atrWilder(candles, period) {
    period = period || ATR_PERIOD
    if (!candles || candles.length < period + 1) return null
    var trs = []
    for (var i = 0; i < candles.length; i++) {
      var h = Number(candles[i].high) || 0
      var l = Number(candles[i].low) || 0
      var prevC = i > 0 ? Number(candles[i - 1].close) || 0 : Number(candles[i].open) || 0
      trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)))
    }
    var atr = 0
    for (i = 0; i < period; i++) atr += trs[i]
    atr /= period
    for (i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period
    }
    return atr
  }

  function metricsFromCandles(candles) {
    var bars = (candles || []).filter(function (c) {
      return c && c.high > 0 && c.low > 0 && c.close > 0
    })
    if (bars.length < ATR_PERIOD + 1) return null
    var last30 = bars.slice(-30)
    var atr = atrWilder(bars, ATR_PERIOD)
    var close = Number(bars[bars.length - 1].close) || 0
    if (!(atr > 0) || !(close > 0)) return null
    var adrSum = 0
    last30.forEach(function (c) {
      adrSum += ((Number(c.high) - Number(c.low)) / Number(c.close)) * 100
    })
    var first = last30[0]
    var last = last30[last30.length - 1]
    var change30 = 0
    if (first && last && first.close > 0) {
      change30 = ((last.close - first.close) / first.close) * 100
    }
    return {
      atr: atr,
      atrPct: (atr / close) * 100,
      adrPct: last30.length ? adrSum / last30.length : 0,
      change30: change30,
      spark: last30.map(function (c) {
        return [c.open, c.high, c.low, c.close, Number(c.time) || 0]
      }),
      days: last30.map(function (c) {
        var o = Number(c.open) || 0
        var h = Number(c.high) || 0
        var l = Number(c.low) || 0
        var cl = Number(c.close) || 0
        var rng = cl > 0 ? ((h - l) / cl) * 100 : 0
        var ch = o > 0 ? ((cl - o) / o) * 100 : 0
        return {
          t: Number(c.time) || 0,
          rng: Math.round(rng * 100) / 100,
          ch: Math.round(ch * 100) / 100,
          o: o,
          h: h,
          l: l,
          c: cl,
        }
      }),
      price: close,
    }
  }

  function Atr30Agent(bus, tickersAgent, screenerAgent, top25Agent) {
    this.bus = bus
    this.tickers = tickersAgent
    this.screener = screenerAgent
    this.top25 = top25Agent
    this.state = Object.assign(
      {},
      DEFAULT_STATE,
      global.Scalp.Config.load(global.Scalp.Config.KEYS.atr30, DEFAULT_STATE),
    )
    var meta = global.Scalp.Config.load(global.Scalp.Config.KEYS.atr30Meta, DEFAULT_META)
    this.favs = (meta && meta.favs) || {}
    this._seedFavsIfEmpty()
    this.rows24 = []
    this.computed = []
    this.status = 'idle'
    this.error = null
    this.progress = { done: 0, total: 0, cached: 0 }
    this._seq = 0
    this._active = false
    this._cache = this._loadCache()
    this._bind()
  }

  Atr30Agent.prototype._seedFavsIfEmpty = function () {
    if (this.favs && Object.keys(this.favs).length) return
    var self = this
    this.favs = {}
    ;['spot', 'futures'].forEach(function (pane) {
      SEED_FAVS.forEach(function (sym) {
        self.favs[pane + ':' + String(sym).toLowerCase()] = 1
      })
    })
    this._saveMeta()
  }

  Atr30Agent.prototype._metaKey = function (symbol) {
    var pane = this.state.pane === 'futures' ? 'futures' : 'spot'
    return pane + ':' + String(symbol || '').toLowerCase()
  }

  Atr30Agent.prototype._saveMeta = function () {
    try {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.atr30Meta, { favs: this.favs })
    } catch (e) {}
  }

  Atr30Agent.prototype.isFav = function (symbol) {
    return !!this.favs[this._metaKey(symbol)]
  }

  Atr30Agent.prototype.toggleFav = function (symbol) {
    if (!symbol) return
    var key = this._metaKey(symbol)
    if (this.favs[key]) delete this.favs[key]
    else this.favs[key] = 1
    this._saveMeta()
    this.bus.emit('atr30:changed', this.snapshot())
    if (this.state.onlyFav && this._active) this.ensure(false)
  }

  Atr30Agent.prototype._favSymbols = function () {
    var pane = this.state.pane === 'futures' ? 'futures' : 'spot'
    var prefix = pane + ':'
    return Object.keys(this.favs || {})
      .filter(function (k) {
        return k.indexOf(prefix) === 0
      })
      .map(function (k) {
        return k.slice(prefix.length)
      })
  }

  Atr30Agent.prototype._bind = function () {
    var self = this
    this.bus.on('atr30:patch', function (partial) {
      self.patch(partial)
    })
    this.bus.on('atr30:reload', function () {
      self.ensure(true)
    })
    this.bus.on('atr30:open', function (row) {
      self.openSymbol(row)
    })
    this.bus.on('atr30:fav', function (row) {
      self.toggleFav(row && row.symbol)
    })
    this.bus.on('ui:set-page', function (page) {
      self._active = page === 'atr30'
      if (self._active) self.ensure(false)
    })
    this.bus.on('screener:changed', function () {
      if (self._active && self._canReuse(self.screener)) self._maybeRefreshUniverse()
    })
    this.bus.on('top25:changed', function () {
      if (self._active && self._canReuse(self.top25)) self._maybeRefreshUniverse()
    })
    this.bus.on('tickers:changed', function () {
      if (self._active) self.ensure(false)
    })
  }

  Atr30Agent.prototype.defaults = function () {
    return Object.assign({}, DEFAULT_STATE)
  }

  Atr30Agent.prototype.get = function () {
    return Object.assign({}, this.state)
  }

  Atr30Agent.prototype._paneCfg = function () {
    var pane = this.state.pane === 'futures' ? 'futures' : 'spot'
    return this.tickers.get()[pane]
  }

  Atr30Agent.prototype._marketKey = function () {
    var cfg = this._paneCfg()
    var pane = this.state.pane === 'futures' ? 'futures' : 'spot'
    return (cfg && cfg.exchange ? cfg.exchange : '') + '|' + pane
  }

  Atr30Agent.prototype._cacheKey = function (symbol) {
    return this._marketKey() + '|' + String(symbol || '').toLowerCase()
  }

  Atr30Agent.prototype._loadCache = function () {
    try {
      var raw = global.Scalp.Config.load(global.Scalp.Config.KEYS.atr30Cache, { items: {} })
      return raw && raw.items ? raw.items : {}
    } catch (e) {
      return {}
    }
  }

  Atr30Agent.prototype._saveCache = function () {
    var self = this
    var now = Date.now()
    var next = {}
    Object.keys(this._cache).forEach(function (k) {
      var it = self._cache[k]
      if (it && it.ts && now - it.ts < CACHE_TTL * 2) next[k] = it
    })
    this._cache = next
    try {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.atr30Cache, { items: this._cache })
    } catch (e) {}
  }

  Atr30Agent.prototype._cacheGet = function (symbol, force) {
    if (force) return null
    var item = this._cache[this._cacheKey(symbol)]
    if (!item || !item.ts) return null
    if (Date.now() - item.ts > CACHE_TTL) return null
    return item
  }

  Atr30Agent.prototype._cacheSet = function (symbol, metrics) {
    this._cache[this._cacheKey(symbol)] = Object.assign({ ts: Date.now() }, metrics)
  }

  Atr30Agent.prototype._canReuse = function (agent) {
    if (!agent) return false
    try {
      var mine = this._paneCfg()
      var theirs = agent._paneCfg && agent._paneCfg()
      var myPane = this.state.pane === 'futures' ? 'futures' : 'spot'
      var theirPane = agent.state && agent.state.pane === 'futures' ? 'futures' : 'spot'
      if (
        !(
          mine &&
          theirs &&
          mine.exchange === theirs.exchange &&
          mine.restBaseUrl === theirs.restBaseUrl &&
          myPane === theirPane
        )
      ) {
        return false
      }
      var rows = agent._sourceRows ? agent._sourceRows() : agent.rows
      return !!(rows && rows.length)
    } catch (e) {
      return false
    }
  }

  Atr30Agent.prototype._source24 = function () {
    if (this._canReuse(this.top25) && this.top25._sourceRows) return this.top25._sourceRows()
    if (this._canReuse(this.screener)) return this.screener.rows
    return this.rows24
  }

  Atr30Agent.prototype._numOrNull = function (v) {
    if (v === '' || v == null) return null
    var n = Number(v)
    return isFinite(n) ? n : null
  }

  Atr30Agent.prototype._candidates = function () {
    var SA = global.Scalp.ScreenerAgent
    var guess = (SA && SA.guessQuote) || function () {
      return ''
    }
    var quote = String(this.state.quote || 'USDT').toUpperCase()
    var minVol = this._numOrNull(this.state.minVolume)
    var onlyFav = this.state.onlyFav === true || this.state.onlyFav === '1' || this.state.onlyFav === 1
    var src = this._source24()
    var bySym = {}
    src.forEach(function (r) {
      bySym[String(r.symbol || '').toLowerCase()] = r
    })

    if (onlyFav) {
      var favs = this._favSymbols()
      return favs.map(function (sym) {
        var hit = bySym[sym]
        if (hit) return hit
        var up = String(sym).toUpperCase()
        return { symbol: sym, label: up, quoteVolume: 0, price: 0, change: 0 }
      })
    }

    var list = src.filter(function (r) {
      var qq = guess(r)
      if (quote && quote !== 'ALL' && qq !== quote) return false
      if (minVol != null && (Number(r.quoteVolume) || 0) < minVol) return false
      return true
    })
    list.sort(function (a, b) {
      return (Number(b.quoteVolume) || 0) - (Number(a.quoteVolume) || 0)
    })
    return list.slice(0, CANDIDATES)
  }

  Atr30Agent.prototype.filtered = function () {
    var self = this
    var q = String(this.state.search || '')
      .toLowerCase()
      .trim()
    var sort = this.state.sort || 'atrPct'
    var dir = this.state.dir === 'asc' ? 1 : -1
    var onlyFav = this.state.onlyFav === true || this.state.onlyFav === '1' || this.state.onlyFav === 1
    var list = this.computed.filter(function (r) {
      r.fav = self.isFav(r.symbol) ? 1 : 0
      if (onlyFav && !r.fav) return false
      if (!q) return true
      return r.symbol.indexOf(q) !== -1 || (r.label || '').toLowerCase().indexOf(q) !== -1
    })
    list.sort(function (a, b) {
      if (sort === 'symbol' || sort === 'label') {
        var av = String(a.label || a.symbol)
        var bv = String(b.label || b.symbol)
        return av < bv ? -dir : av > bv ? dir : 0
      }
      var an = Number(a[sort]) || 0
      var bn = Number(b[sort]) || 0
      return (an - bn) * dir
    })
    return onlyFav ? list : list.slice(0, 25)
  }

  Atr30Agent.prototype.snapshot = function () {
    return {
      state: this.get(),
      status: this.status,
      error: this.error,
      rows: this.filtered(),
      progress: Object.assign({}, this.progress),
      total: this.computed.length,
    }
  }

  Atr30Agent.prototype.patch = function (partial) {
    var paneChanged = partial && partial.pane && partial.pane !== this.state.pane
    var universeChanged =
      paneChanged ||
      (partial &&
        (partial.quote !== undefined ||
          partial.minVolume !== undefined ||
          partial.onlyFav !== undefined))
    this.state = Object.assign({}, this.state, partial || {})
    try {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.atr30, this.state)
    } catch (e) {}
    if (paneChanged) {
      this.computed = []
      this.rows24 = []
    }
    this.bus.emit('atr30:changed', this.snapshot())
    if (this._active && universeChanged) this.ensure(false)
  }

  Atr30Agent.prototype.openSymbol = function (row) {
    if (!row || !row.symbol) return
    var target = this.state.openPane || 'spot'
    if (target === 'both') {
      this.bus.emit('tickers:set-symbol', { pane: 'spot', symbol: row.symbol })
      this.bus.emit('tickers:set-symbol', { pane: 'futures', symbol: row.symbol })
      return
    }
    var pane = target === 'futures' ? 'futures' : 'spot'
    this.bus.emit('tickers:set-symbol', { pane: pane, symbol: row.symbol })
  }

  Atr30Agent.prototype._maybeRefreshUniverse = function () {
    if (this.status === 'loading') return
    if (!this.computed.length) this.ensure(false)
  }

  Atr30Agent.prototype._load24 = async function () {
    var SA = global.Scalp.ScreenerAgent
    var cfg = this._paneCfg()
    var url = SA && SA.tickerUrl ? SA.tickerUrl(cfg) : null
    var Gate = global.Scalp.ExchangeGate
    if (!url || !cfg) throw new Error('Нет URL тикеров')
    var raw
    if (Gate && Gate.fetchJson) raw = await Gate.fetchJson(url)
    else {
      var res = await fetch(url)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      raw = await res.json()
    }
    this.rows24 = SA.parseTickers(raw, cfg.exchange)
    return this.rows24
  }

  Atr30Agent.prototype.ensure = async function (force) {
    var self = this
    this._seq += 1
    var seq = this._seq
    var Gate = global.Scalp.ExchangeGate
    var cfg = this._paneCfg()
    if (!cfg) {
      this.status = 'error'
      this.error = 'Нет конфига биржи'
      this.bus.emit('atr30:changed', this.snapshot())
      return
    }

    if (Gate && Gate.banned()) {
      this.status = 'error'
      this.error =
        'HTTP 418 · Binance пауза ещё ' + Math.ceil(Gate.banLeftMs() / 1000) + 'с'
      this.bus.emit('atr30:changed', this.snapshot())
      return
    }

    this.status = 'loading'
    this.error = null
    this.progress = { done: 0, total: 0, cached: 0 }
    this.bus.emit('atr30:changed', this.snapshot())

    try {
      if (!this._source24().length) await this._load24()
      if (seq !== this._seq) return
      var cands = this._candidates()
      if (!cands.length) {
        this.computed = []
        this.status = this._source24().length ? 'ok' : 'error'
        this.error = this._source24().length ? null : 'Нет тикеров с биржи'
        this.bus.emit('atr30:changed', this.snapshot())
        return
      }

      var ready = []
      var missing = []
      var cachedN = 0
      cands.forEach(function (row) {
        var hit = self._cacheGet(row.symbol, force)
        if (hit) {
          cachedN += 1
          ready.push(self._mergeRow(row, hit))
        } else {
          missing.push(row)
        }
      })
      this.computed = ready
      this.progress = { done: ready.length, total: cands.length, cached: cachedN }
      this.bus.emit('atr30:changed', this.snapshot())

      for (var i = 0; i < missing.length; i++) {
        if (seq !== this._seq) return
        if (Gate && Gate.banned()) {
          this.status = 'error'
          this.error =
            'HTTP 418 · пауза ещё ' + Math.ceil(Gate.banLeftMs() / 1000) + 'с'
          this.bus.emit('atr30:changed', this.snapshot())
          return
        }
        var row = missing[i]
        try {
          var url = klineUrl(cfg, row.symbol)
          var raw
          if (Gate && Gate.fetchJson) raw = await Gate.fetchJson(url)
          else {
            var res = await fetch(url)
            if (!res.ok) throw new Error('HTTP ' + res.status)
            raw = await res.json()
          }
          if (seq !== this._seq) return
          var candles = parseKlines(raw, cfg.exchange)
          var m = metricsFromCandles(candles)
          if (m) {
            this._cacheSet(row.symbol, m)
            this.computed.push(this._mergeRow(row, m))
          }
        } catch (e) {
          if (Gate) Gate.noteErrorMessage(e && e.message)
        }
        this.progress.done = cachedN + i + 1
        if (i === missing.length - 1 || i % 3 === 0) {
          this.bus.emit('atr30:changed', this.snapshot())
        }
      }
      this._saveCache()
      if (seq !== this._seq) return
      this.status = 'ok'
      this.error = null
      this.bus.emit('atr30:changed', this.snapshot())
    } catch (e) {
      if (seq !== this._seq) return
      if (Gate) Gate.noteErrorMessage(e && e.message)
      this.status = 'error'
      this.error = e.message || 'Ошибка ATR 30д'
      this.bus.emit('atr30:changed', this.snapshot())
    }
  }

  Atr30Agent.prototype._mergeRow = function (row, m) {
    return {
      symbol: row.symbol,
      label: row.label || String(row.symbol || '').toUpperCase(),
      quoteVolume: Number(row.quoteVolume) || 0,
      mmScore: Number(row.mmScore) || 0,
      change: Number(row.change) || 0,
      price: Number(m.price) || Number(row.price) || 0,
      atr: Number(m.atr) || 0,
      atrPct: Number(m.atrPct) || 0,
      adrPct: Number(m.adrPct) || 0,
      change30: Number(m.change30) || 0,
      spark: m.spark || [],
      days: m.days || [],
    }
  }

  Atr30Agent.prototype.start = function () {
    var page = 'trade'
    try {
      page = localStorage.getItem('scalp-page-view') || 'trade'
    } catch (e) {}
    this._active = page === 'atr30'
    this.bus.emit('atr30:changed', this.snapshot())
    if (this._active) this.ensure(false)
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.Atr30Agent = Atr30Agent
})(typeof window !== 'undefined' ? window : globalThis)
