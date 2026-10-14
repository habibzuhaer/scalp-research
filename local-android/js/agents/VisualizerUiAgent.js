/* VisualizerUiAgent — алиас: открывает Топ-25 в режиме «Графики» */
(function (global) {
  'use strict'

  function VisualizerUiAgent(bus, tickers, screener, root) {
    this.bus = bus
    this.root = root
    this._bind()
  }

  VisualizerUiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('ui:set-page', function (page) {
      if (self.root) self.root.hidden = true
      if (page === 'visualizer') {
        self.bus.emit('top25:set-mode', 'charts')
        // page already visualizer — Top25Ui listens and shows charts
      }
    })
  }

  VisualizerUiAgent.prototype.start = function () {
    if (this.root) this.root.hidden = true
  }

  global.Scalp.VisualizerUiAgent = VisualizerUiAgent
})(typeof window !== 'undefined' ? window : globalThis)
