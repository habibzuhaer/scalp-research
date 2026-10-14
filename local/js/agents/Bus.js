/* Scalp Event Bus — связь между агентами */
(function (global) {
  'use strict'

  function Bus() {
    this._handlers = Object.create(null)
  }

  Bus.prototype.on = function (event, fn) {
    if (!this._handlers[event]) this._handlers[event] = []
    this._handlers[event].push(fn)
    return function off() {
      this._handlers[event] = (this._handlers[event] || []).filter(function (h) {
        return h !== fn
      })
    }.bind(this)
  }

  Bus.prototype.emit = function (event, payload) {
    var list = this._handlers[event] || []
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](payload)
      } catch (err) {
        console.error('[Bus]', event, err)
      }
    }
  }

  Bus.prototype.once = function (event, fn) {
    var off = this.on(
      event,
      function (payload) {
        off()
        fn(payload)
      },
    )
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.Bus = Bus
})(typeof window !== 'undefined' ? window : globalThis)
