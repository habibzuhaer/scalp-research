/* TickersAgent — спот + фьючи: биржа, тикер, link */
(function (global) {
  'use strict'

  function TickersAgent(bus) {
    this.bus = bus
    this.state = global.Scalp.Config.load(
      global.Scalp.Config.KEYS.tickers,
      global.Scalp.Config.DEFAULT_TICKERS,
    )
    this._normalize()
    this._bind()
  }

  TickersAgent.prototype._normalize = function () {
    var C = global.Scalp.Config
    ;['spot', 'futures'].forEach(
      function (pane) {
        if (!this.state[pane]) {
          this.state[pane] = Object.assign(
            {},
            pane === 'spot' ? C.DEFAULT_TICKERS.spot : C.DEFAULT_TICKERS.futures,
          )
        }
        var allowed = C.exchangesForMarket(pane === 'spot' ? 'spot' : 'futures')
        if (allowed.indexOf(this.state[pane].exchange) === -1) {
          Object.assign(this.state[pane], C.makePane(allowed[0], this.state[pane].symbol || 'btcusdt'))
        }
      }.bind(this),
    )
  }

  TickersAgent.prototype._bind = function () {
    var self = this
    this.bus.on('tickers:get', function () {
      self.bus.emit('tickers:state', self.get())
    })
    this.bus.on('tickers:patch-pane', function (payload) {
      self.patchPane(payload.pane, payload.patch || {})
    })
    this.bus.on('tickers:set-exchange', function (payload) {
      self.setExchange(payload.pane, payload.exchange, payload.testnet)
    })
    this.bus.on('tickers:set-symbol', function (payload) {
      self.setSymbol(payload.pane, payload.symbol)
    })
    this.bus.on('tickers:set-link', function (value) {
      self.setLink(!!value)
    })
    this.bus.on('tickers:set-agg', function (payload) {
      self.setAgg(payload.pane, payload.aggSteps)
    })
    this.bus.on('tickers:zoom-in', function (payload) {
      var pane = payload && payload.pane
      var cur = self.state[pane].aggSteps || 1
      self.setAgg(pane, Math.min(1000, cur * 2))
    })
    this.bus.on('tickers:zoom-out', function (payload) {
      var pane = payload && payload.pane
      var cur = self.state[pane].aggSteps || 1
      self.setAgg(pane, Math.max(1, Math.floor(cur / 2) || 1))
    })
    this.bus.on('tickers:reset', function () {
      self.reset()
    })
  }

  TickersAgent.prototype.get = function () {
    return JSON.parse(JSON.stringify(this.state))
  }

  TickersAgent.prototype.getPane = function (pane) {
    return Object.assign({}, this.state[pane])
  }

  TickersAgent.prototype._save = function () {
    global.Scalp.Config.save(global.Scalp.Config.KEYS.tickers, this.state)
    this.bus.emit('tickers:changed', this.get())
  }

  TickersAgent.prototype.patchPane = function (pane, patch) {
    if (pane !== 'spot' && pane !== 'futures') return
    this.state[pane] = Object.assign({}, this.state[pane], patch)
    this._save()
    this.bus.emit(pane + ':api:changed', this.getPane(pane))
    var reconnectKeys = {
      restBaseUrl: 1,
      wsBaseUrl: 1,
      depthLimit: 1,
      depthSpeed: 1,
      exchange: 1,
      symbol: 1,
      testnet: 1,
    }
    var needsReconnect = Object.keys(patch || {}).some(function (k) {
      return reconnectKeys[k]
    })
    if (needsReconnect) this.bus.emit(pane + ':market:reconnect')
  }

  TickersAgent.prototype.setExchange = function (pane, exchange, testnet) {
    var C = global.Scalp.Config
    var allowed = C.exchangesForMarket(pane === 'spot' ? 'spot' : 'futures')
    if (allowed.indexOf(exchange) === -1) return
    var t = typeof testnet === 'boolean' ? testnet : this.state[pane].testnet
    var preset = C.applyExchangePreset(exchange, t)
    var symbol = this.state[pane].symbol
    var keep = {
      apiKey: this.state[pane].apiKey || '',
      apiSecret: this.state[pane].apiSecret || '',
      viewOnly: this.state[pane].viewOnly !== false,
      aggSteps: this.state[pane].aggSteps || 1,
    }
    this.state[pane] = Object.assign({}, this.state[pane], preset, keep, { symbol: symbol })
    this._save()
    this.bus.emit(pane + ':api:changed', this.getPane(pane))
    this.bus.emit(pane + ':market:reconnect')
  }

  TickersAgent.prototype.setSymbol = function (pane, symbol) {
    var sym = String(symbol || '').toLowerCase()
    this.state[pane].symbol = sym
    if (this.state.linkSymbols) {
      this.state.spot.symbol = sym
      this.state.futures.symbol = sym
      this._save()
      this.bus.emit('spot:api:changed', this.getPane('spot'))
      this.bus.emit('futures:api:changed', this.getPane('futures'))
      this.bus.emit('spot:market:reconnect')
      this.bus.emit('futures:market:reconnect')
      return
    }
    this._save()
    this.bus.emit(pane + ':api:changed', this.getPane(pane))
    this.bus.emit(pane + ':market:reconnect')
  }

  TickersAgent.prototype.setLink = function (value) {
    this.state.linkSymbols = value
    if (value) {
      this.state.futures.symbol = this.state.spot.symbol
    }
    this._save()
    if (value) {
      this.bus.emit('futures:api:changed', this.getPane('futures'))
      this.bus.emit('futures:market:reconnect')
    }
  }

  TickersAgent.prototype.setAgg = function (pane, steps) {
    this.state[pane].aggSteps = steps
    this._save()
    this.bus.emit(pane + ':settings:changed', {
      dom: null,
      pane: this.getPane(pane),
    })
  }

  TickersAgent.prototype.reset = function () {
    this.state = JSON.parse(JSON.stringify(global.Scalp.Config.DEFAULT_TICKERS))
    this._save()
    this.bus.emit('spot:api:changed', this.getPane('spot'))
    this.bus.emit('futures:api:changed', this.getPane('futures'))
    this.bus.emit('spot:market:reconnect')
    this.bus.emit('futures:market:reconnect')
  }

  /* Facade совместимый с ApiAgent для MarketAgent */
  TickersAgent.prototype.asApi = function (pane) {
    var self = this
    return {
      get: function () {
        return self.getPane(pane)
      },
      resolveSymbol: function () {
        return self.state[pane].symbol
      },
      depthRestUrl: function (symbol) {
        return buildDepthRest(self.getPane(pane), symbol)
      },
      depthWsUrl: function (symbol) {
        return buildDepthWs(self.getPane(pane), symbol)
      },
      depthLimit: function () {
        return clampDepthLimit(self.state[pane].exchange, self.state[pane].depthLimit)
      },
    }
  }

  TickersAgent.prototype.asSettings = function (pane, sharedDom, symbolsAgent) {
    var self = this
    return {
      get state() {
        return sharedDom.state
      },
      get symbol() {
        return self.state[pane].symbol
      },
      get aggSteps() {
        return self.state[pane].aggSteps || 1
      },
      meta: function () {
        var id = self.state[pane].symbol
        var ex = self.state[pane].exchange
        if (symbolsAgent) return symbolsAgent.find(ex, id)
        var list = global.Scalp.Config.SYMBOLS
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === id) return list[i]
        }
        return { id: id, label: id.toUpperCase(), tickSize: 0 }
      },
      step: function (refPrice) {
        var meta = this.meta()
        var C = global.Scalp.Config
        var tick = meta.tickSize
        var ref = Number(refPrice)
        if (!(tick > 0) || (ref > 0 && tick > ref * 0.2)) {
          tick = C.inferTickSize(ref > 0 ? ref : 0)
        }
        var step =
          tick * (sharedDom.state.priceStepMultiplier || 1) * (self.state[pane].aggSteps || 1)
        if (ref > 0 && step > ref * 0.05) {
          step = tick
        }
        return step
      },
      formatTick: function (refPrice) {
        var meta = this.meta()
        var step = this.step(refPrice)
        var tick = meta.tickSize > 0 ? meta.tickSize : step
        return Math.min(step, tick)
      },
    }
  }

  TickersAgent.prototype.start = function () {
    this.bus.emit('tickers:changed', this.get())
  }

  function trimSlash(url) {
    return String(url || '').replace(/\/+$/, '')
  }

  function buildDepthRest(cfg, symbol) {
    var base = trimSlash(cfg.restBaseUrl)
    var sym = String(symbol).toUpperCase()
    var limit = clampDepthLimit(cfg.exchange, cfg.depthLimit || 1000)
    if (cfg.exchange === 'bybit') {
      return (
        base +
        '/v5/market/orderbook?category=spot&symbol=' +
        sym +
        '&limit=' +
        Math.min(limit, 200)
      )
    }
    if (cfg.exchange === 'bybit-futures') {
      return (
        base +
        '/v5/market/orderbook?category=linear&symbol=' +
        sym +
        '&limit=' +
        Math.min(limit, 200)
      )
    }
    if (cfg.exchange === 'binance-futures' || cfg.market === 'futures') {
      return base + '/fapi/v1/depth?symbol=' + sym + '&limit=' + limit
    }
    return base + '/api/v3/depth?symbol=' + sym + '&limit=' + limit
  }

  function buildDepthWs(cfg, symbol) {
    var base = trimSlash(cfg.wsBaseUrl)
    var sym = String(symbol).toLowerCase()
    if (cfg.exchange === 'bybit') return base + '/v5/public/spot'
    if (cfg.exchange === 'bybit-futures') return base + '/v5/public/linear'
    // Partial book: full top-N snapshot each tick (no diff sync). Levels: 5|10|20.
    var levels = partialDepthLevels(cfg.depthLimit)
    var speed = cfg.depthSpeed === '1000ms' ? '' : '@100ms'
    return base + '/ws/' + sym + '@depth' + levels + speed
  }

  function clampDepthLimit(exchange, limit) {
    var n = Number(limit) || 1000
    var allowed =
      exchange === 'bybit' || exchange === 'bybit-futures'
        ? [1, 50, 200]
        : [5, 10, 20, 50, 100, 500, 1000, 5000]
    if (allowed.indexOf(n) !== -1) return n
    var best = allowed[0]
    for (var i = 0; i < allowed.length; i++) {
      if (allowed[i] <= n) best = allowed[i]
    }
    return best
  }

  function partialDepthLevels(limit) {
    var n = Number(limit) || 20
    if (n <= 5) return 5
    if (n <= 10) return 10
    return 20
  }

  global.Scalp.TickersAgent = TickersAgent
  global.Scalp.clampDepthLimit = clampDepthLimit
})(typeof window !== 'undefined' ? window : globalThis)
