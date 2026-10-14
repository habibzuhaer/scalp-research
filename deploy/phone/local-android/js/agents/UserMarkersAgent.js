/* UserMarkersAgent — свои маркеры с описанием (persist) */
(function (global) {
  'use strict'

  var KEY = 'scalp-markers-v1'
  var DEFAULT = { byKey: {} }

  function mkId() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  }

  function keyOf(pane, symbol) {
    return String(pane || 'spot') + ':' + String(symbol || '').toLowerCase()
  }

  function UserMarkersAgent(bus) {
    this.bus = bus
    this.state = global.Scalp.Config.load(KEY, DEFAULT)
    if (!this.state.byKey || typeof this.state.byKey !== 'object') this.state.byKey = {}
    this._bind()
  }

  UserMarkersAgent.prototype._bind = function () {
    var self = this
    this.bus.on('markers:add', function (payload) {
      self.add(payload || {})
    })
    this.bus.on('markers:patch', function (payload) {
      self.patchMarker(payload || {})
    })
    this.bus.on('markers:remove', function (payload) {
      self.remove(payload)
    })
    this.bus.on('markers:list', function (payload) {
      var pane = payload && payload.pane
      var symbol = payload && payload.symbol
      self.bus.emit('markers:listed', { key: keyOf(pane, symbol), items: self.list(pane, symbol) })
    })
  }

  UserMarkersAgent.prototype._save = function () {
    global.Scalp.Config.save(KEY, this.state)
  }

  UserMarkersAgent.prototype._emit = function (pane, symbol) {
    this.bus.emit('markers:changed', {
      key: keyOf(pane, symbol),
      pane: pane,
      symbol: symbol,
      items: this.list(pane, symbol),
    })
  }

  UserMarkersAgent.prototype.list = function (pane, symbol) {
    var k = keyOf(pane, symbol)
    var arr = this.state.byKey[k]
    return Array.isArray(arr) ? arr.slice() : []
  }

  UserMarkersAgent.prototype.add = function (payload) {
    var pane = payload.pane || 'spot'
    var symbol = String(payload.symbol || '').toLowerCase()
    if (!symbol) return null
    var label = String(payload.label || '').trim()
    if (!label) label = 'Маркер'
    var item = {
      id: payload.id || mkId(),
      pane: pane,
      symbol: symbol,
      type: payload.type || 'price',
      price: payload.price != null ? Number(payload.price) : null,
      time: payload.time != null ? Number(payload.time) : null,
      color: payload.color || '#f0b90b',
      label: label,
      description: String(payload.description || ''),
      source: payload.source || 'user',
      visible: payload.visible !== false,
      meta: payload.meta || {},
    }
    var k = keyOf(pane, symbol)
    if (!this.state.byKey[k]) this.state.byKey[k] = []
    this.state.byKey[k].push(item)
    this._save()
    this._emit(pane, symbol)
    return item
  }

  UserMarkersAgent.prototype.patchMarker = function (payload) {
    var id = payload && payload.id
    if (!id) return
    var pane = payload.pane
    var symbol = payload.symbol
    var keys = Object.keys(this.state.byKey)
    for (var i = 0; i < keys.length; i++) {
      var arr = this.state.byKey[keys[i]]
      for (var j = 0; j < arr.length; j++) {
        if (arr[j].id !== id) continue
        Object.keys(payload).forEach(function (f) {
          if (f === 'id') return
          arr[j][f] = payload[f]
        })
        this._save()
        var parts = keys[i].split(':')
        this._emit(pane || parts[0], symbol || parts.slice(1).join(':'))
        return
      }
    }
  }

  UserMarkersAgent.prototype.remove = function (payload) {
    var id = typeof payload === 'string' ? payload : payload && payload.id
    if (!id) return
    var keys = Object.keys(this.state.byKey)
    for (var i = 0; i < keys.length; i++) {
      var arr = this.state.byKey[keys[i]]
      var next = arr.filter(function (m) {
        return m.id !== id
      })
      if (next.length === arr.length) continue
      this.state.byKey[keys[i]] = next
      this._save()
      var parts = keys[i].split(':')
      this._emit(parts[0], parts.slice(1).join(':'))
      return
    }
  }

  UserMarkersAgent.prototype.start = function () {}

  global.Scalp = global.Scalp || {}
  global.Scalp.UserMarkersAgent = UserMarkersAgent
})(typeof window !== 'undefined' ? window : globalThis)
