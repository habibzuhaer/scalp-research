/* MarketAgent — WS partial depth + редкий REST через ExchangeGate */
(function (global) {
  'use strict'

  function MarketAgent(bus, apiAgent, settingsAgent) {
    this.bus = bus
    this.api = apiAgent
    this.settings = settingsAgent
    this.status = 'idle'
    this.error = null
    this.snapshot = { bids: [], asks: [], lastUpdateId: 0 }
    this._ws = null
    this._raf = 0
    this._retry = 0
    this._poll = 0
    this._cancelled = false
    this._bids = new Map()
    this._asks = new Map()
    this._lastId = 0
    this._failCount = 0
    this._wsLive = false
    this._bind()
  }

  MarketAgent.prototype._gate = function () {
    return global.Scalp.ExchangeGate
  }

  MarketAgent.prototype._bind = function () {
    var self = this
    this.bus.on('api:changed', function () {
      self.reconnect()
    })
    this.bus.on('market:resubscribe', function () {
      self.reconnect()
    })
    this.bus.on('market:reconnect', function () {
      self.reconnect()
    })
  }

  MarketAgent.prototype._isBybit = function () {
    var ex = this.api.get().exchange
    return ex === 'bybit' || ex === 'bybit-futures'
  }

  MarketAgent.prototype._setStatus = function (status, error) {
    this.status = status
    this.error = error || null
    this.bus.emit('market:status', { status: this.status, error: this.error })
  }

  MarketAgent.prototype._publish = function () {
    var bids = this._mapLevels(this._bids, 'bid')
    var asks = this._mapLevels(this._asks, 'ask')
    var clean = this._sanitize(bids, asks)
    this.snapshot = {
      bids: clean.bids,
      asks: clean.asks,
      lastUpdateId: this._lastId,
    }
    this.bus.emit('market:book', this.snapshot)
  }

  MarketAgent.prototype._mapLevels = function (book, side) {
    var levels = []
    book.forEach(function (qty, price) {
      if (qty > 0 && isFinite(price)) levels.push({ price: price, qty: qty })
    })
    levels.sort(function (a, b) {
      return side === 'bid' ? b.price - a.price : a.price - b.price
    })
    return levels.slice(0, 200)
  }

  MarketAgent.prototype._sanitize = function (bids, asks) {
    if (!bids.length || !asks.length) return { bids: bids, asks: asks }
    if (bids[0].price < asks[0].price) return { bids: bids, asks: asks }
    var mid = (bids[0].price + asks[0].price) / 2
    return {
      bids: bids.filter(function (l) {
        return l.price < mid
      }),
      asks: asks.filter(function (l) {
        return l.price > mid
      }),
    }
  }

  MarketAgent.prototype._replaceBook = function (bids, asks, lastId) {
    this._bids = new Map()
    this._asks = new Map()
    var i
    for (i = 0; i < (bids || []).length; i++) {
      var bp = Number(bids[i][0])
      var bq = Number(bids[i][1])
      if (bq > 0 && isFinite(bp)) this._bids.set(bp, bq)
    }
    for (i = 0; i < (asks || []).length; i++) {
      var ap = Number(asks[i][0])
      var aq = Number(asks[i][1])
      if (aq > 0 && isFinite(ap)) this._asks.set(ap, aq)
    }
    this._lastId = Number(lastId) || Date.now()
    this._publish()
  }

  MarketAgent.prototype._parseRest = function (data) {
    if (this._isBybit()) {
      var r = (data && data.result) || {}
      return {
        lastUpdateId: Number(r.u || r.ts || Date.now()),
        bids: r.b || [],
        asks: r.a || [],
      }
    }
    return {
      lastUpdateId: Number((data && data.lastUpdateId) || 0),
      bids: (data && data.bids) || [],
      asks: (data && data.asks) || [],
    }
  }

  MarketAgent.prototype._symbol = function () {
    if (this.api.resolveSymbol) return this.api.resolveSymbol(this.settings.symbol)
    return this.settings.symbol
  }

  MarketAgent.prototype._depthUrl = function (soft) {
    var url = this.api.depthRestUrl(this._symbol())
    var gate = this._gate()
    if (soft || this._failCount > 0 || (gate && gate.banned())) {
      url = url.replace(/([?&])limit=\d+/, '$1limit=100')
      if (url.indexOf('limit=') === -1) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'limit=100'
      }
    }
    return url
  }

  MarketAgent.prototype._fetchJson = async function (url) {
    var gate = this._gate()
    if (gate && gate.fetchJson) return gate.fetchJson(url)
    var res = await fetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
  }

  MarketAgent.prototype._loadSnapshot = async function (soft) {
    var raw = await this._fetchJson(this._depthUrl(soft))
    if (this._cancelled) return
    if (!raw) throw new Error('Пустой ответ depth')
    if (raw.code != null && Number(raw.code) < 0) {
      throw new Error(raw.msg || 'Depth error ' + raw.code)
    }
    var data = this._parseRest(raw)
    if (!(data.bids && data.bids.length) && !(data.asks && data.asks.length)) {
      throw new Error('Стакан пуст · ' + String(this._symbol()).toUpperCase())
    }
    this._replaceBook(data.bids, data.asks, data.lastUpdateId)
    this._failCount = 0
    this._setStatus('live')
  }

  MarketAgent.prototype.stop = function () {
    this._cancelled = true
    this._wsLive = false
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = 0
    if (this._retry) clearTimeout(this._retry)
    this._retry = 0
    if (this._poll) clearTimeout(this._poll)
    this._poll = 0
    if (this._ws) {
      this._ws.onclose = null
      this._ws.onmessage = null
      this._ws.onerror = null
      try {
        this._ws.close()
      } catch (e) {}
      this._ws = null
    }
  }

  MarketAgent.prototype.reconnect = function () {
    this.stop()
    this._cancelled = false
    this._failCount = 0
    this.connect()
  }

  MarketAgent.prototype._startSoftRest = function () {
    var self = this
    var tick = async function () {
      if (self._cancelled) return
      var gate = self._gate()
      // Bybit не в общем ban Binance, но всё равно не долбим
      if (gate && gate.banned() && !self._isBybit()) {
        self._setStatus('error', 'HTTP 418 · пауза ещё ' + Math.ceil(gate.banLeftMs() / 1000) + 'с')
        self._poll = setTimeout(tick, Math.max(1000, gate.banLeftMs()))
        return
      }
      var base = self._isBybit() ? 1500 : self._wsLive ? 10000 : 4000
      try {
        await self._loadSnapshot(true)
      } catch (e) {
        self._failCount++
        if (!self._cancelled && !self._wsLive) {
          self._setStatus('error', (e && e.message) || 'Ошибка depth')
        }
      }
      if (self._cancelled) return
      var delay = base
      if (self._failCount > 0) delay = Math.min(60000, base * (1 + self._failCount))
      self._poll = setTimeout(tick, delay)
    }
    tick()
  }

  MarketAgent.prototype._openWs = function () {
    if (this._isBybit()) return
    var self = this
    var url = this.api.depthWsUrl(this._symbol())
    try {
      this._ws = new WebSocket(url)
    } catch (e) {
      return
    }
    this._ws.onmessage = function (ev) {
      if (self._cancelled) return
      try {
        var msg = JSON.parse(ev.data)
        if (msg && msg.data && (msg.data.bids || msg.data.asks)) msg = msg.data
        if (msg && (msg.bids || msg.asks)) {
          self._replaceBook(msg.bids || [], msg.asks || [], msg.lastUpdateId)
          self._wsLive = true
          self._failCount = 0
          self._setStatus('live')
        }
      } catch (err) {}
    }
    this._ws.onclose = function () {
      self._wsLive = false
      if (self._cancelled) return
      self._retry = setTimeout(function () {
        if (!self._cancelled) self._openWs()
      }, 5000)
    }
    this._ws.onerror = function () {
      self._wsLive = false
    }
  }

  MarketAgent.prototype.connect = function () {
    var self = this
    this._setStatus('connecting')
    if (this._isBybit()) {
      this._startSoftRest()
      return
    }
    this._loadSnapshot(true)
      .catch(function (e) {
        if (!self._cancelled) self._setStatus('connecting', e.message)
      })
      .then(function () {
        if (self._cancelled) return
        self._openWs()
        self._startSoftRest()
      })
  }

  MarketAgent.prototype.start = function () {
    this.connect()
  }

  global.Scalp.MarketAgent = MarketAgent
})(typeof window !== 'undefined' ? window : globalThis)
