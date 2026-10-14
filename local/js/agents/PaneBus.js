/* PaneBus — шина с префиксом панели (spot / futures) */
(function (global) {
  'use strict'

  function PaneBus(parent, pane) {
    this.parent = parent
    this.pane = pane
    this._prefix = pane + ':'
  }

  PaneBus.prototype.on = function (event, fn) {
    return this.parent.on(this._prefix + event, fn)
  }

  PaneBus.prototype.emit = function (event, payload) {
    this.parent.emit(this._prefix + event, payload)
  }

  PaneBus.prototype.once = function (event, fn) {
    return this.parent.once(this._prefix + event, fn)
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.PaneBus = PaneBus
})(typeof window !== 'undefined' ? window : globalThis)
