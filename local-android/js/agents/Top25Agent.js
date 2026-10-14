/* Top25Agent — топ-25 ликвидных по волатильности 24h */
(function (global) {
  'use strict'

  var DEFAULT_STATE = {
    pane: 'spot',
    search: '',
    quote: 'USDT',
    sort: 'volatility',
    dir: 'desc',
    minVolume: 10000000,
    minMm: '',
    maxSpread: '',
    openPane: 'spot',
  }

  function Top25Agent(bus, tickersAgent, screenerAgent) {
    this.bus = bus
    this.tickers = tickersAgent
    this.screener = screenerAgent
    this.state = Object.assign(
      {},
      DEFAULT_STATE,
      global.Scalp.Config.load(global.Scalp.Config.KEYS.top25, DEFAULT_STATE),
    )
    this.rows = []
    this.status = 'idle'
    this.error = null
    this._timer = 0
    this._seq = 0
    this._lastEx = ''
    this._active = false
    this._overrideRows = null
    this._overrideLabel = ''
    this._overrideCap = 55
    this._bind()
  }

  Top25Agent.prototype._bind = function () {
    var self = this
    this.bus.on('top25:patch', function (partial) {
      self.patch(partial)
    })
    this.bus.on('top25:reload', function () {
      self.load(true)
    })
    this.bus.on('top25:open', function (row) {
      self.openSymbol(row)
    })
    this.bus.on('top25:from-screener', function (payload) {
      self.setFromScreener(payload)
    })
    this.bus.on('top25:clear-override', function () {
      self.clearOverride()
    })
    this.bus.on('screener:changed', function () {
      if (self._overrideRows) {
        self.bus.emit('top25:changed', self.snapshot())
        return
      }
      if (self._canReuseScreener()) {
        self.status = self.screener.status
        self.error = self.screener.error
        self.bus.emit('top25:changed', self.snapshot())
      }
    })
    this.bus.on('tickers:changed', function () {
      var cfg = self._paneCfg()
      if (!cfg) return
      var key = cfg.exchange + '|' + cfg.restBaseUrl
      if (key !== self._lastEx) {
        self._lastEx = key
        if (self._active && !self._overrideRows) self.load(false)
      }
    })
    this.bus.on('ui:set-page', function (page) {
      self._active = page === 'top25' || page === 'visualizer'
      if (self._active && !self._overrideRows) self.load(false)
      if (self._active) self.bus.emit('top25:changed', self.snapshot())
    })
  }

  Top25Agent.prototype.setFromScreener = function (payload) {
    var rows = (payload && payload.rows) || []
    var cap = Math.max(1, Math.min(55, Number(payload && payload.limit) || this._overrideCap || 55))
    this._overrideCap = cap
    this._overrideRows = rows
      .slice(0, cap)
      .map(function (r) {
        return Object.assign({}, r)
      })
    this._overrideLabel = (payload && payload.label) || 'скринер'
    if (payload && payload.pane) {
      this.state = Object.assign({}, this.state, {
        pane: payload.pane === 'futures' ? 'futures' : 'spot',
      })
      try {
        global.Scalp.Config.save(global.Scalp.Config.KEYS.top25, this.state)
      } catch (e) {}
    }
    this.status = 'ok'
    this.error = null
    this.bus.emit('top25:changed', this.snapshot())
  }

  Top25Agent.prototype.clearOverride = function () {
    if (!this._overrideRows) return
    this._overrideRows = null
    this._overrideLabel = ''
    this.bus.emit('top25:changed', this.snapshot())
    if (this._active) this.load(false)
  }

  Top25Agent.prototype.defaults = function () {
    return Object.assign({}, DEFAULT_STATE)
  }

  Top25Agent.prototype.get = function () {
    return Object.assign({}, this.state)
  }

  Top25Agent.prototype._paneCfg = function () {
    var pane = this.state.pane === 'futures' ? 'futures' : 'spot'
    return this.tickers.get()[pane]
  }

  Top25Agent.prototype._canReuseScreener = function () {
    var sc = this.screener
    if (!sc || !sc.rows || !sc.rows.length) return false
    try {
      var mine = this._paneCfg()
      var theirs = sc._paneCfg()
      var myPane = this.state.pane === 'futures' ? 'futures' : 'spot'
      var scPane = sc.state.pane === 'futures' ? 'futures' : 'spot'
      return !!(
        mine &&
        theirs &&
        mine.exchange === theirs.exchange &&
        mine.restBaseUrl === theirs.restBaseUrl &&
        myPane === scPane
      )
    } catch (e) {
      return false
    }
  }

  Top25Agent.prototype._sourceRows = function () {
    if (this._canReuseScreener()) return this.screener.rows
    return this.rows
  }

  Top25Agent.prototype._numOrNull = function (v) {
    if (v === '' || v == null) return null
    var n = Number(v)
    return isFinite(n) ? n : null
  }

  Top25Agent.prototype.filtered = function () {
    var sc = this.screener
    var paneMark = this.state.pane === 'futures' ? 'futures' : 'spot'
    function enrich(list) {
      return list.map(function (r) {
        var copy = Object.assign({}, r)
        if (sc) {
          copy.fav = sc.isFav(r.symbol, paneMark) ? 1 : 0
          copy.mark = sc.getMark(r.symbol, paneMark)
        }
        return copy
      })
    }

    if (this._overrideRows && this._overrideRows.length) {
      return enrich(this._overrideRows.slice(0, this._overrideCap || 55))
    }

    var SA = global.Scalp.ScreenerAgent
    var guess = (SA && SA.guessQuote) || function () {
      return ''
    }
    var q = String(this.state.search || '')
      .toLowerCase()
      .trim()
    var quote = String(this.state.quote || 'USDT').toUpperCase()
    var minVol = this._numOrNull(this.state.minVolume)
    var minMm = this._numOrNull(this.state.minMm)
    var maxSpr = this._numOrNull(this.state.maxSpread)
    var sort = this.state.sort || 'volatility'
    var dir = this.state.dir === 'asc' ? 1 : -1

    var list = this._sourceRows().filter(function (r) {
      var qq = guess(r)
      if (quote && quote !== 'ALL' && qq !== quote) return false
      if (q && r.symbol.indexOf(q) === -1 && (r.label || '').toLowerCase().indexOf(q) === -1) {
        return false
      }
      var vol = Number(r.quoteVolume) || 0
      if (minVol != null && vol < minVol) return false
      var mm = Number(r.mmScore) || 0
      if (minMm != null && mm < minMm) return false
      var spr = Number(r.spreadBps)
      if (maxSpr != null && (r.spreadBps == null || !(spr <= maxSpr))) return false
      return true
    })

    list = enrich(list)

    list.sort(function (a, b) {
      if (sort === 'mark' || sort === 'fav') {
        var am = a.mark ? 1 : 0
        var bm = b.mark ? 1 : 0
        if (am !== bm) return (am - bm) * dir
        var ac = (a.mark && a.mark.color) || ''
        var bc = (b.mark && b.mark.color) || ''
        if (ac !== bc) return ac < bc ? -dir : ac > bc ? dir : 0
      }
      if (sort === 'symbol' || sort === 'label') {
        var av = String(a.label || a.symbol)
        var bv = String(b.label || b.symbol)
        return av < bv ? -dir : av > bv ? dir : 0
      }
      var an = Number(a[sort]) || 0
      var bn = Number(b[sort]) || 0
      return (an - bn) * dir
    })
    return list.slice(0, 25)
  }

  Top25Agent.prototype.snapshot = function () {
    var rows = this.filtered()
    var src = this._overrideRows || this._sourceRows()
    return {
      state: this.get(),
      status: this._overrideRows
        ? 'ok'
        : this._canReuseScreener()
          ? this.screener.status
          : this.status,
      error: this._overrideRows
        ? null
        : this._canReuseScreener()
          ? this.screener.error
          : this.error,
      rows: rows,
      total: src.length,
      universe: this._overrideRows ? src.length : this._universeSize(),
      fromScreener: !!this._overrideRows,
      overrideLabel: this._overrideLabel || '',
    }
  }

  Top25Agent.prototype._universeSize = function () {
    var SA = global.Scalp.ScreenerAgent
    var guess = (SA && SA.guessQuote) || function () {
      return ''
    }
    var quote = String(this.state.quote || 'USDT').toUpperCase()
    var minVol = this._numOrNull(this.state.minVolume)
    var n = 0
    this._sourceRows().forEach(function (r) {
      var qq = guess(r)
      if (quote && quote !== 'ALL' && qq !== quote) return
      if (minVol != null && (Number(r.quoteVolume) || 0) < minVol) return
      n += 1
    })
    return n
  }

  Top25Agent.prototype.patch = function (partial) {
    this.state = Object.assign({}, this.state, partial || {})
    try {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.top25, this.state)
    } catch (e) {}
    this.bus.emit('top25:changed', this.snapshot())
    // при выборке из скринера не перезатираем список своим load
    if (partial && partial.pane && !this._overrideRows) this.load(true)
  }

  Top25Agent.prototype.openSymbol = function (row) {
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

  Top25Agent.prototype.load = async function (force) {
    var self = this
    if (!force && this._canReuseScreener()) {
      this.status = this.screener.status
      this.error = this.screener.error
      this.bus.emit('top25:changed', this.snapshot())
      return
    }
    var SA = global.Scalp.ScreenerAgent
    var cfg = this._paneCfg()
    var url = SA && SA.tickerUrl ? SA.tickerUrl(cfg) : null
    var Gate = global.Scalp.ExchangeGate
    if (!url || !cfg) {
      this.status = 'error'
      this.error = 'Нет URL тикеров'
      this.bus.emit('top25:changed', this.snapshot())
      return
    }
    this._lastEx = cfg.exchange + '|' + cfg.restBaseUrl
    this._seq += 1
    var seq = this._seq

    if (Gate && Gate.banned()) {
      this.status = 'error'
      this.error =
        'HTTP 418 · Binance пауза ещё ' + Math.ceil(Gate.banLeftMs() / 1000) + 'с (не спамим API)'
      this.bus.emit('top25:changed', this.snapshot())
      return
    }

    this.status = 'loading'
    this.error = null
    this.bus.emit('top25:changed', this.snapshot())
    try {
      var raw
      if (Gate && Gate.fetchJson) raw = await Gate.fetchJson(url)
      else {
        var res = await fetch(url)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        raw = await res.json()
      }
      if (seq !== this._seq) return
      this.rows = SA.parseTickers(raw, cfg.exchange)
      this.status = 'ok'
      this.error = null
      this.bus.emit('top25:changed', this.snapshot())
    } catch (e) {
      if (seq !== this._seq) return
      if (Gate) Gate.noteErrorMessage(e && e.message)
      this.status = 'error'
      this.error = e.message || 'Ошибка топ-25'
      this.bus.emit('top25:changed', this.snapshot())
    }
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(function () {
      self.load(false)
    }, this.status === 'error' ? 180000 : 120000)
  }

  Top25Agent.prototype.start = function () {
    var page = 'trade'
    try {
      page = localStorage.getItem('scalp-page-view') || 'trade'
    } catch (e) {}
    this._active = page === 'top25'
    this.bus.emit('top25:changed', this.snapshot())
    if (this._active) this.load(false)
  }

  Top25Agent.prototype.destroy = function () {
    if (this._timer) clearTimeout(this._timer)
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.Top25Agent = Top25Agent
})(typeof window !== 'undefined' ? window : globalThis)
