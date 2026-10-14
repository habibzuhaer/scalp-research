/* ChartAgent — свечи, индикаторы, инструменты рисования */
(function (global) {
  'use strict'

  function ChartAgent(bus, tickersAgent, root, opts) {
    this.bus = bus
    this.tickers = tickersAgent
    this.root = root
    this.opts = opts || {}
    this.id = this.opts.id || 'main'
    this.isolated = !!this.opts.isolated
    this._storageKey = this.opts.storageKey || global.Scalp.Config.KEYS.chart
    var defaults = global.Scalp.Config.DEFAULT_CHART
    if (this.isolated) {
      defaults = Object.assign({}, defaults, {
        interval: '1h',
        showRsi: false,
        limit: 180,
      })
    }
    this.state = global.Scalp.Config.load(this._storageKey, defaults)
    this._symbolOverride = this.isolated
      ? String(this.state.symbol || this.opts.symbol || '').toLowerCase()
      : ''
    this.candles = []
    this.ind = {}
    this.drawings = []
    this.status = 'idle'
    this.error = null
    this._hover = null
    this._pendingPoint = null
    this._timer = 0
    this._ws = null
    this._wsRetry = 0
    this._raf = 0
    this._drag = null
    this._pulse = 0
    this._anim = 0
    this.view = { start: 0, count: 0, follow: true }
    this._range = { start: 0, end: 0, count: 0 }
    this.cg = { liquidations: [], liquidity: [], status: {}, error: {} }
    this._bind()
  }

  ChartAgent.prototype._bind = function () {
    var self = this
    if (this.isolated) {
      this.bus.on('tickers:changed', function () {
        if (self._paused || self._destroyed) return
        var pane = self._pane()
        var key = (pane.exchange || '') + '|' + (pane.restBaseUrl || '')
        if (key === self._exKey) return
        self._exKey = key
        self.load({ soft: true })
      })
      return
    }
    this.bus.on('chart:patch', function (partial) {
      self.patch(partial)
    })
    this.bus.on('chart:set-tool', function (tool) {
      self.patch({ tool: tool })
    })
    this.bus.on('chart:clear-drawings', function () {
      self.drawings = []
      self.render()
    })
    this.bus.on('chart:reload', function () {
      self.load()
    })
    this.bus.on('chart:reset', function () {
      self.state = Object.assign({}, global.Scalp.Config.DEFAULT_CHART)
      global.Scalp.Config.save(global.Scalp.Config.KEYS.chart, self.state)
      self.bus.emit('chart:changed', self.get())
      self.load()
    })
    this.bus.on('tickers:changed', function () {
      self.load()
    })
    this.bus.on('chart:zoom', function (dir) {
      self.zoom(dir || 1)
    })
    this.bus.on('chart:follow', function (on) {
      self.view.follow = on !== false
      self._scheduleRender()
    })
    this.bus.on('coinglass:changed', function (snap) {
      self.cg = snap || self.cg
      self._scheduleRender()
    })
    this.bus.on('coinglass:need-estimate', function () {
      if (!self.candles.length) return
      var levels = global.Scalp.CoinglassAgent.estimateFromCandles(self.candles, 24)
      self.bus.emit('coinglass:set-estimate', levels)
    })
  }

  ChartAgent.prototype._bucketMs = function () {
    var meta = this._intervalMeta()
    if (meta.sec) return meta.sec * 1000
    var map = {
      '1m': 60000,
      '3m': 180000,
      '5m': 300000,
      '15m': 900000,
      '30m': 1800000,
      '1h': 3600000,
      '2h': 7200000,
      '4h': 14400000,
      '6h': 21600000,
      '12h': 43200000,
      '1d': 86400000,
      '1w': 604800000,
    }
    return map[meta.id] || 60000
  }

  ChartAgent.prototype._visibleRange = function () {
    var n = this.candles.length
    if (!n) return { start: 0, end: 0, count: 0 }
    var count = Math.max(20, Math.min(n, this.view.count || n))
    var start
    if (this.view.follow) {
      start = Math.max(0, n - count)
    } else {
      start = Math.max(0, Math.min(this.view.start, Math.max(0, n - count)))
    }
    this.view.start = start
    this.view.count = count
    return { start: start, end: start + count, count: count }
  }

  ChartAgent.prototype.zoom = function (dir, pivotIdx) {
    var n = this.candles.length
    if (!n) return
    var range = this._visibleRange()
    var pivot = pivotIdx != null ? pivotIdx : range.start + Math.floor(range.count / 2)
    var next = Math.round(range.count * (dir > 0 ? 0.8 : 1.25))
    next = Math.max(20, Math.min(n, next))
    var leftRatio = (pivot - range.start) / Math.max(1, range.count)
    this.view.count = next
    this.view.start = Math.round(pivot - leftRatio * next)
    this.view.follow = this.view.start + next >= n - 2
    this._scheduleRender()
  }

  ChartAgent.prototype.pan = function (dxBars) {
    var n = this.candles.length
    if (!n) return
    var range = this._visibleRange()
    this.view.follow = false
    this.view.start = Math.max(0, Math.min(n - range.count, range.start + dxBars))
    if (this.view.start + range.count >= n - 1) this.view.follow = true
    this._scheduleRender()
  }

  ChartAgent.prototype._scheduleRender = function () {
    var self = this
    if (this._raf) return
    this._raf = requestAnimationFrame(function () {
      self._raf = 0
      self.render()
    })
  }

  ChartAgent.prototype._startPulse = function () {
    // CSS handles pulse on price tag — no full redraw loop
    if (this.el && this.el.priceTag) {
      this.el.priceTag.classList.add('pulse')
    }
  }

  ChartAgent.prototype._disconnectLive = function () {
    if (this._ws) {
      try {
        this._ws.onclose = null
        this._ws.close()
      } catch (e) {}
      this._ws = null
    }
    this._liveKey = null
    if (this._anim) {
      clearInterval(this._anim)
      this._anim = 0
    }
  }

  ChartAgent.prototype._liveKeyNow = function () {
    var pane = this._pane()
    return [pane.exchange, pane.symbol, this.state.interval, this.state.source].join('|')
  }

  ChartAgent.prototype._wsUrl = function () {
    var pane = this._pane()
    var base = String(pane.wsBaseUrl || '').replace(/\/+$/, '')
    var sym = String(pane.symbol || 'btcusdt').toLowerCase()
    var meta = this._intervalMeta()
    var interval = meta.sec ? '1s' : meta.id
    if (pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') {
      return base + (pane.exchange === 'bybit-futures' ? '/v5/public/linear' : '/v5/public/spot')
    }
    if (pane.exchange === 'binance-futures' || pane.market === 'futures') {
      if (meta.sec) return base + '/ws/' + sym + '@aggTrade'
      return base + '/ws/' + sym + '@kline_' + interval
    }
    if (meta.sec && meta.sec !== 1) return base + '/ws/' + sym + '@kline_1s'
    if (meta.sec === 1) return base + '/ws/' + sym + '@kline_1s'
    return base + '/ws/' + sym + '@kline_' + interval
  }

  ChartAgent.prototype._connectLive = function () {
    var self = this
    if (this.state.liveWs === false) {
      this._disconnectLive()
      return
    }
    var key = this._liveKeyNow()
    if (this._ws && (this._ws.readyState === 0 || this._ws.readyState === 1) && this._liveKey === key) {
      return
    }
    this._disconnectLive()
    var pane = this._pane()
    var url = this._wsUrl()
    if (!url || (url.indexOf('wss') !== 0 && url.indexOf('ws') !== 0)) return
    try {
      var ws = new WebSocket(url)
      this._ws = ws
      this._liveKey = key
      ws.onopen = function () {
        self._wsRetry = 0
        self.status = 'live'
        self._paintStatus()
        if (pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') {
          var meta = self._intervalMeta()
          var iv = meta.bybit || '1'
          var sym = String(pane.symbol || 'BTCUSDT').toUpperCase()
          if (meta.sec && meta.sec !== 1) {
            ws.send(JSON.stringify({ op: 'subscribe', args: ['publicTrade.' + sym] }))
          } else if (meta.sec === 1) {
            // Bybit has no 1s kline — use trades
            ws.send(JSON.stringify({ op: 'subscribe', args: ['publicTrade.' + sym] }))
          } else {
            ws.send(JSON.stringify({ op: 'subscribe', args: ['kline.' + iv + '.' + sym] }))
          }
        }
        self._startPulse()
      }
      ws.onmessage = function (ev) {
        self._onLiveMessage(ev.data)
      }
      ws.onclose = function () {
        if (self._ws === ws) self._ws = null
        if (self._destroyed) return
        if (self._liveKey !== key) return
        self._wsRetry = Math.min(6, (self._wsRetry || 0) + 1)
        setTimeout(function () {
          if (!self._destroyed && self._liveKey === key) self._connectLive()
        }, 1500 * self._wsRetry)
      }
      ws.onerror = function () {
        try {
          ws.close()
        } catch (e) {}
      }
    } catch (e) {
      /* poll fallback */
    }
  }

  ChartAgent.prototype._onLiveMessage = function (raw) {
    try {
      var msg = typeof raw === 'string' ? JSON.parse(raw) : raw
      var pane = this._pane()
      var meta = this._intervalMeta()

      if (pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') {
        var topic = msg.topic || ''
        if (topic.indexOf('kline.') === 0 && msg.data && msg.data[0]) {
          var k = msg.data[0]
          this._upsertCandle({
            time: Number(k.start),
            open: Number(k.open),
            high: Number(k.high),
            low: Number(k.low),
            close: Number(k.close),
            volume: Number(k.volume),
          })
          return
        }
        if (topic.indexOf('publicTrade.') === 0 && msg.data) {
          ;(msg.data || []).forEach(
            function (t) {
              this._applyTrade(Number(t.T || t.time), Number(t.p || t.price), Number(t.v || t.size))
            }.bind(this),
          )
          return
        }
        return
      }

      // Binance
      if (msg.e === 'kline' && msg.k) {
        var bk = msg.k
        var candle = {
          time: Number(bk.t),
          open: Number(bk.o),
          high: Number(bk.h),
          low: Number(bk.l),
          close: Number(bk.c),
          volume: Number(bk.v),
        }
        if (meta.sec && meta.sec > 1) {
          this._applyTrade(candle.time, candle.close, 0)
          // also merge 1s into bucket via trade-like update using OHLC of 1s bar
          this._mergeSecBucket(candle, meta.sec * 1000)
        } else {
          this._upsertCandle(candle)
        }
        return
      }
      if (msg.e === 'aggTrade') {
        this._applyTrade(Number(msg.T), Number(msg.p), Number(msg.q))
      }
    } catch (e) {}
  }

  ChartAgent.prototype._mergeSecBucket = function (secCandle, bucketMs) {
    var bucket = Math.floor(secCandle.time / bucketMs) * bucketMs
    var last = this.candles[this.candles.length - 1]
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, secCandle.high)
      last.low = Math.min(last.low, secCandle.low)
      last.close = secCandle.close
      last.volume += secCandle.volume
    } else if (!last || bucket > last.time) {
      this._upsertCandle({
        time: bucket,
        open: secCandle.open,
        high: secCandle.high,
        low: secCandle.low,
        close: secCandle.close,
        volume: secCandle.volume,
      })
    }
    this._recompute()
    this._scheduleRender()
  }

  ChartAgent.prototype._applyTrade = function (time, price, qty) {
    if (!Number.isFinite(price) || !Number.isFinite(time)) return
    var bucketMs = this._bucketMs()
    var bucket = Math.floor(time / bucketMs) * bucketMs
    var last = this.candles[this.candles.length - 1]
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, price)
      last.low = Math.min(last.low, price)
      last.close = price
      last.volume += qty || 0
    } else if (!last || bucket > last.time) {
      this._upsertCandle({
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: qty || 0,
      })
      return
    }
    this._recompute()
    this._scheduleRender()
    if (this.el && this.el.meta) {
      var pane = this._pane()
      this.el.meta.textContent =
        pane.symbol.toUpperCase() + ' · ' + this.state.interval + ' · ' + this._fmtPrice(price) + ' ●'
    }
  }

  ChartAgent.prototype._upsertCandle = function (c) {
    var last = this.candles[this.candles.length - 1]
    if (last && last.time === c.time) {
      last.open = c.open
      last.high = c.high
      last.low = c.low
      last.close = c.close
      last.volume = c.volume
    } else if (!last || c.time > last.time) {
      this.candles.push(c)
      var limit = Math.min(1000, this.state.limit || 180)
      if (this.candles.length > limit + 50) {
        this.candles = this.candles.slice(this.candles.length - limit)
      }
      // не форсим follow — иначе зум/пан сразу сбрасывается на live
    } else {
      return
    }
    this._recompute()
    this._scheduleRender()
  }

  ChartAgent.prototype.get = function () {
    return JSON.parse(JSON.stringify(this.state))
  }

  ChartAgent.prototype.patch = function (partial) {
    if (partial.indicators) {
      this.state.indicators = Object.assign({}, this.state.indicators, partial.indicators)
      delete partial.indicators
    }
    this.state = Object.assign({}, this.state, partial)
    this._persist()
    this._recompute()
    this.render()
    if (partial.source || partial.interval || partial.limit || partial.symbol) this.load()
    if (partial.liveWs === false) this._disconnectLive()
    else if (partial.liveWs === true) this._connectLive()
    if (partial.followLive === true) {
      this.view.follow = true
      this._scheduleRender()
    }
  }

  ChartAgent.prototype._persist = function () {
    if (this.isolated) this.state.symbol = this._symbolOverride || this.state.symbol || ''
    try {
      global.Scalp.Config.save(this._storageKey, this.state)
    } catch (e) {}
    if (!this.isolated) this.bus.emit('chart:changed', this.get())
  }

  ChartAgent.prototype.setSymbol = function (symbol) {
    this._symbolOverride = String(symbol || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    this.state.symbol = this._symbolOverride
    this._persist()
    this.load()
  }

  ChartAgent.prototype._pane = function () {
    var pane = this.tickers.getPane(this.state.source === 'futures' ? 'futures' : 'spot')
    if (this._symbolOverride) {
      pane = Object.assign({}, pane, { symbol: this._symbolOverride })
    }
    return pane
  }

  ChartAgent.prototype._intervalMeta = function () {
    var id = this.state.interval || '1m'
    var found = null
    global.Scalp.Config.CHART_INTERVALS.forEach(function (x) {
      if (x.id === id) found = x
    })
    return found || { id: id, label: id, bybit: '1' }
  }

  ChartAgent.prototype._refreshMs = function () {
    var meta = this._intervalMeta()
    if (meta.sec) return Math.max(1000, meta.sec * 1000)
    if (meta.id === '1m' || meta.id === '3m') return 8000
    if (meta.id === '5m' || meta.id === '15m') return 15000
    return 30000
  }

  ChartAgent.prototype._klinesUrl = function (forceInterval) {
    var pane = this._pane()
    var base = String(pane.restBaseUrl || '').replace(/\/+$/, '')
    var sym = String(pane.symbol || 'btcusdt').toUpperCase()
    var interval = forceInterval || this.state.interval || '1m'
    var limit = Math.min(1000, this.state.limit || 180)
    if (pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') {
      var iv = '1'
      global.Scalp.Config.CHART_INTERVALS.forEach(function (x) {
        if (x.id === interval && x.bybit) iv = x.bybit
      })
      var cat = pane.exchange === 'bybit-futures' ? 'linear' : 'spot'
      return (
        base +
        '/v5/market/kline?category=' +
        cat +
        '&symbol=' +
        sym +
        '&interval=' +
        iv +
        '&limit=' +
        limit
      )
    }
    if (pane.exchange === 'binance-futures' || pane.market === 'futures') {
      return base + '/fapi/v1/klines?symbol=' + sym + '&interval=' + interval + '&limit=' + limit
    }
    return base + '/api/v3/klines?symbol=' + sym + '&interval=' + interval + '&limit=' + limit
  }

  ChartAgent.prototype._tradesUrl = function () {
    var pane = this._pane()
    var base = String(pane.restBaseUrl || '').replace(/\/+$/, '')
    var sym = String(pane.symbol || 'btcusdt').toUpperCase()
    if (pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') {
      var cat = pane.exchange === 'bybit-futures' ? 'linear' : 'spot'
      return base + '/v5/market/recent-trade?category=' + cat + '&symbol=' + sym + '&limit=1000'
    }
    if (pane.exchange === 'binance-futures' || pane.market === 'futures') {
      return base + '/fapi/v1/aggTrades?symbol=' + sym + '&limit=1000'
    }
    return base + '/api/v3/aggTrades?symbol=' + sym + '&limit=1000'
  }

  ChartAgent.prototype._parseTrades = function (raw, exchange) {
    if (exchange === 'bybit' || exchange === 'bybit-futures') {
      return ((raw && raw.result && raw.result.list) || [])
        .map(function (t) {
          return { time: Number(t.time), price: Number(t.price), qty: Number(t.size) }
        })
        .sort(function (a, b) {
          return a.time - b.time
        })
    }
    return (raw || [])
      .map(function (t) {
        return { time: Number(t.T), price: Number(t.p), qty: Number(t.q) }
      })
      .sort(function (a, b) {
        return a.time - b.time
      })
  }

  ChartAgent.prototype._aggregateByMs = function (candles, bucketMs) {
    if (!candles.length || bucketMs <= 1000) return candles
    var out = []
    var cur = null
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i]
      var bucket = Math.floor(c.time / bucketMs) * bucketMs
      if (!cur || cur.time !== bucket) {
        if (cur) out.push(cur)
        cur = {
          time: bucket,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }
      } else {
        cur.high = Math.max(cur.high, c.high)
        cur.low = Math.min(cur.low, c.low)
        cur.close = c.close
        cur.volume += c.volume
      }
    }
    if (cur) out.push(cur)
    return out
  }

  ChartAgent.prototype._tradesToCandles = function (trades, sec, limit) {
    var bucketMs = sec * 1000
    var map = {}
    var keys = []
    for (var i = 0; i < trades.length; i++) {
      var t = trades[i]
      var bucket = Math.floor(t.time / bucketMs) * bucketMs
      if (!map[bucket]) {
        map[bucket] = {
          time: bucket,
          open: t.price,
          high: t.price,
          low: t.price,
          close: t.price,
          volume: t.qty,
        }
        keys.push(bucket)
      } else {
        var c = map[bucket]
        c.high = Math.max(c.high, t.price)
        c.low = Math.min(c.low, t.price)
        c.close = t.price
        c.volume += t.qty
      }
    }
    keys.sort(function (a, b) {
      return a - b
    })
    var out = keys.map(function (k) {
      return map[k]
    })
    if (out.length > limit) out = out.slice(out.length - limit)
    return out
  }

  ChartAgent.prototype._parseKlines = function (raw, exchange) {
    if (exchange === 'bybit' || exchange === 'bybit-futures') {
      var list = ((raw && raw.result && raw.result.list) || []).slice().reverse()
      return list.map(function (r) {
        return {
          time: Number(r[0]),
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
          volume: Number(r[5]),
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
        volume: Number(r[5]),
      }
    })
  }

  ChartAgent.prototype.load = async function (opts) {
    var self = this
    opts = opts || {}
    var soft = !!opts.soft
    this._loadSeq = (this._loadSeq || 0) + 1
    var seq = this._loadSeq
    if (this._paused || this._destroyed) return
    if (!soft) {
      this.status = 'loading'
      this._paintStatus()
    }
    try {
      var pane = this._pane()
      var meta = this._intervalMeta()
      var limit = Math.min(1000, this.state.limit || 180)
      var candles

      if (meta.sec) {
        if (pane.exchange === 'binance') {
          var res1 = await fetch(this._klinesUrl('1s'))
          if (!res1.ok) throw new Error('Klines HTTP ' + res1.status)
          var raw1 = await res1.json()
          candles = this._parseKlines(raw1, pane.exchange)
          if (meta.sec > 1) candles = this._aggregateByMs(candles, meta.sec * 1000)
          if (candles.length > limit) candles = candles.slice(candles.length - limit)
        } else {
          var tres = await fetch(this._tradesUrl())
          if (!tres.ok) throw new Error('Trades HTTP ' + tres.status)
          var traw = await tres.json()
          var trades = this._parseTrades(traw, pane.exchange)
          candles = this._tradesToCandles(trades, meta.sec, limit)
          if (!candles.length) throw new Error('Мало сделок для ' + meta.label)
        }
      } else {
        if ((pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') && !meta.bybit) {
          throw new Error('ТФ ' + meta.label + ' не поддерживается Bybit')
        }
        var res = await fetch(this._klinesUrl())
        if (!res.ok) throw new Error('Klines HTTP ' + res.status)
        var raw = await res.json()
        candles = this._parseKlines(raw, pane.exchange)
      }

      if (seq !== this._loadSeq) return

      var prevCount = this.view.count
      var prevFollow = this.view.follow
      this.candles = candles
      // preserve zoom on soft refresh / keep sensible window
      if (soft && prevCount > 0) {
        this.view.count = Math.min(candles.length, prevCount)
        this.view.follow = prevFollow
      } else if (!this.view.count || this.view.count > candles.length) {
        this.view.count = candles.length
        this.view.follow = this.state.followLive !== false
      }
      this._recompute()
      this.status = 'live'
      this.error = null
      this.render()
      this.bus.emit('chart:candles', { count: this.candles.length, pane: pane })
      this._connectLive()
      if (this.isolated) {
        this._applyLocalLevels()
        this._loadVizLiquidity()
        this._scheduleRender()
      } else if (this.state.showLiqLevels !== false) {
        var st = this.cg && this.cg.status && this.cg.status.liq
        if (st !== 'ok') {
          var est = global.Scalp.CoinglassAgent.estimateFromCandles(this.candles, 24)
          this.bus.emit('coinglass:set-estimate', est)
        }
      }
    } catch (e) {
      if (seq !== this._loadSeq) return
      this.status = 'error'
      this.error = e.message || 'Ошибка графика'
      this._paintStatus()
    }
    if (this._timer) clearTimeout(this._timer)
    var liveOk = this._ws && (this._ws.readyState === 0 || this._ws.readyState === 1)
    var delay
    if (this.state.liveWs === false) {
      delay = Math.max(5000, this._refreshMs())
    } else if (liveOk) {
      delay = 120000
    } else {
      delay = Math.max(8000, this._refreshMs() * 2)
    }
    this._timer = setTimeout(function () {
      if (!self._destroyed && !self._paused) self.load({ soft: true })
    }, delay)
  }

  ChartAgent.prototype._vizWalls = function (book, side) {
    if (!book || !book[side] || !book[side].length) return []
    var levels = book[side]
    var mid =
      book.bids && book.bids[0] && book.asks && book.asks[0]
        ? (book.bids[0].price + book.asks[0].price) / 2
        : levels[0].price
    if (!(mid > 0)) return []
    return levels
      .map(function (l) {
        return {
          price: l.price,
          qty: l.qty,
          usd: l.price * l.qty,
          side: side === 'bids' ? 'bid' : 'ask',
          source: 'local',
        }
      })
      .filter(function (x) {
        return x.usd >= 8000 && Math.abs(x.price - mid) / mid < 0.08
      })
      .sort(function (a, b) {
        return b.usd - a.usd
      })
      .slice(0, 10)
  }

  ChartAgent.prototype._applyLocalLevels = function () {
    if (!this.isolated) return
    var liq = []
    if (this.state.showLiqLevels !== false && this.candles.length) {
      liq = global.Scalp.CoinglassAgent.estimateFromCandles(this.candles, 24)
    }
    this.cg = {
      liquidations: liq,
      liquidity:
        this.state.showLiquidityLevels === false ? [] : (this.cg && this.cg.liquidity) || [],
      status: {
        liq: liq.length ? 'ok' : 'idle',
        liqcy: (this.cg && this.cg.status && this.cg.status.liqcy) || 'idle',
      },
      error: {},
    }
  }

  ChartAgent.prototype._loadVizLiquidity = async function () {
    if (!this.isolated || this.state.showLiquidityLevels === false) return
    var pane = this._pane()
    var base = String((pane && pane.restBaseUrl) || '').replace(/\/+$/, '')
    var sym = String((pane && pane.symbol) || '').toUpperCase()
    if (!base || !sym) return
    var url
    if (pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') {
      var cat = pane.exchange === 'bybit-futures' ? 'linear' : 'spot'
      url = base + '/v5/market/orderbook?category=' + cat + '&symbol=' + encodeURIComponent(sym) + '&limit=25'
    } else if (pane.exchange === 'binance-futures' || pane.market === 'futures') {
      url = base + '/fapi/v1/depth?symbol=' + encodeURIComponent(sym) + '&limit=20'
    } else {
      url = base + '/api/v3/depth?symbol=' + encodeURIComponent(sym) + '&limit=20'
    }
    try {
      var Gate = global.Scalp.ExchangeGate
      var raw
      if (Gate && Gate.fetchJson) raw = await Gate.fetchJson(url)
      else {
        var res = await fetch(url)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        raw = await res.json()
      }
      var bids = []
      var asks = []
      if (raw && raw.result && (raw.result.b || raw.result.a)) {
        bids = (raw.result.b || []).map(function (x) {
          return { price: Number(x[0]), qty: Number(x[1]) }
        })
        asks = (raw.result.a || []).map(function (x) {
          return { price: Number(x[0]), qty: Number(x[1]) }
        })
      } else {
        bids = (raw.bids || []).map(function (x) {
          return { price: Number(x[0]), qty: Number(x[1]) }
        })
        asks = (raw.asks || []).map(function (x) {
          return { price: Number(x[0]), qty: Number(x[1]) }
        })
      }
      var book = { bids: bids, asks: asks }
      var walls = this._vizWalls(book, 'bids').concat(this._vizWalls(book, 'asks'))
      walls.sort(function (a, b) {
        return b.usd - a.usd
      })
      this.cg = this.cg || { liquidations: [], liquidity: [], status: {}, error: {} }
      this.cg.liquidity = walls.slice(0, 16)
      this.cg.status = Object.assign({}, this.cg.status, { liqcy: 'ok' })
      this._scheduleRender()
    } catch (e) {}
  }

  ChartAgent.prototype.pause = function () {
    this._paused = true
    if (this._timer) clearTimeout(this._timer)
    this._disconnectLive()
  }

  ChartAgent.prototype.resume = function () {
    this._paused = false
    this.load({ soft: true })
  }

  ChartAgent.prototype._recompute = function () {
    this.ind = global.Scalp.Indicators.compute(this.candles, this.state.indicators || {})
  }

  ChartAgent.prototype.mount = function () {
    var tools = global.Scalp.Config.CHART_TOOLS || []
    var VIZ_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']
    var head
    if (this.isolated) {
      var tfs = VIZ_TFS.map(function (id) {
        return (
          '<button type="button" class="chart-tf" data-tf="' +
          id +
          '">' +
          id +
          '</button>'
        )
      }).join('')
      head = [
        '<div class="chart-toolbar viz-toolbar">',
        '  <input data-el="symbol" class="chart-sym-input" spellcheck="false" autocomplete="off" placeholder="тикер" title="Тикер">',
        '  <select data-el="source" title="Рынок"></select>',
        '  <div class="chart-tfs" data-el="tfs">' + tfs + '</div>',
        '  <div class="chart-tools">',
        tools
          .map(function (t) {
            return (
              '<button type="button" class="tool-btn" data-tool="' +
              t.id +
              '" title="' +
              t.label +
              '">' +
              t.icon +
              '</button>'
            )
          })
          .join(''),
        '    <button type="button" class="tool-btn" data-act="zoom-out" title="Отдалить">−</button>',
        '    <button type="button" class="tool-btn" data-act="zoom-in" title="Приблизить">+</button>',
        '    <button type="button" class="tool-btn" data-act="follow" title="Следить за ценой">◉</button>',
        '    <button type="button" class="tool-btn" data-act="liq" title="Уровни ликвидаций">Liq</button>',
        '    <button type="button" class="tool-btn" data-act="liqcy" title="Уровни ликвидности">Liq¢</button>',
        '    <button type="button" class="tool-btn" data-act="clear" title="Очистить рисунки">⌫</button>',
        '  </div>',
        '  <span class="chart-meta" data-el="meta">—</span>',
        '  <span class="status-dot" data-el="dot"></span>',
        '</div>',
      ].join('')
    } else {
      head = [
        '<div class="chart-toolbar">',
        '  <select data-el="source" title="Источник"></select>',
        '  <select data-el="interval" title="Таймфрейм"></select>',
        '  <div class="chart-tools">',
        tools
          .map(function (t) {
            return (
              '<button type="button" class="tool-btn" data-tool="' +
              t.id +
              '" title="' +
              t.label +
              '">' +
              t.icon +
              '</button>'
            )
          })
          .join(''),
        '    <button type="button" class="tool-btn" data-act="zoom-out" title="Отдалить">−</button>',
        '    <button type="button" class="tool-btn" data-act="zoom-in" title="Приблизить">+</button>',
        '    <button type="button" class="tool-btn" data-act="follow" title="Следить за ценой">◉</button>',
        '    <button type="button" class="tool-btn" data-act="liq" title="Уровни ликвидаций (Coinglass)">Liq</button>',
        '    <button type="button" class="tool-btn" data-act="liqcy" title="Уровни ликвидности (крупные ордера)">Liq¢</button>',
        '    <button type="button" class="tool-btn" data-act="clear" title="Очистить рисунки">⌫</button>',
        '    <button type="button" class="tool-btn" data-act="settings" title="Индикаторы">⚙</button>',
        '  </div>',
        '  <span class="chart-meta" data-el="meta">—</span>',
        '  <span class="status-dot" data-el="dot"></span>',
        '</div>',
      ].join('')
    }
    this.root.innerHTML =
      head +
      [
        '<div class="chart-canvas-wrap">',
        '  <canvas data-el="canvas"></canvas>',
        '  <div class="chart-legend" data-el="legend"></div>',
        '  <div class="chart-hud" data-el="hud" hidden></div>',
        '  <div class="chart-price-tag" data-el="priceTag" hidden></div>',
        '</div>',
      ].join('')

    var self = this
    this.el = {}
    this.root.querySelectorAll('[data-el]').forEach(function (n) {
      self.el[n.getAttribute('data-el')] = n
    })

    this.el.source.innerHTML =
      '<option value="spot">Spot</option><option value="futures">Futures</option>'
    this.el.source.value = this.state.source || 'spot'
    if (this.el.interval) {
      this.el.interval.innerHTML = global.Scalp.Config.CHART_INTERVALS.map(function (x) {
        return '<option value="' + x.id + '">' + x.label + '</option>'
      }).join('')
      this.el.interval.value = this.state.interval
      this.el.interval.onchange = function () {
        self.patch({ interval: self.el.interval.value })
      }
    }
    this.el.source.onchange = function () {
      self.patch({ source: self.el.source.value })
    }
    if (this.el.symbol) {
      this.el.symbol.value = (this._symbolOverride || this._pane().symbol || '').toUpperCase()
      var applySym = function () {
        self.setSymbol(self.el.symbol.value)
      }
      this.el.symbol.onchange = applySym
      this.el.symbol.onkeydown = function (e) {
        if (e.key === 'Enter') {
          e.preventDefault()
          applySym()
          self.el.symbol.blur()
        }
      }
    }
    this.root.querySelectorAll('[data-tf]').forEach(function (btn) {
      btn.onclick = function () {
        self.patch({ interval: btn.getAttribute('data-tf') })
      }
    })

    this.root.querySelectorAll('[data-tool]').forEach(function (btn) {
      btn.onclick = function () {
        self._pendingPoint = null
        self.patch({ tool: btn.getAttribute('data-tool') })
      }
    })
    this.root.querySelector('[data-act="clear"]').onclick = function () {
      if (self.isolated) {
        self.drawings = []
        self.render()
        return
      }
      self.bus.emit('chart:clear-drawings')
    }
    var settingsBtn = this.root.querySelector('[data-act="settings"]')
    if (settingsBtn) {
      settingsBtn.onclick = function () {
        self.bus.emit('ui:open-settings', { tab: 'chart' })
      }
    }
    this.root.querySelector('[data-act="zoom-in"]').onclick = function () {
      self.zoom(1)
    }
    this.root.querySelector('[data-act="zoom-out"]').onclick = function () {
      self.zoom(-1)
    }
    this.root.querySelector('[data-act="follow"]').onclick = function () {
      self.view.follow = true
      self._scheduleRender()
    }
    this.root.querySelector('[data-act="liq"]').onclick = function () {
      self.patch({ showLiqLevels: self.state.showLiqLevels === false })
      if (self.isolated) {
        self._applyLocalLevels()
        self._scheduleRender()
      } else {
        self.bus.emit('coinglass:reload')
      }
    }
    this.root.querySelector('[data-act="liqcy"]').onclick = function () {
      self.patch({ showLiquidityLevels: self.state.showLiquidityLevels === false })
      if (self.isolated) {
        self._applyLocalLevels()
        if (self.state.showLiquidityLevels !== false) self._loadVizLiquidity()
        self._scheduleRender()
      } else {
        self.bus.emit('coinglass:reload')
      }
    }

    var canvas = this.el.canvas
    canvas.style.cursor = 'crosshair'
    canvas.addEventListener('mousemove', function (e) {
      self._onMove(e)
    })
    canvas.addEventListener('mouseleave', function () {
      self._hover = null
      if (self.el.hud) self.el.hud.hidden = true
      self._scheduleRender()
    })
    canvas.addEventListener('click', function (e) {
      if (self._drag && self._drag.moved) return
      self._onClick(e)
    })
    canvas.addEventListener(
      'wheel',
      function (e) {
        e.preventDefault()
        var p = self._xy(e)
        var layout = self._layout(p.w, p.h)
        var idx = self._indexAtX(layout, p.x)
        self.zoom(e.deltaY < 0 ? 1 : -1, idx)
      },
      { passive: false },
    )
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return
      var tool = self.state.tool
      if (tool && tool !== 'crosshair' && tool !== 'none') return
      var p = self._xy(e)
      var range = self._visibleRange()
      self._drag = { x: p.x, start: range.start, moved: false }
      canvas.style.cursor = 'grabbing'
    })
    window.addEventListener('mousemove', function (e) {
      if (!self._drag) return
      var p = self._xy(e)
      var n = self.candles.length
      var count = Math.max(20, Math.min(n, self.view.count || n))
      var barW = count ? p.w / count : 1
      var shift = Math.round(-(p.x - self._drag.x) / Math.max(1, barW))
      if (shift !== 0) self._drag.moved = true
      self.view.follow = false
      self.view.count = count
      self.view.start = Math.max(0, Math.min(Math.max(0, n - count), self._drag.start + shift))
      if (self.view.start + count >= n - 1) self.view.follow = true
      self._scheduleRender()
    })
    window.addEventListener('mouseup', function () {
      if (!self._drag) return
      self._drag = null
      if (self.el.canvas) self.el.canvas.style.cursor = 'crosshair'
    })

    window.addEventListener('resize', function () {
      self._scheduleRender()
    })
  }

  ChartAgent.prototype._paintStatus = function () {
    if (!this.el || !this.el.dot) return
    this.el.dot.className = 'status-dot ' + (this.status === 'live' ? 'live' : this.status === 'loading' ? 'connecting' : 'error')
    if (this.el.meta && this.error) this.el.meta.textContent = this.error
  }

  ChartAgent.prototype._xy = function (e) {
    var rect = this.el.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height }
  }

  ChartAgent.prototype._layout = function (w, h) {
    var pad = { l: 8, r: 64, t: 10, b: this.state.showRsi ? 56 : 8 }
    var volH = this.state.showVolume ? Math.floor(h * 0.16) : 0
    var rsiH = this.state.showRsi ? 44 : 0
    var mainH = h - pad.t - pad.b - volH - rsiH - (volH ? 4 : 0) - (rsiH ? 4 : 0)
    return {
      pad: pad,
      main: { x: pad.l, y: pad.t, w: w - pad.l - pad.r, h: mainH },
      vol: { x: pad.l, y: pad.t + mainH + 4, w: w - pad.l - pad.r, h: volH },
      rsi: { x: pad.l, y: pad.t + mainH + 4 + volH + (volH ? 4 : 0), w: w - pad.l - pad.r, h: rsiH },
    }
  }

  ChartAgent.prototype._fmtPrice = function (price) {
    var C = global.Scalp.Config
    return C.formatPrice(price, C.inferTickSize(price))
  }

  ChartAgent.prototype._priceAtY = function (layout, y, minP, maxP) {
    var t = (y - layout.main.y) / layout.main.h
    return maxP - t * (maxP - minP)
  }

  ChartAgent.prototype._indexAtX = function (layout, x) {
    var range = this._range.count ? this._range : this._visibleRange()
    if (!range.count) return 0
    var i = Math.floor(((x - layout.main.x) / layout.main.w) * range.count)
    i = Math.max(0, Math.min(range.count - 1, i))
    return range.start + i
  }

  ChartAgent.prototype._onMove = function (e) {
    if (!this.candles.length) return
    var p = this._xy(e)
    var layout = this._layout(p.w, p.h)
    var idx = this._indexAtX(layout, p.x)
    var range = this._visibleRange()
    var prices = []
    for (var i = range.start; i < range.end; i++) {
      prices.push(this.candles[i].high, this.candles[i].low)
    }
    var minP = Math.min.apply(null, prices)
    var maxP = Math.max.apply(null, prices)
    var padP = (maxP - minP) * 0.06 || maxP * 0.001
    minP -= padP
    maxP += padP
    var price = this._priceAtY(layout, p.y, minP, maxP)
    this._hover = { idx: idx, x: p.x, y: p.y, price: price }
    if (this.el.hud) {
      var c = this.candles[idx]
      if (c) {
        this.el.hud.hidden = false
        this.el.hud.style.left = Math.min(p.w - 160, Math.max(8, p.x + 12)) + 'px'
        this.el.hud.style.top = Math.max(8, p.y - 10) + 'px'
        this.el.hud.innerHTML =
          '<b>' +
          this._fmtPrice(price) +
          '</b><br>O ' +
          this._fmtPrice(c.open) +
          ' H ' +
          this._fmtPrice(c.high) +
          '<br>L ' +
          this._fmtPrice(c.low) +
          ' C ' +
          this._fmtPrice(c.close)
      }
    }
    this._scheduleRender()
  }

  ChartAgent.prototype._onClick = function (e) {
    var tool = this.state.tool
    var twoPoint = { trend: 1, ray: 1, rect: 1, fib: 1, measure: 1 }
    if (tool !== 'hline' && tool !== 'vline' && !twoPoint[tool]) return
    if (!this.candles.length) return
    var p = this._xy(e)
    var layout = this._layout(p.w, p.h)
    var prices = this.candles
      .map(function (c) {
        return c.high
      })
      .concat(
        this.candles.map(function (c) {
          return c.low
        }),
      )
    var minP = Math.min.apply(null, prices)
    var maxP = Math.max.apply(null, prices)
    var price = this._priceAtY(layout, p.y, minP, maxP)
    var idx = this._indexAtX(layout, p.x)
    var point = { idx: idx, price: price }

    if (tool === 'hline') {
      this.drawings.push({ type: 'hline', price: price })
      this.render()
      return
    }
    if (tool === 'vline') {
      this.drawings.push({ type: 'vline', idx: idx })
      this.render()
      return
    }
    if (!this._pendingPoint) {
      this._pendingPoint = point
      this.render()
      return
    }
    this.drawings.push({
      type: tool,
      a: this._pendingPoint,
      b: point,
    })
    this._pendingPoint = null
    this.render()
  }

  ChartAgent.prototype.render = function () {
    if (!this.el || !this.el.canvas) return
    var canvas = this.el.canvas
    var wrap = canvas.parentElement
    var dpr = window.devicePixelRatio || 1
    var w = Math.max(100, wrap.clientWidth)
    var h = Math.max(this.isolated ? 80 : 180, wrap.clientHeight)
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    var ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // toolbar state
    if (this.el.source) this.el.source.value = this.state.source
    if (this.el.interval) this.el.interval.value = this.state.interval
    if (this.el.symbol && document.activeElement !== this.el.symbol) {
      this.el.symbol.value = String(this._symbolOverride || this._pane().symbol || '').toUpperCase()
    }
    this.root.querySelectorAll('[data-tf]').forEach(
      function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tf') === this.state.interval)
      }.bind(this),
    )
    this.root.querySelectorAll('[data-tool]').forEach(
      function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tool') === this.state.tool)
      }.bind(this),
    )
    this._paintStatus()

    var pane = this._pane()
    var last = this.candles[this.candles.length - 1]
    this.el.meta.textContent = last
      ? pane.symbol.toUpperCase() +
        ' · ' +
        this.state.interval +
        ' · ' +
        this._fmtPrice(last.close)
      : pane.symbol.toUpperCase()

    ctx.fillStyle = '#0e1319'
    ctx.fillRect(0, 0, w, h)

    if (!this.candles.length) {
      ctx.fillStyle = '#8b9bb0'
      ctx.font = '13px IBM Plex Sans, sans-serif'
      ctx.fillText(this.error || 'Нет данных графика…', 16, 40)
      return
    }

    var layout = this._layout(w, h)
    var range = this._visibleRange()
    this._range = range
    var vis = this.candles.slice(range.start, range.end)
    if (!vis.length) return

    var highs = vis.map(function (c) {
      return c.high
    })
    var lows = vis.map(function (c) {
      return c.low
    })
    var minP = Math.min.apply(null, lows)
    var maxP = Math.max.apply(null, highs)
    var padP = (maxP - minP) * 0.06 || maxP * 0.001
    minP -= padP
    maxP += padP

    var n = vis.length
    var cw = layout.main.w / n
    var bodyW = Math.max(1, cw * 0.65)

    function yMain(price) {
      return layout.main.y + ((maxP - price) / (maxP - minP)) * layout.main.h
    }
    function xAt(globalIdx) {
      return layout.main.x + (globalIdx - range.start + 0.5) * cw
    }
    function xLocal(i) {
      return layout.main.x + (i + 0.5) * cw
    }

    // grid
    if (this.state.showGrid) {
      ctx.strokeStyle = 'rgba(42,53,68,0.7)'
      ctx.lineWidth = 1
      for (var g = 0; g < 5; g++) {
        var gy = layout.main.y + (layout.main.h * g) / 4
        ctx.beginPath()
        ctx.moveTo(layout.main.x, gy)
        ctx.lineTo(layout.main.x + layout.main.w, gy)
        ctx.stroke()
        var gp = maxP - ((maxP - minP) * g) / 4
        ctx.fillStyle = '#8b9bb0'
        ctx.font = '10px IBM Plex Mono, monospace'
        ctx.fillText(this._fmtPrice(gp), layout.main.x + layout.main.w + 6, gy + 3)
      }
    }

    // bollinger fill
    if (this.ind.bb) {
      ctx.beginPath()
      var started = false
      for (var i = range.start; i < range.end; i++) {
        if (this.ind.bb.upper[i] == null) continue
        var x = xAt(i)
        var y = yMain(this.ind.bb.upper[i])
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      for (i = range.end - 1; i >= range.start; i--) {
        if (this.ind.bb.lower[i] == null) continue
        ctx.lineTo(xAt(i), yMain(this.ind.bb.lower[i]))
      }
      ctx.closePath()
      ctx.fillStyle = 'rgba(120,160,220,0.08)'
      ctx.fill()
    }

    // candles
    for (i = 0; i < n; i++) {
      var c = vis[i]
      var up = c.close >= c.open
      var color = up ? '#3ecf8e' : '#e85d6a'
      var gx = xLocal(i)
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(gx, yMain(c.high))
      ctx.lineTo(gx, yMain(c.low))
      ctx.stroke()
      var y1 = yMain(Math.max(c.open, c.close))
      var y2 = yMain(Math.min(c.open, c.close))
      ctx.fillStyle = color
      ctx.fillRect(gx - bodyW / 2, y1, bodyW, Math.max(1, y2 - y1))
    }

    function drawLine(series, color, width) {
      if (!series) return
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = width || 1.25
      var s = false
      for (var j = range.start; j < range.end; j++) {
        if (series[j] == null) continue
        var xx = xAt(j)
        var yy = yMain(series[j])
        if (!s) {
          ctx.moveTo(xx, yy)
          s = true
        } else ctx.lineTo(xx, yy)
      }
      ctx.stroke()
    }

    drawLine(this.ind.sma20, '#f0b429', 1.2)
    drawLine(this.ind.sma50, '#7aa2ff', 1.2)
    drawLine(this.ind.ema12, '#c084fc', 1.2)
    drawLine(this.ind.ema26, '#22d3ee', 1.2)
    drawLine(this.ind.vwap, '#fb923c', 1.2)
    if (this.ind.bb) {
      drawLine(this.ind.bb.upper, 'rgba(120,160,220,0.7)', 1)
      drawLine(this.ind.bb.mid, 'rgba(120,160,220,0.5)', 1)
      drawLine(this.ind.bb.lower, 'rgba(120,160,220,0.7)', 1)
    }

    // drawings
    var FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
    ctx.setLineDash([4, 3])
    this.drawings.forEach(function (d) {
      ctx.strokeStyle = '#f0b429'
      ctx.fillStyle = '#f0b429'
      ctx.lineWidth = 1
      if (d.type === 'hline') {
        var yy = yMain(d.price)
        ctx.beginPath()
        ctx.moveTo(layout.main.x, yy)
        ctx.lineTo(layout.main.x + layout.main.w, yy)
        ctx.stroke()
        ctx.font = '10px IBM Plex Mono, monospace'
        ctx.fillText(d.price.toFixed(2), layout.main.x + 4, yy - 3)
      }
      if (d.type === 'vline') {
        var xx = xAt(d.idx)
        ctx.beginPath()
        ctx.moveTo(xx, layout.main.y)
        ctx.lineTo(xx, layout.main.y + layout.main.h)
        ctx.stroke()
      }
      if (d.type === 'trend' || d.type === 'ray') {
        var x1 = xAt(d.a.idx)
        var y1 = yMain(d.a.price)
        var x2 = xAt(d.b.idx)
        var y2 = yMain(d.b.price)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        if (d.type === 'ray') {
          var dx = x2 - x1 || 0.001
          var dy = y2 - y1
          var right = layout.main.x + layout.main.w
          var left = layout.main.x
          var tEnd = dx >= 0 ? (right - x1) / dx : (left - x1) / dx
          ctx.lineTo(x1 + dx * Math.max(tEnd, 1), y1 + dy * Math.max(tEnd, 1))
        } else {
          ctx.lineTo(x2, y2)
        }
        ctx.stroke()
      }
      if (d.type === 'rect') {
        var rx1 = xAt(d.a.idx)
        var ry1 = yMain(d.a.price)
        var rx2 = xAt(d.b.idx)
        var ry2 = yMain(d.b.price)
        ctx.fillStyle = 'rgba(240,180,41,0.08)'
        ctx.fillRect(Math.min(rx1, rx2), Math.min(ry1, ry2), Math.abs(rx2 - rx1), Math.abs(ry2 - ry1))
        ctx.strokeRect(Math.min(rx1, rx2), Math.min(ry1, ry2), Math.abs(rx2 - rx1), Math.abs(ry2 - ry1))
      }
      if (d.type === 'fib') {
        var fHi = Math.max(d.a.price, d.b.price)
        var fLo = Math.min(d.a.price, d.b.price)
        var fSpan = fHi - fLo || 1
        FIB_LEVELS.forEach(function (lvl) {
          var fp = fHi - fSpan * lvl
          var fy = yMain(fp)
          ctx.beginPath()
          ctx.moveTo(layout.main.x, fy)
          ctx.lineTo(layout.main.x + layout.main.w, fy)
          ctx.stroke()
          ctx.font = '9px IBM Plex Mono, monospace'
          ctx.fillText(lvl.toFixed(3) + ' · ' + fp.toFixed(2), layout.main.x + 4, fy - 2)
        })
      }
      if (d.type === 'measure') {
        var mx1 = xAt(d.a.idx)
        var my1 = yMain(d.a.price)
        var mx2 = xAt(d.b.idx)
        var my2 = yMain(d.b.price)
        ctx.strokeStyle = '#22d3ee'
        ctx.beginPath()
        ctx.moveTo(mx1, my1)
        ctx.lineTo(mx2, my2)
        ctx.stroke()
        var dPrice = d.b.price - d.a.price
        var dBars = d.b.idx - d.a.idx
        var pct = d.a.price ? (dPrice / d.a.price) * 100 : 0
        ctx.fillStyle = '#22d3ee'
        ctx.font = '10px IBM Plex Mono, monospace'
        ctx.fillText(
          (dPrice >= 0 ? '+' : '') +
            dPrice.toFixed(2) +
            ' (' +
            (pct >= 0 ? '+' : '') +
            pct.toFixed(2) +
            '%) · ' +
            dBars +
            ' бар',
          Math.min(mx1, mx2) + 4,
          Math.min(my1, my2) - 4,
        )
      }
    })

    // pending preview
    if (this._pendingPoint && this._hover) {
      var hp = {
        idx: this._hover.idx,
        price: this._priceAtY(layout, this._hover.y, minP, maxP),
      }
      ctx.strokeStyle = 'rgba(240,180,41,0.55)'
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.moveTo(xAt(this._pendingPoint.idx), yMain(this._pendingPoint.price))
      ctx.lineTo(xAt(hp.idx), yMain(hp.price))
      ctx.stroke()
    }
    ctx.setLineDash([])

    // volume
    if (this.state.showVolume && layout.vol.h > 0) {
      var maxV = 1
      for (i = 0; i < n; i++) maxV = Math.max(maxV, vis[i].volume)
      for (i = 0; i < n; i++) {
        c = vis[i]
        up = c.close >= c.open
        var vh = (c.volume / maxV) * layout.vol.h
        ctx.fillStyle = up ? 'rgba(62,207,142,0.35)' : 'rgba(232,93,106,0.35)'
        ctx.fillRect(xLocal(i) - bodyW / 2, layout.vol.y + layout.vol.h - vh, bodyW, vh)
      }
    }

    // RSI
    if (this.state.showRsi && layout.rsi.h > 0 && this.ind.rsi) {
      ctx.strokeStyle = 'rgba(42,53,68,0.9)'
      ;[30, 50, 70].forEach(function (lvl) {
        var ry = layout.rsi.y + ((100 - lvl) / 100) * layout.rsi.h
        ctx.beginPath()
        ctx.moveTo(layout.rsi.x, ry)
        ctx.lineTo(layout.rsi.x + layout.rsi.w, ry)
        ctx.stroke()
      })
      ctx.beginPath()
      ctx.strokeStyle = '#a78bfa'
      ctx.lineWidth = 1.2
      var rs = false
      for (i = range.start; i < range.end; i++) {
        if (this.ind.rsi[i] == null) continue
        var ryy = layout.rsi.y + ((100 - this.ind.rsi[i]) / 100) * layout.rsi.h
        if (!rs) {
          ctx.moveTo(xAt(i), ryy)
          rs = true
        } else ctx.lineTo(xAt(i), ryy)
      }
      ctx.stroke()
      ctx.fillStyle = '#8b9bb0'
      ctx.font = '9px IBM Plex Sans, sans-serif'
      ctx.fillText('RSI', layout.rsi.x + 4, layout.rsi.y + 10)
    }

    // Coinglass / local: liquidations + liquidity (отдельные слои)
    this._drawLevelOverlays(ctx, layout, yMain, minP, maxP)

    // live price line + подпись на правой оси
    if (last) {
      var livePrice = last.close
      var prevC = this.candles[this.candles.length - 2]
      var liveUp = !prevC || livePrice >= prevC.close
      var ly = yMain(livePrice)
      var yMin = layout.main.y
      var yMax = layout.main.y + layout.main.h
      var inBand = ly >= yMin - 1 && ly <= yMax + 1
      if (this.el.priceTag) this.el.priceTag.hidden = true
      if (inBand) {
        var col = liveUp ? '#3ecf8e' : '#e85d6a'
        var label = this._fmtPrice(livePrice)
        ctx.save()
        ctx.strokeStyle = col
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 1.25
        ctx.setLineDash([6, 4])
        ctx.beginPath()
        ctx.moveTo(layout.main.x, ly)
        ctx.lineTo(layout.main.x + layout.main.w, ly)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1

        ctx.font = '11px IBM Plex Mono, monospace'
        var tw = ctx.measureText(label).width
        var bx = layout.main.x + layout.main.w
        var bw = Math.max(layout.pad.r - 2, tw + 12)
        var bh = 18
        var by = Math.max(yMin, Math.min(yMax - bh, ly - bh / 2))

        // стрелка к оси
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.moveTo(bx, ly)
        ctx.lineTo(bx + 6, ly - 6)
        ctx.lineTo(bx + 6, ly + 6)
        ctx.closePath()
        ctx.fill()

        ctx.fillStyle = col
        ctx.fillRect(bx + 5, by, bw - 5, bh)
        ctx.fillStyle = '#0b1016'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.fillText(label, bx + 10, by + bh / 2)
        ctx.restore()
      }
    } else if (this.el.priceTag) {
      this.el.priceTag.hidden = true
    }

    // crosshair / hover
    if (this._hover && (this.state.tool === 'crosshair' || this.state.tool === 'none' || !this.state.tool)) {
      var hi = this._hover.idx
      var hc = this.candles[hi]
      if (hc && hi >= range.start && hi < range.end) {
        ctx.strokeStyle = 'rgba(232,238,246,0.28)'
        ctx.beginPath()
        ctx.moveTo(xAt(hi), layout.main.y)
        ctx.lineTo(xAt(hi), layout.main.y + layout.main.h)
        ctx.moveTo(layout.main.x, this._hover.y)
        ctx.lineTo(layout.main.x + layout.main.w, this._hover.y)
        ctx.stroke()
        // price chip on axis (поверх live-бейджа при наведении)
        var hpLabel = this._fmtPrice(
          this._hover.price != null ? this._hover.price : hc.close,
        )
        ctx.font = '10px IBM Plex Mono, monospace'
        var htw = ctx.measureText(hpLabel).width
        var hbw = Math.max(layout.pad.r - 2, htw + 10)
        var hby = Math.max(
          layout.main.y,
          Math.min(layout.main.y + layout.main.h - 16, this._hover.y - 8),
        )
        ctx.fillStyle = 'rgba(26,34,45,0.96)'
        ctx.fillRect(layout.main.x + layout.main.w + 1, hby, hbw, 16)
        ctx.strokeStyle = 'rgba(232,238,246,0.35)'
        ctx.strokeRect(layout.main.x + layout.main.w + 1, hby, hbw, 16)
        ctx.fillStyle = '#e8eef6'
        ctx.textBaseline = 'middle'
        ctx.fillText(hpLabel, layout.main.x + layout.main.w + 6, hby + 8)
      }
      if (hc) {
        this.el.legend.innerHTML =
          '<span>O ' +
          this._fmtPrice(hc.open) +
          '</span><span>H ' +
          this._fmtPrice(hc.high) +
          '</span><span>L ' +
          this._fmtPrice(hc.low) +
          '</span><span>C ' +
          this._fmtPrice(hc.close) +
          '</span><span>V ' +
          hc.volume.toFixed(3) +
          '</span>' +
          (this.ind.rsi && this.ind.rsi[hi] != null
            ? '<span>RSI ' + this.ind.rsi[hi].toFixed(1) + '</span>'
            : '') +
          '<span class="lg-zoom">' +
          range.count +
          '/' +
          this.candles.length +
          '</span>'
      }
    } else if (last) {
      this.el.legend.innerHTML =
        '<span class="lg-live">LIVE ' +
        this._fmtPrice(last.close) +
        '</span>' +
        (this.ind.sma20 && this.ind.sma20[this.candles.length - 1] != null
          ? '<span class="lg-sma">SMA20 ' + this._fmtPrice(this.ind.sma20[this.candles.length - 1]) + '</span>'
          : '') +
        (this.ind.ema12 && this.ind.ema12[this.candles.length - 1] != null
          ? '<span class="lg-ema">EMA12 ' + this._fmtPrice(this.ind.ema12[this.candles.length - 1]) + '</span>'
          : '') +
        '<span class="lg-zoom">' +
        range.count +
        '/' +
        this.candles.length +
        '</span>'
    }

    // follow button state
    var followBtn = this.root.querySelector('[data-act="follow"]')
    if (followBtn) followBtn.classList.toggle('active', !!this.view.follow)
    var liqBtn = this.root.querySelector('[data-act="liq"]')
    if (liqBtn) liqBtn.classList.toggle('active', this.state.showLiqLevels !== false)
    var liqcyBtn = this.root.querySelector('[data-act="liqcy"]')
    if (liqcyBtn) liqcyBtn.classList.toggle('active', this.state.showLiquidityLevels !== false)
  }

  ChartAgent.prototype._drawLevelOverlays = function (ctx, layout, yMain, minP, maxP) {
    var C = global.Scalp.Config
    var cg = this.cg || {}
    var yMin = layout.main.y
    var yMax = layout.main.y + layout.main.h

    function inView(price) {
      return price >= minP && price <= maxP
    }

    if (this.state.showLiquidityLevels !== false && cg.liquidity && cg.liquidity.length) {
      var maxU = 1
      cg.liquidity.forEach(function (l) {
        maxU = Math.max(maxU, l.usd || 0)
      })
      var op = this.state.liquidityOpacity != null ? this.state.liquidityOpacity : 0.5
      cg.liquidity.forEach(function (l) {
        if (!inView(l.price)) return
        var y = yMain(l.price)
        if (y < yMin - 2 || y > yMax + 2) return
        var t = Math.min(1, (l.usd || 0) / maxU)
        var isBid = l.side === 'bid'
        ctx.save()
        ctx.globalAlpha = op * (0.25 + t * 0.75)
        ctx.strokeStyle = isBid ? '#3ecf8e' : '#e85d6a'
        ctx.fillStyle = isBid ? 'rgba(62,207,142,0.16)' : 'rgba(232,93,106,0.16)'
        ctx.lineWidth = 1 + t * 2
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(layout.main.x, y)
        ctx.lineTo(layout.main.x + layout.main.w, y)
        ctx.stroke()
        ctx.setLineDash([])
        var tag =
          (isBid ? 'B ' : isBid === false || l.side === 'ask' ? 'A ' : 'L ') +
          (C.formatUsdVolume ? C.formatUsdVolume(l.usd, { shortenThousands: true }) : String(Math.round(l.usd)))
        ctx.font = '9px IBM Plex Mono, monospace'
        ctx.globalAlpha = Math.min(0.95, op + 0.25)
        ctx.fillStyle = isBid ? '#3ecf8e' : '#e85d6a'
        ctx.fillText(tag, layout.main.x + 4, y - 2)
        ctx.restore()
      })
    }

    if (this.state.showLiqLevels !== false && cg.liquidations && cg.liquidations.length) {
      var maxL = 1
      cg.liquidations.forEach(function (l) {
        maxL = Math.max(maxL, l.usd || 0)
      })
      var lop = this.state.liqOpacity != null ? this.state.liqOpacity : 0.55
      cg.liquidations.forEach(function (l) {
        if (!inView(l.price)) return
        var y = yMain(l.price)
        if (y < yMin - 2 || y > yMax + 2) return
        var t = Math.min(1, Math.sqrt((l.usd || 0) / maxL))
        var side = l.side
        var col =
          side === 'long' || side === 'bid'
            ? '#f59e0b'
            : side === 'short' || side === 'ask'
              ? '#a78bfa'
              : '#f0b429'
        ctx.save()
        ctx.globalAlpha = lop * (0.3 + t * 0.7)
        ctx.strokeStyle = col
        ctx.lineWidth = 1 + t * 2.5
        ctx.setLineDash([8, 4])
        ctx.beginPath()
        ctx.moveTo(layout.main.x, y)
        ctx.lineTo(layout.main.x + layout.main.w * (0.55 + t * 0.45), y)
        ctx.stroke()
        ctx.setLineDash([])
        var lev = l.leverage != null ? '×' + l.leverage + ' ' : ''
        var tag =
          'Liq ' +
          lev +
          (C.formatUsdVolume ? C.formatUsdVolume(l.usd, { shortenThousands: true }) : '')
        ctx.font = '9px IBM Plex Mono, monospace'
        ctx.fillStyle = col
        ctx.globalAlpha = Math.min(0.95, lop + 0.2)
        ctx.fillText(tag, layout.main.x + layout.main.w * 0.42, y - 2)
        ctx.restore()
      })
    }
  }

  ChartAgent.prototype.start = function () {
    if (this.isolated && this.root) {
      this.root.classList.add('chart-panel', 'viz-chart')
    }
    this.mount()
    if (!this.isolated) this.bus.emit('chart:changed', this.get())
    if (!this._paused) this.load()
  }

  ChartAgent.prototype.destroy = function () {
    this._destroyed = true
    if (this._timer) clearTimeout(this._timer)
    this._disconnectLive()
    if (this._raf) cancelAnimationFrame(this._raf)
  }

  global.Scalp.ChartAgent = ChartAgent
})(typeof window !== 'undefined' ? window : globalThis)
