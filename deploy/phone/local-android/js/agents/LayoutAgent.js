/* LayoutAgent — размер и положение окон */
(function (global) {
  'use strict'

  var PRESETS = {
    'chart-top': {
      label: 'График сверху, стаканы снизу',
      stack: 'chart-history-doms',
      chartPos: 'top',
      doms: 'row',
    },
    'chart-left': {
      label: 'График слева, стаканы справа',
      stack: 'chart-side',
      chartPos: 'left',
      doms: 'row',
    },
    'chart-bottom': {
      label: 'Стаканы сверху, график снизу',
      stack: 'doms-history-chart',
      chartPos: 'bottom',
      doms: 'row',
    },
    'doms-only': {
      label: 'Только стаканы',
      stack: 'doms',
      chartPos: 'hidden',
      doms: 'row',
    },
    'spot-focus': {
      label: 'Spot крупнее',
      stack: 'chart-history-doms',
      chartPos: 'top',
      doms: 'row',
      spotWide: true,
    },
    'futures-focus': {
      label: 'Futures крупнее',
      stack: 'chart-history-doms',
      chartPos: 'top',
      doms: 'row',
      futuresWide: true,
    },
  }

  var DEFAULT_LAYOUT = {
    preset: 'chart-top',
    swapDoms: false,
    showChart: true,
    showHistory: true,
    showSpot: true,
    showFutures: true,
    showRail: true,
    showRailCopy: false,
    showRailAgents: false,
    showRailDocs: true,
    showRailButtons: true,
    railCompact: false,
    railCopy:
      'График с индикаторами и инструментами, два стакана Spot/Futures, профиль и история тикеров.',
    chartHeightPct: 34,
    spotWidthPct: 50,
    railWidthPx: 168,
    chartWidthPct: 45,
  }

  function LayoutAgent(bus) {
    this.bus = bus
    this.presets = PRESETS
    this.state = global.Scalp.Config.load(
      global.Scalp.Config.KEYS.layout || 'scalp-layout-v1',
      DEFAULT_LAYOUT,
    )
    // merge defaults
    this.state = Object.assign({}, DEFAULT_LAYOUT, this.state)
    if (Number(this.state.railWidthPx) >= 220) this.state.railWidthPx = 168
    this._bind()
  }

  LayoutAgent.prototype._bind = function () {
    var self = this
    this.bus.on('layout:get', function () {
      self.bus.emit('layout:state', self.get())
    })
    this.bus.on('layout:patch', function (partial) {
      self.patch(partial)
    })
    this.bus.on('layout:preset', function (preset) {
      self.applyPreset(preset)
    })
    this.bus.on('layout:reset', function () {
      self.reset()
    })
    this.bus.on('layout:swap-doms', function () {
      self.patch({ swapDoms: !self.state.swapDoms })
    })
  }

  LayoutAgent.prototype.get = function () {
    return Object.assign({}, this.state)
  }

  LayoutAgent.prototype.patch = function (partial) {
    this.state = Object.assign({}, this.state, partial)
    // clamp
    this.state.chartHeightPct = clamp(this.state.chartHeightPct, 15, 70)
    this.state.spotWidthPct = clamp(this.state.spotWidthPct, 20, 80)
    this.state.chartWidthPct = clamp(this.state.chartWidthPct, 25, 75)
    this.state.railWidthPx = clamp(this.state.railWidthPx, 0, 360)
    global.Scalp.Config.save(global.Scalp.Config.KEYS.layout || 'scalp-layout-v1', this.state)
    this.bus.emit('layout:changed', this.get())
  }

  LayoutAgent.prototype.applyPreset = function (preset) {
    var p = PRESETS[preset]
    if (!p) return
    var patch = { preset: preset }
    if (preset === 'doms-only') patch.showChart = false
    else patch.showChart = true
    if (p.spotWide) patch.spotWidthPct = 65
    else if (p.futuresWide) patch.spotWidthPct = 35
    else if (preset === 'chart-top' || preset === 'chart-bottom') patch.spotWidthPct = 50
    this.patch(patch)
  }

  LayoutAgent.prototype.reset = function () {
    this.state = Object.assign({}, DEFAULT_LAYOUT)
    global.Scalp.Config.save(global.Scalp.Config.KEYS.layout || 'scalp-layout-v1', this.state)
    this.bus.emit('layout:changed', this.get())
  }

  LayoutAgent.prototype.start = function () {
    this.state.chartHeightPct = clamp(this.state.chartHeightPct, 15, 70)
    this.state.spotWidthPct = clamp(this.state.spotWidthPct, 20, 80)
    this.state.chartWidthPct = clamp(this.state.chartWidthPct, 25, 75)
    if (this.state.preset !== 'doms-only' && this.state.showChart === false) {
      // если график выключен не через preset «только стаканы» — вернём
      this.state.showChart = true
    }
    if (this.state.preset === 'doms-only') this.state.showChart = false
    global.Scalp.Config.save(global.Scalp.Config.KEYS.layout || 'scalp-layout-v1', this.state)
    this.bus.emit('layout:changed', this.get())
  }

  function clamp(n, a, b) {
    n = Number(n)
    if (!Number.isFinite(n)) return a
    return Math.max(a, Math.min(b, n))
  }

  global.Scalp.LayoutAgent = LayoutAgent
  global.Scalp.LAYOUT_PRESETS = PRESETS
  global.Scalp.DEFAULT_LAYOUT = DEFAULT_LAYOUT
})(typeof window !== 'undefined' ? window : globalThis)
