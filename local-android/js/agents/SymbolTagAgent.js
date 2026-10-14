/* SymbolTagAgent — сеть BNB / SOL: эвристика + пользовательский словарь */
(function (global) {
  'use strict'

  var KEY = 'scalp-symbol-tags-v1'
  var DEFAULT = { overrides: {} }

  function normalizeSym(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  }

  function guessBase(symbol, symbolsAgent, exchange) {
    var sym = normalizeSym(symbol)
    if (symbolsAgent && symbolsAgent.find && exchange) {
      try {
        var hit = symbolsAgent.find(exchange, sym)
        if (hit && hit.base) return String(hit.base).toUpperCase()
      } catch (e) {}
    }
    var u = sym.toUpperCase()
    var quotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY']
    for (var i = 0; i < quotes.length; i++) {
      if (u.length > quotes[i].length && u.slice(-quotes[i].length) === quotes[i]) {
        return u.slice(0, -quotes[i].length)
      }
    }
    return u
  }

  function heuristicChain(base) {
    var b = String(base || '').toUpperCase()
    if (!b) return 'other'
    if (b === 'BNB' || b === 'WBNB' || b.indexOf('BNB') === 0) return 'bnb'
    if (b === 'SOL' || b === 'WSOL' || b.indexOf('SOL') === 0) return 'sol'
    // memecoins / wrappers often on SOL or BNB — only explicit base match for MVP
    return 'other'
  }

  function SymbolTagAgent(bus, symbolsAgent) {
    this.bus = bus
    this.symbols = symbolsAgent || null
    this.state = global.Scalp.Config.load(KEY, DEFAULT)
    if (!this.state.overrides || typeof this.state.overrides !== 'object') this.state.overrides = {}
    this._bind()
  }

  SymbolTagAgent.prototype._bind = function () {
    var self = this
    this.bus.on('tags:patch', function (partial) {
      self.patch(partial || {})
    })
    this.bus.on('tags:set-override', function (payload) {
      if (!payload || !payload.symbol) return
      var sym = normalizeSym(payload.symbol)
      var chain = String(payload.chain || 'other').toLowerCase()
      if (chain !== 'bnb' && chain !== 'sol' && chain !== 'other') chain = 'other'
      self.state.overrides[sym] = chain
      self._save()
      self.bus.emit('tags:changed', self.snapshot())
    })
    this.bus.on('tags:clear-override', function (symbol) {
      var sym = normalizeSym(symbol)
      delete self.state.overrides[sym]
      self._save()
      self.bus.emit('tags:changed', self.snapshot())
    })
    this.bus.on('tags:resolve', function (payload) {
      var symbol = payload && payload.symbol
      var exchange = payload && payload.exchange
      self.bus.emit('tags:resolved', self.resolve(symbol, exchange))
    })
  }

  SymbolTagAgent.prototype._save = function () {
    global.Scalp.Config.save(KEY, this.state)
  }

  SymbolTagAgent.prototype.patch = function (partial) {
    if (partial.overrides && typeof partial.overrides === 'object') {
      this.state.overrides = Object.assign({}, this.state.overrides, partial.overrides)
    }
    this._save()
    this.bus.emit('tags:changed', this.snapshot())
  }

  SymbolTagAgent.prototype.resolve = function (symbol, exchange) {
    var sym = normalizeSym(symbol)
    var override = this.state.overrides[sym]
    var base = guessBase(sym, this.symbols, exchange)
    var chain = override || heuristicChain(base)
    var color = chain === 'bnb' ? '#f0b90b' : chain === 'sol' ? '#14f195' : '#8b93a7'
    return {
      symbol: sym,
      base: base,
      chain: chain,
      color: color,
      override: !!override,
    }
  }

  SymbolTagAgent.prototype.snapshot = function () {
    return { overrides: Object.assign({}, this.state.overrides) }
  }

  SymbolTagAgent.prototype.start = function () {
    this.bus.emit('tags:changed', this.snapshot())
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.SymbolTagAgent = SymbolTagAgent
})(typeof window !== 'undefined' ? window : globalThis)
