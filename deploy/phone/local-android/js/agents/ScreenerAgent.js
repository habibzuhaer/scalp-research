/* ScreenerAgent — крипты с биржи: цена, Δ24h, объём + фильтры */
(function (global) {
  'use strict'

  var DEFAULT_STATE = {
    pane: 'spot',
    search: '',
    quote: 'USDT',
    sort: 'quoteVolume',
    dir: 'desc',
    limit: 250,
    move: 'all',
    minVolume: '',
    maxVolume: '',
    minPrice: '',
    maxPrice: '',
    minVolat: '',
    maxVolat: '',
    minJump: '',
    maxJump: '',
    minMm: '',
    maxSpread: '',
    minDepth: '',
    minTrades: '',
    maxAgeDays: '',
    filterPreset: '',
    bookBias: 'all',
    openPane: 'spot',
    onlyFav: false,
  }

  var DEFAULT_META = { favs: {}, notes: {}, marks: {} }

  /** 24h range volatility, % of last price: (high − low) / price × 100 */
  function calcVolat(high, low, price) {
    var px = Number(price) || 0
    var h = Number(high) || 0
    var l = Number(low) || 0
    if (!(px > 0) || !(h > 0) || !(l > 0) || h < l) return 0
    return ((h - l) / px) * 100
  }

  /** Absolute 24h move — proxy for a sharp jump */
  function calcJump(change) {
    return Math.abs(Number(change) || 0)
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n))
  }

  /**
   * Оценка «качества MM» для скальпа 0–100:
   * узкий спред + ликвидность top-of-book + оборот + активность сделок.
   */
  function enrichRow(row) {
    var price = Number(row.price) || 0
    var bid = Number(row.bidPrice) || 0
    var ask = Number(row.askPrice) || 0
    var bidQty = Number(row.bidQty) || 0
    var askQty = Number(row.askQty) || 0
    var qv = Number(row.quoteVolume) || 0
    var trades = Number(row.trades) || 0
    var mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : price
    var hasBook = bid > 0 && ask > 0 && ask >= bid
    var spreadBps = hasBook ? ((ask - bid) / mid) * 10000 : NaN
    var topDepth = 0
    if (bid > 0) topDepth += bidQty * bid
    if (ask > 0) topDepth += askQty * ask
    var bookTotal = bidQty + askQty
    var bookImbalance = bookTotal > 0 ? bidQty / bookTotal : 0.5
    // 0 = ask-heavy, 1 = bid-heavy
    var vwap = Number(row.weightedAvgPrice) || 0
    var vwapBias = vwap > 0 && price > 0 ? ((price - vwap) / vwap) * 100 : 0
    var volat = Number(row.volatility) || 0
    var jump = Number(row.jump) || 0
    var rangeEff = volat > 0.01 ? jump / volat : 0

    // MM score parts
    var spreadPart = hasBook ? clamp(40 - spreadBps * 2.5, 0, 40) : 18
    var volPart = clamp(Math.log10(Math.max(1, qv)) * 4.5, 0, 30)
    var depthPart =
      topDepth > 0 ? clamp(Math.log10(Math.max(1, topDepth)) * 4, 0, 20) : clamp(volPart * 0.4, 0, 12)
    var tradePart = trades > 0 ? clamp(Math.log10(Math.max(1, trades)) * 2.5, 0, 10) : clamp(volPart * 0.2, 0, 6)
    var mmScore = Math.round(spreadPart + volPart + depthPart + tradePart)

    row.spreadBps = hasBook ? Math.round(spreadBps * 10) / 10 : null
    row.topDepth = topDepth
    row.bookImbalance = Math.round(bookImbalance * 1000) / 1000
    row.trades = trades
    row.vwapBias = Math.round(vwapBias * 100) / 100
    row.rangeEff = Math.round(rangeEff * 100) / 100
    row.mmScore = mmScore
    return row
  }

  function tickerUrl(cfg) {
    if (!cfg) return null
    var base = String(cfg.restBaseUrl || '').replace(/\/+$/, '')
    var ex = cfg.exchange
    if (ex === 'binance') return base + '/api/v3/ticker/24hr'
    if (ex === 'binance-futures') return base + '/fapi/v1/ticker/24hr'
    if (ex === 'bybit') return base + '/v5/market/tickers?category=spot'
    if (ex === 'bybit-futures') return base + '/v5/market/tickers?category=linear'
    return null
  }

  function guessQuote(row) {
    if (row && row.quote) return row.quote
    var lab = (row && (row.label || row.symbol && String(row.symbol).toUpperCase())) || ''
    var quotes = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'FDUSD', 'EUR', 'TRY']
    for (var i = 0; i < quotes.length; i++) {
      if (lab.slice(-quotes[i].length) === quotes[i]) return quotes[i]
    }
    return ''
  }

  function parseTickers(raw, exchange) {
    var out = []
    if (exchange === 'bybit' || exchange === 'bybit-futures') {
      var list = (raw && raw.result && raw.result.list) || []
      for (var i = 0; i < list.length; i++) {
        var t = list[i]
        var sym = String(t.symbol || '').toLowerCase()
        if (!sym) continue
        var price = Number(t.lastPrice) || 0
        var change = Number(t.price24hPcnt) * 100 || 0
        var high = Number(t.highPrice24h) || 0
        var low = Number(t.lowPrice24h) || 0
        out.push(
          enrichRow({
            symbol: sym,
            label: String(t.symbol || '').toUpperCase(),
            price: price,
            change: change,
            jump: calcJump(change),
            volatility: calcVolat(high, low, price),
            quoteVolume: Number(t.turnover24h) || 0,
            volume: Number(t.volume24h) || 0,
            high: high,
            low: low,
            bidPrice: Number(t.bid1Price) || 0,
            askPrice: Number(t.ask1Price) || 0,
            bidQty: Number(t.bid1Size) || 0,
            askQty: Number(t.ask1Size) || 0,
            trades: 0,
            weightedAvgPrice: price,
          }),
        )
      }
      return out
    }
    var arr = Array.isArray(raw) ? raw : []
    for (var j = 0; j < arr.length; j++) {
      var b = arr[j]
      var id = String(b.symbol || '').toLowerCase()
      if (!id) continue
      var bPrice = Number(b.lastPrice) || 0
      var bChange = Number(b.priceChangePercent) || 0
      var bHigh = Number(b.highPrice) || 0
      var bLow = Number(b.lowPrice) || 0
      out.push(
        enrichRow({
          symbol: id,
          label: String(b.symbol || '').toUpperCase(),
          price: bPrice,
          change: bChange,
          jump: calcJump(bChange),
          volatility: calcVolat(bHigh, bLow, bPrice),
          quoteVolume: Number(b.quoteVolume) || 0,
          volume: Number(b.volume) || 0,
          high: bHigh,
          low: bLow,
          bidPrice: Number(b.bidPrice) || 0,
          askPrice: Number(b.askPrice) || 0,
          bidQty: Number(b.bidQty) || 0,
          askQty: Number(b.askQty) || 0,
          trades: Number(b.count) || 0,
          weightedAvgPrice: Number(b.weightedAvgPrice) || bPrice,
        }),
      )
    }
    return out
  }

  function ScreenerAgent(bus, tickersAgent, symbolsAgent) {
    this.bus = bus
    this.tickers = tickersAgent
    this.symbols = symbolsAgent
    this.state = Object.assign(
      {},
      DEFAULT_STATE,
      global.Scalp.Config.load(global.Scalp.Config.KEYS.screener, DEFAULT_STATE),
    )
    this.rows = []
    this.status = 'idle'
    this.error = null
    this._timer = 0
    this._seq = 0
    this._lastEx = ''
    var meta = global.Scalp.Config.load(global.Scalp.Config.KEYS.screenerMeta, DEFAULT_META)
    this.favs = (meta && meta.favs) || {}
    this.notes = (meta && meta.notes) || {}
    this.marks = (meta && meta.marks) || {}
    // migrate favs → marks
    var selfMeta = this
    Object.keys(this.favs).forEach(function (k) {
      if (selfMeta.favs[k] && !selfMeta.marks[k]) {
        selfMeta.marks[k] = { shape: 'star', color: '#f0b90b' }
      }
    })
    this._bind()
  }

  ScreenerAgent.prototype._bind = function () {
    var self = this
    this.bus.on('screener:patch', function (partial) {
      self.patch(partial)
    })
    this.bus.on('screener:reload', function () {
      self.load(true)
    })
    this.bus.on('screener:open', function (row) {
      self.openSymbol(row)
    })
    this.bus.on('screener:fav', function (row) {
      self.toggleFav(row && row.symbol, row && row.paint)
    })
    this.bus.on('screener:mark', function (payload) {
      if (!payload || !payload.symbol) return
      self.setMark(payload.symbol, payload.mark, payload.pane)
    })
    this.bus.on('screener:mark-clear', function (payload) {
      self.clearMark(payload && payload.symbol, payload && payload.pane)
    })
    this.bus.on('screener:note', function (payload) {
      if (!payload) return
      self.setNote(payload.symbol, payload.note)
    })
    this.bus.on('tickers:changed', function () {
      var cfg = self._paneCfg()
      var key = cfg.exchange + '|' + cfg.restBaseUrl
      if (key !== self._lastEx) {
        self._lastEx = key
        self.load(true)
      }
    })
    this.bus.on('symbols:loaded', function () {
      self._mergeMeta()
      self.bus.emit('screener:changed', self.snapshot())
    })
  }

  ScreenerAgent.prototype.get = function () {
    return Object.assign({}, this.state)
  }

  ScreenerAgent.prototype.defaults = function () {
    return Object.assign({}, DEFAULT_STATE)
  }

  ScreenerAgent.prototype.snapshot = function () {
    return {
      state: this.get(),
      status: this.status,
      error: this.error,
      rows: this.filtered(),
      total: this.rows.length,
    }
  }

  ScreenerAgent.prototype.patch = function (partial) {
    this.state = Object.assign({}, this.state, partial || {})
    try {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.screener, this.state)
    } catch (e) {}
    this.bus.emit('screener:changed', this.snapshot())
    if (partial && partial.pane) this.load(true)
  }

  ScreenerAgent.prototype._metaKey = function (symbol, pane) {
    var p = pane || (this.state.pane === 'futures' ? 'futures' : 'spot')
    return p + ':' + String(symbol || '').toLowerCase()
  }

  ScreenerAgent.prototype._saveMeta = function () {
    try {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.screenerMeta, {
        favs: this.favs,
        notes: this.notes,
        marks: this.marks,
      })
    } catch (e) {}
  }

  ScreenerAgent.prototype.isFav = function (symbol, pane) {
    return !!this.favs[this._metaKey(symbol, pane)]
  }

  ScreenerAgent.prototype.getMark = function (symbol, pane) {
    var m = this.marks[this._metaKey(symbol, pane)]
    if (!m) return null
    return { shape: m.shape || 'star', color: m.color || '#f0b90b' }
  }

  ScreenerAgent.prototype.setMark = function (symbol, mark, pane) {
    if (!symbol) return
    var key = this._metaKey(symbol, pane)
    if (!mark) {
      delete this.marks[key]
      delete this.favs[key]
    } else {
      this.marks[key] = {
        shape: mark.shape === 'flag' || mark.shape === 'sq' ? mark.shape : 'star',
        color: mark.color || '#f0b90b',
      }
      this.favs[key] = 1
    }
    this._saveMeta()
    this.bus.emit('screener:changed', this.snapshot())
  }

  ScreenerAgent.prototype.clearMark = function (symbol, pane) {
    this.setMark(symbol, null, pane)
  }

  ScreenerAgent.prototype.toggleFav = function (symbol, paint) {
    if (!symbol) return
    var pane = paint && paint.pane
    var key = this._metaKey(symbol, pane)
    if (this.favs[key] || this.marks[key]) {
      delete this.favs[key]
      delete this.marks[key]
    } else {
      this.favs[key] = 1
      this.marks[key] = {
        shape: (paint && paint.shape) || 'star',
        color: (paint && paint.color) || '#f0b90b',
      }
    }
    this._saveMeta()
    this.bus.emit('screener:changed', this.snapshot())
  }

  ScreenerAgent.prototype.getNote = function (symbol) {
    return this.notes[this._metaKey(symbol)] || ''
  }

  ScreenerAgent.prototype.setNote = function (symbol, text) {
    if (!symbol) return
    var key = this._metaKey(symbol)
    var raw = String(text == null ? '' : text)
    if (raw.length > 240) raw = raw.slice(0, 240)
    if (raw === '') delete this.notes[key]
    else this.notes[key] = raw
    this._saveMeta()
  }

  ScreenerAgent.prototype.openSymbol = function (row) {
    if (!row || !row.symbol) return
    var target = this.state.openPane || 'spot'
    if (target === 'both') {
      this.bus.emit('tickers:set-symbol', { pane: 'spot', symbol: row.symbol })
      this.bus.emit('tickers:set-symbol', { pane: 'futures', symbol: row.symbol })
      return
    }
    var pane = target === 'futures' ? 'futures' : 'spot'
    // если openPane не задан явно под рынок скринера — берём рынок списка
    if (!this.state.openPane) pane = this.state.pane === 'futures' ? 'futures' : 'spot'
    this.bus.emit('tickers:set-symbol', { pane: pane, symbol: row.symbol })
  }

  ScreenerAgent.prototype._paneCfg = function () {
    var pane = this.state.pane === 'futures' ? 'futures' : 'spot'
    return this.tickers.get()[pane]
  }

  ScreenerAgent.prototype._tickerUrl = function () {
    return tickerUrl(this._paneCfg())
  }

  ScreenerAgent.prototype._parse = function (raw, exchange) {
    return parseTickers(raw, exchange)
  }

  ScreenerAgent.prototype._mergeMeta = function () {
    var cfg = this._paneCfg()
    if (!this.symbols || !cfg) return
    for (var i = 0; i < this.rows.length; i++) {
      var meta = this.symbols.find(cfg.exchange, this.rows[i].symbol)
      if (meta) {
        this.rows[i].base = meta.base || ''
        this.rows[i].quote = meta.quote || ''
        this.rows[i].tickSize = meta.tickSize || 0
        if (meta.label) this.rows[i].label = meta.label
        var lt = Number(meta.listTime) || 0
        this.rows[i].listTime = lt
        this.rows[i].ageDays = lt > 0 ? (Date.now() - lt) / 86400000 : null
      }
    }
  }

  ScreenerAgent.prototype._guessQuote = function (row) {
    return guessQuote(row)
  }

  ScreenerAgent.prototype._numOrNull = function (v) {
    if (v === '' || v == null) return null
    var n = Number(v)
    return isFinite(n) ? n : null
  }

  ScreenerAgent.prototype.filtered = function () {
    var self = this
    var q = String(this.state.search || '')
      .toLowerCase()
      .trim()
    var quote = String(this.state.quote || 'USDT').toUpperCase()
    var move = this.state.move || 'all'
    var minVol = this._numOrNull(this.state.minVolume)
    var maxVol = this._numOrNull(this.state.maxVolume)
    var minPx = this._numOrNull(this.state.minPrice)
    var maxPx = this._numOrNull(this.state.maxPrice)
    var minVt = this._numOrNull(this.state.minVolat)
    var maxVt = this._numOrNull(this.state.maxVolat)
    var minJp = this._numOrNull(this.state.minJump)
    var maxJp = this._numOrNull(this.state.maxJump)
    var minMm = this._numOrNull(this.state.minMm)
    var maxSpr = this._numOrNull(this.state.maxSpread)
    var minDep = this._numOrNull(this.state.minDepth)
    var minTr = this._numOrNull(this.state.minTrades)
    var maxAge = this._numOrNull(this.state.maxAgeDays)
    var bias = this.state.bookBias || 'all'
    var onlyFav = this.state.onlyFav === true || this.state.onlyFav === '1' || this.state.onlyFav === 1
    var sort = this.state.sort || 'quoteVolume'
    var dir = this.state.dir === 'asc' ? 1 : -1

    var list = this.rows.filter(function (r) {
      r.fav = self.isFav(r.symbol) ? 1 : 0
      r.note = self.getNote(r.symbol)
      r.mark = self.getMark(r.symbol)
      if (onlyFav && !r.fav) return false
      var qq = self._guessQuote(r)
      if (quote && quote !== 'ALL' && qq !== quote) return false
      if (q && r.symbol.indexOf(q) === -1 && (r.label || '').toLowerCase().indexOf(q) === -1) {
        return false
      }
      var ch = Number(r.change) || 0
      if (move === 'up' && ch <= 0) return false
      if (move === 'down' && ch >= 0) return false
      var vol = Number(r.quoteVolume) || 0
      if (minVol != null && vol < minVol) return false
      if (maxVol != null && vol > maxVol) return false
      var px = Number(r.price) || 0
      if (minPx != null && px < minPx) return false
      if (maxPx != null && px > maxPx) return false
      var vt = Number(r.volatility) || 0
      if (minVt != null && vt < minVt) return false
      if (maxVt != null && vt > maxVt) return false
      var jp = Number(r.jump) || calcJump(ch)
      if (minJp != null && jp < minJp) return false
      if (maxJp != null && jp > maxJp) return false
      var mm = Number(r.mmScore) || 0
      if (minMm != null && mm < minMm) return false
      var spr = Number(r.spreadBps)
      if (maxSpr != null && (r.spreadBps == null || !(spr <= maxSpr))) return false
      var dep = Number(r.topDepth) || 0
      if (minDep != null && dep < minDep) return false
      var tr = Number(r.trades) || 0
      if (minTr != null && tr < minTr) return false
      if (maxAge != null) {
        var age = r.ageDays
        if (age == null || !(age >= 0) || age > maxAge) return false
      }
      var imb = Number(r.bookImbalance)
      if (bias === 'bid' && !(imb >= 0.58)) return false
      if (bias === 'ask' && !(imb <= 0.42)) return false
      if (bias === 'balanced' && (imb < 0.42 || imb > 0.58)) return false
      return true
    })

    list.sort(function (a, b) {
      if (sort === 'note') {
        var an = String(a.note || '')
        var bn = String(b.note || '')
        return an < bn ? -dir : an > bn ? dir : 0
      }
      if (sort === 'ageDays') {
        var aa = a.ageDays == null ? 1e12 : Number(a.ageDays)
        var ba = b.ageDays == null ? 1e12 : Number(b.ageDays)
        return (aa - ba) * dir
      }
      if (sort === 'listTime') {
        var al = Number(a.listTime) || 0
        var bl = Number(b.listTime) || 0
        return (al - bl) * dir
      }
      var av = a[sort]
      var bv = b[sort]
      if (sort === 'symbol' || sort === 'label') {
        av = String(a.label || a.symbol)
        bv = String(b.label || b.symbol)
        return av < bv ? -dir : av > bv ? dir : 0
      }
      av = Number(av) || 0
      bv = Number(bv) || 0
      return (av - bv) * dir
    })
    var lim = Math.max(20, Math.min(1000, Number(this.state.limit) || 250))
    return list.slice(0, lim)
  }

  ScreenerAgent.prototype.load = async function (force) {
    var self = this
    var url = this._tickerUrl()
    var cfg = this._paneCfg()
    var Gate = global.Scalp.ExchangeGate
    if (!url || !cfg) {
      this.status = 'error'
      this.error = 'Нет URL тикеров'
      this.bus.emit('screener:changed', this.snapshot())
      return
    }
    this._lastEx = cfg.exchange + '|' + cfg.restBaseUrl
    this._seq += 1
    var seq = this._seq

    if (Gate && Gate.banned()) {
      this.status = 'error'
      this.error =
        'HTTP 418 · Binance пауза ещё ' + Math.ceil(Gate.banLeftMs() / 1000) + 'с (не спамим API)'
      this.bus.emit('screener:changed', this.snapshot())
      if (this._timer) clearTimeout(this._timer)
      this._timer = setTimeout(function () {
        self.load(false)
      }, Math.max(5000, Gate.banLeftMs() + 500))
      return
    }

    this.status = 'loading'
    this.error = null
    this.bus.emit('screener:changed', this.snapshot())
    try {
      // symbols — только если кэша ещё нет (лишний exchangeInfo = вес API)
      if (this.symbols) {
        var st = this.symbols.status[cfg.exchange]
        if (st !== 'ok' && st !== 'loading') {
          this.symbols.load(cfg.exchange, cfg.restBaseUrl)
        }
      }
      var raw
      if (Gate && Gate.fetchJson) {
        raw = await Gate.fetchJson(url)
      } else {
        var res = await fetch(url)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        raw = await res.json()
      }
      if (seq !== this._seq) return
      this.rows = this._parse(raw, cfg.exchange)
      this._mergeMeta()
      this.status = 'ok'
      this.error = null
      this.bus.emit('screener:changed', this.snapshot())
    } catch (e) {
      if (seq !== this._seq) return
      if (Gate) Gate.noteErrorMessage(e && e.message)
      this.status = 'error'
      this.error = e.message || 'Ошибка скринера'
      // не затираем старые rows — покажем кэш + ошибку
      this.bus.emit('screener:changed', this.snapshot())
    }
    if (this._timer) clearTimeout(this._timer)
    var wait = 120000
    if (this.status === 'error') {
      wait = Gate && Gate.banned() ? Math.max(15000, Gate.banLeftMs() + 1000) : 180000
    } else if (force) {
      wait = 90000
    }
    this._timer = setTimeout(function () {
      self.load(false)
    }, wait)
  }

  ScreenerAgent.prototype.start = function () {
    this.load(true)
  }

  ScreenerAgent.prototype.destroy = function () {
    if (this._timer) clearTimeout(this._timer)
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.ScreenerAgent = ScreenerAgent
  ScreenerAgent.tickerUrl = tickerUrl
  ScreenerAgent.parseTickers = parseTickers
  ScreenerAgent.guessQuote = guessQuote
  ScreenerAgent.enrichRow = enrichRow
})(typeof window !== 'undefined' ? window : globalThis)
