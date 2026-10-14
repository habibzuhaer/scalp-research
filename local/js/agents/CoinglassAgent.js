/* CoinglassAgent — уровни ликвидаций + ликвидности (Coinglass API / локальный стакан) */
(function (global) {
  'use strict'

  var DEFAULT = {
    apiKey: '',
    proxyUrl: '', // например http://127.0.0.1:4174  — если CORS
    exchange: 'Binance',
    range: '1d',
    liqTopN: 24,
    liqMinUsd: 500000,
    liquidityTopN: 20,
    liquidityMinUsd: 50000,
    useLocalBook: true,
  }

  function CoinglassAgent(bus, tickersAgent) {
    this.bus = bus
    this.tickers = tickersAgent
    this.state = Object.assign(
      {},
      DEFAULT,
      global.Scalp.Config.load(global.Scalp.Config.KEYS.coinglass, DEFAULT),
    )
    this.liquidations = []
    this.liquidity = []
    this.status = { liq: 'idle', liqcy: 'idle' }
    this.error = { liq: null, liqcy: null }
    this._timer = 0
    this._books = { spot: null, futures: null }
    this._bind()
  }

  CoinglassAgent.prototype._bind = function () {
    var self = this
    this.bus.on('coinglass:patch', function (p) {
      self.patch(p)
    })
    this.bus.on('coinglass:reload', function () {
      self.refresh(true)
    })
    this.bus.on('coinglass:set-estimate', function (levels) {
      self.setEstimatedLiquidations(levels)
    })
    this.bus.on('tickers:changed', function () {
      self.refresh(false)
    })
    this.bus.on('futures:market:book', function (book) {
      self._books.futures = book
      if (self.state.useLocalBook !== false) self._mergeLocalLiquidity()
    })
    this.bus.on('spot:market:book', function (book) {
      self._books.spot = book
      if (self.state.useLocalBook !== false) self._mergeLocalLiquidity()
    })
  }

  CoinglassAgent.prototype.get = function () {
    return Object.assign({}, this.state)
  }

  CoinglassAgent.prototype.snapshot = function () {
    return {
      state: this.get(),
      liquidations: this.liquidations.slice(),
      liquidity: this.liquidity.slice(),
      status: Object.assign({}, this.status),
      error: Object.assign({}, this.error),
    }
  }

  CoinglassAgent.prototype.patch = function (partial) {
    this.state = Object.assign({}, this.state, partial || {})
    try {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.coinglass, this.state)
    } catch (e) {}
    this.bus.emit('coinglass:changed', this.snapshot())
    if (
      partial &&
      (partial.apiKey != null ||
        partial.proxyUrl != null ||
        partial.range ||
        partial.exchange ||
        partial.liqTopN != null ||
        partial.liquidityTopN != null)
    ) {
      this.refresh(true)
    }
  }

  CoinglassAgent.prototype._symbol = function () {
    var t = this.tickers.get()
    var pane = t.futures || t.spot
    var src = (t.futures && t.futures.symbol) || (t.spot && t.spot.symbol) || 'btcusdt'
    return String(src).toUpperCase()
  }

  CoinglassAgent.prototype._exchangeName = function () {
    if (this.state.exchange) return this.state.exchange
    var t = this.tickers.get()
    var ex = (t.futures && t.futures.exchange) || (t.spot && t.spot.exchange) || 'binance'
    if (String(ex).indexOf('bybit') === 0) return 'Bybit'
    return 'Binance'
  }

  CoinglassAgent.prototype._cgFetch = async function (path, params) {
    var qs = Object.keys(params || {})
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
      })
      .join('&')
    var key = String(this.state.apiKey || '').trim()
    var proxy = String(this.state.proxyUrl || '').replace(/\/+$/, '')
    var headers = {}
    if (key) headers['CG-API-KEY'] = key

    async function attempt(url) {
      var res = await fetch(url, { headers: headers })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      var json = await res.json()
      if (json && String(json.code) !== '0' && json.code != null) {
        throw new Error(json.msg || 'Coinglass code ' + json.code)
      }
      return json && json.data != null ? json.data : json
    }

    var localUrl = (proxy || '') + '/cg' + path + (qs ? '?' + qs : '')
    try {
      return await attempt(localUrl)
    } catch (e1) {
      var direct = 'https://open-api-v4.coinglass.com' + path + (qs ? '?' + qs : '')
      return await attempt(direct)
    }
  }

  CoinglassAgent.prototype._parseLiqMap = function (data) {
    var map = data && data.data ? data.data : data
    if (!map || typeof map !== 'object') return []
    var out = []
    Object.keys(map).forEach(function (k) {
      var rows = map[k]
      if (!Array.isArray(rows)) return
      rows.forEach(function (row) {
        if (!Array.isArray(row) || row.length < 2) return
        var price = Number(row[0])
        var usd = Number(row[1])
        var lev = row[2] != null ? Number(row[2]) : null
        if (!isFinite(price) || !isFinite(usd) || usd <= 0) return
        out.push({ price: price, usd: usd, leverage: lev, side: null })
      })
    })
    out.sort(function (a, b) {
      return b.usd - a.usd
    })
    return out
  }

  CoinglassAgent.prototype._parseLargeOrders = function (data) {
    var list = Array.isArray(data) ? data : []
    var out = []
    for (var i = 0; i < list.length; i++) {
      var o = list[i]
      var price = Number(o.price)
      var usd = Number(o.current_usd_value != null ? o.current_usd_value : o.start_usd_value)
      var side = Number(o.order_side) === 1 ? 'bid' : Number(o.order_side) === 2 ? 'ask' : null
      if (!isFinite(price) || !isFinite(usd) || usd <= 0) continue
      out.push({ price: price, usd: usd, side: side, source: 'coinglass' })
    }
    out.sort(function (a, b) {
      return b.usd - a.usd
    })
    return out
  }

  CoinglassAgent.prototype._wallsFromBook = function (book, side) {
    if (!book || !book[side] || !book[side].length) return []
    var levels = book[side]
    var mid =
      book.bids && book.bids[0] && book.asks && book.asks[0]
        ? (book.bids[0].price + book.asks[0].price) / 2
        : levels[0].price
    var scored = levels.map(function (l) {
      return { price: l.price, qty: l.qty, usd: l.price * l.qty, side: side === 'bids' ? 'bid' : 'ask' }
    })
    scored.sort(function (a, b) {
      return b.usd - a.usd
    })
    var minUsd = Number(this.state.liquidityMinUsd) || 0
    var topN = Math.max(4, Math.min(40, Number(this.state.liquidityTopN) || 20))
    return scored
      .filter(function (x) {
        return x.usd >= minUsd && Math.abs(x.price - mid) / mid < 0.08
      })
      .slice(0, topN)
      .map(function (x) {
        return {
          price: x.price,
          usd: x.usd,
          side: x.side,
          source: 'local',
        }
      })
  }

  CoinglassAgent.prototype._mergeLocalLiquidity = function () {
    if (!this.state.useLocalBook) return
    // если уже есть coinglass-ликвидность — не затираем полностью, дополняем только без ключа
    if (this.state.apiKey && this.liquidity.some(function (x) {
      return x.source === 'coinglass'
    })) {
      return
    }
    var book = this._books.futures || this._books.spot
    if (!book) return
    var walls = this._wallsFromBook(book, 'bids').concat(this._wallsFromBook(book, 'asks'))
    walls.sort(function (a, b) {
      return b.usd - a.usd
    })
    this.liquidity = walls.slice(0, Math.max(4, Math.min(40, Number(this.state.liquidityTopN) || 20)))
    this.status.liqcy = 'local'
    this.error.liqcy = null
    this.bus.emit('coinglass:changed', this.snapshot())
  }

  CoinglassAgent.prototype._estimateLiqFromCandles = function (candles) {
    if (!candles || candles.length < 10) return []
    var last = candles[candles.length - 1]
    var hi = last.high
    var lo = last.low
    var n = Math.min(48, candles.length)
    for (var i = candles.length - n; i < candles.length; i++) {
      hi = Math.max(hi, candles[i].high)
      lo = Math.min(lo, candles[i].low)
    }
    var mid = last.close
    var lev = [5, 10, 25, 50, 100]
    var out = []
    lev.forEach(function (L) {
      // упрощённые уровни: лонги ликвидируются ниже, шорты выше
      var longLiq = mid * (1 - 1 / L)
      var shortLiq = mid * (1 + 1 / L)
      var swingLong = hi * (1 - 1 / L)
      var swingShort = lo * (1 + 1 / L)
      var weight = (2000000 / L) * (mid / 1000)
      ;[
        { price: longLiq, side: 'long' },
        { price: shortLiq, side: 'short' },
        { price: swingLong, side: 'long' },
        { price: swingShort, side: 'short' },
      ].forEach(function (x) {
        if (!isFinite(x.price) || x.price <= 0) return
        out.push({
          price: x.price,
          usd: weight,
          leverage: L,
          side: x.side,
          source: 'estimate',
        })
      })
    })
    out.sort(function (a, b) {
      return b.usd - a.usd
    })
    return out.slice(0, Math.max(8, Math.min(40, Number(this.state.liqTopN) || 24)))
  }

  CoinglassAgent.prototype.loadLiquidations = async function () {
    var self = this
    this.status.liq = 'loading'
    this.error.liq = null
    this.bus.emit('coinglass:changed', this.snapshot())
    try {
      if (!String(this.state.apiKey || '').trim()) {
        throw new Error('no-key')
      }
      var data = await this._cgFetch('/api/futures/liquidation/map', {
        exchange: this._exchangeName(),
        symbol: this._symbol(),
        range: this.state.range || '1d',
      })
      var parsed = this._parseLiqMap(data)
      var minUsd = Number(this.state.liqMinUsd) || 0
      parsed = parsed.filter(function (x) {
        return x.usd >= minUsd
      })
      this.liquidations = parsed
        .slice(0, Math.max(8, Math.min(60, Number(this.state.liqTopN) || 24)))
        .map(function (x) {
          x.source = 'coinglass'
          return x
        })
      this.status.liq = 'ok'
      this.error.liq = null
    } catch (e) {
      this.status.liq = e.message === 'no-key' ? 'estimate' : 'error'
      this.error.liq =
        e.message === 'no-key'
          ? 'Нет CG-API-KEY — оценка по свечам'
          : e.message || 'liq error'
      // оценка придёт из ChartAgent через coinglass:estimate-liq
      this.bus.emit('coinglass:need-estimate')
    }
    this.bus.emit('coinglass:changed', this.snapshot())
  }

  CoinglassAgent.prototype.setEstimatedLiquidations = function (levels) {
    if (!levels || !levels.length) return
    if (this.status.liq === 'ok' && this.liquidations.some(function (x) {
      return x.source === 'coinglass'
    })) {
      return
    }
    this.liquidations = levels
    this.status.liq = 'estimate'
    this.bus.emit('coinglass:changed', this.snapshot())
  }

  CoinglassAgent.prototype.loadLiquidity = async function () {
    this.status.liqcy = 'loading'
    this.error.liqcy = null
    this.bus.emit('coinglass:changed', this.snapshot())
    try {
      if (!String(this.state.apiKey || '').trim()) {
        throw new Error('no-key')
      }
      var data = await this._cgFetch('/api/futures/orderbook/large-limit-order', {
        exchange: this._exchangeName(),
        symbol: this._symbol(),
      })
      var parsed = this._parseLargeOrders(data)
      var minUsd = Number(this.state.liquidityMinUsd) || 0
      this.liquidity = parsed
        .filter(function (x) {
          return x.usd >= minUsd
        })
        .slice(0, Math.max(4, Math.min(40, Number(this.state.liquidityTopN) || 20)))
      this.status.liqcy = 'ok'
      this.error.liqcy = null
    } catch (e) {
      this.error.liqcy =
        e.message === 'no-key' ? 'Локальный стакан' : e.message || 'liquidity error'
      this._mergeLocalLiquidity()
      if (!this.liquidity.length) this.status.liqcy = e.message === 'no-key' ? 'local' : 'error'
    }
    this.bus.emit('coinglass:changed', this.snapshot())
  }

  CoinglassAgent.prototype.refresh = function (force) {
    var self = this
    this.loadLiquidations()
    this.loadLiquidity()
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(function () {
      self.refresh(false)
    }, force ? 90000 : 120000)
  }

  CoinglassAgent.prototype.start = function () {
    this.refresh(true)
  }

  CoinglassAgent.prototype.destroy = function () {
    if (this._timer) clearTimeout(this._timer)
  }

  // export helper for chart
  CoinglassAgent.estimateFromCandles = function (candles, topN) {
    var agent = { state: { liqTopN: topN || 24 }, _estimateLiqFromCandles: CoinglassAgent.prototype._estimateLiqFromCandles }
    return CoinglassAgent.prototype._estimateLiqFromCandles.call(agent, candles)
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.CoinglassAgent = CoinglassAgent
})(typeof window !== 'undefined' ? window : globalThis)
