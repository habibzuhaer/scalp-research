/* SettingsAgent — DOM / торговые настройки */
(function (global) {
  'use strict'

  function SettingsAgent(bus) {
    this.bus = bus
    this.state = global.Scalp.Config.load(
      global.Scalp.Config.KEYS.dom,
      global.Scalp.Config.DEFAULT_DOM,
    )
    this.symbol = localStorage.getItem(global.Scalp.Config.KEYS.symbol) || 'btcusdt'
    this.aggSteps = 1
    this._bind()
  }

  SettingsAgent.prototype._bind = function () {
    var self = this
    this.bus.on('settings:get', function () {
      self.bus.emit('settings:state', self.snapshot())
    })
    this.bus.on('settings:patch', function (partial) {
      self.patch(partial)
    })
    this.bus.on('settings:reset', function () {
      self.reset()
    })
    this.bus.on('symbol:set', function (symbol) {
      self.setSymbol(symbol)
    })
    this.bus.on('agg:set', function (steps) {
      self.setAgg(steps)
    })
    this.bus.on('agg:zoom-in', function () {
      self.setAgg(Math.min(1000, self.aggSteps * 2))
    })
    this.bus.on('agg:zoom-out', function () {
      self.setAgg(Math.max(1, Math.floor(self.aggSteps / 2) || 1))
    })
  }

  SettingsAgent.prototype.snapshot = function () {
    return {
      dom: Object.assign({}, this.state),
      symbol: this.symbol,
      aggSteps: this.aggSteps,
    }
  }

  SettingsAgent.prototype.patch = function (partial) {
    this.state = Object.assign({}, this.state, partial)
    if (partial.theme && global.Scalp.Config.DOM_THEMES[partial.theme]) {
      var th = global.Scalp.Config.DOM_THEMES[partial.theme]
      if (partial.askBarHue == null) this.state.askBarHue = th.askHue
      if (partial.bidBarHue == null) this.state.bidBarHue = th.bidHue
    }
    global.Scalp.Config.save(global.Scalp.Config.KEYS.dom, this.state)
    this.bus.emit('settings:changed', this.snapshot())
  }

  SettingsAgent.prototype.reset = function () {
    this.state = Object.assign({}, global.Scalp.Config.DEFAULT_DOM)
    global.Scalp.Config.save(global.Scalp.Config.KEYS.dom, this.state)
    this.bus.emit('settings:changed', this.snapshot())
  }

  SettingsAgent.prototype.setSymbol = function (symbol) {
    this.symbol = symbol
    localStorage.setItem(global.Scalp.Config.KEYS.symbol, symbol)
    this.bus.emit('settings:changed', this.snapshot())
    this.bus.emit('market:resubscribe', { symbol: symbol })
  }

  SettingsAgent.prototype.setAgg = function (steps) {
    this.aggSteps = steps
    this.bus.emit('settings:changed', this.snapshot())
  }

  SettingsAgent.prototype.meta = function () {
    var list = global.Scalp.Config.SYMBOLS
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === this.symbol) return list[i]
    }
    return list[0]
  }

  SettingsAgent.prototype.step = function () {
    var meta = this.meta()
    return meta.tickSize * this.state.priceStepMultiplier * this.aggSteps
  }

  SettingsAgent.prototype.start = function () {
    this.bus.emit('settings:changed', this.snapshot())
  }

  global.Scalp.SettingsAgent = SettingsAgent
})(typeof window !== 'undefined' ? window : globalThis)
