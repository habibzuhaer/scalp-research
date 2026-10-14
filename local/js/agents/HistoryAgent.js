/* HistoryAgent — история тикеров */
(function (global) {
  'use strict'

  var MAX = 40

  function HistoryAgent(bus, tickersAgent) {
    this.bus = bus
    this.tickers = tickersAgent
    this.items = []
    try {
      var raw = localStorage.getItem(global.Scalp.Config.KEYS.history)
      this.items = raw ? JSON.parse(raw) : []
      if (!Array.isArray(this.items)) this.items = []
    } catch (e) {
      this.items = []
    }
    this._bind()
  }

  HistoryAgent.prototype._bind = function () {
    var self = this
    this.bus.on('tickers:changed', function (state) {
      self.pushFromState(state)
    })
    this.bus.on('history:clear', function () {
      self.clear()
    })
    this.bus.on('history:get', function () {
      self.bus.emit('history:state', self.get())
    })
    this.bus.on('history:open', function (item) {
      if (!item) return
      self.bus.emit('tickers:set-exchange', {
        pane: item.market === 'futures' ? 'futures' : 'spot',
        exchange: item.exchange,
      })
      self.bus.emit('tickers:set-symbol', {
        pane: item.market === 'futures' ? 'futures' : 'spot',
        symbol: item.symbol,
      })
    })
  }

  HistoryAgent.prototype._save = function () {
    localStorage.setItem(global.Scalp.Config.KEYS.history, JSON.stringify(this.items))
    this.bus.emit('history:changed', this.get())
  }

  HistoryAgent.prototype.pushFromState = function (state) {
    if (!state) return
    ;['spot', 'futures'].forEach(
      function (pane) {
        var p = state[pane]
        if (!p) return
        var key = (p.market || pane) + ':' + p.exchange + ':' + p.symbol
        if (this._lastKeys && this._lastKeys[pane] === key) return
        if (!this._lastKeys) this._lastKeys = {}
        this._lastKeys[pane] = key
        this.push({
          symbol: p.symbol,
          exchange: p.exchange,
          market: p.market || (pane === 'futures' ? 'futures' : 'spot'),
          pane: pane,
          ts: Date.now(),
        })
      }.bind(this),
    )
  }

  HistoryAgent.prototype.push = function (entry) {
    var key = entry.market + ':' + entry.exchange + ':' + entry.symbol
    this.items = this.items.filter(function (it) {
      return !(it.market + ':' + it.exchange + ':' + it.symbol === key)
    })
    this.items.unshift(entry)
    if (this.items.length > MAX) this.items = this.items.slice(0, MAX)
    this._save()
  }

  HistoryAgent.prototype.clear = function () {
    this.items = []
    this._save()
  }

  HistoryAgent.prototype.get = function () {
    return this.items.slice()
  }

  HistoryAgent.prototype.start = function () {
    this.bus.emit('history:changed', this.get())
    // seed from current tickers once
    this.pushFromState(this.tickers.get())
  }

  global.Scalp.HistoryAgent = HistoryAgent
})(typeof window !== 'undefined' ? window : globalThis)
