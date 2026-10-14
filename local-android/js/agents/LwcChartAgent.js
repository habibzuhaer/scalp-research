/* LwcChartAgent — Lightweight Charts (вид TV): свечи, объём, 4 индикатора, рисунки */
(function (global) {
  'use strict'

  var FIB_LEVELS_DEFAULT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

  var DEFAULT_STATE = {
    symbol: 'solusdt',
    source: 'spot',
    interval: '5m',
    limit: 300,
    tool: 'crosshair',
    showVolume: true,
    fib: {
      catalog: FIB_LEVELS_DEFAULT.slice(),
      levels: FIB_LEVELS_DEFAULT.slice(),
      color: '#f0b90b',
      extend: true,
    },
    indicators: {
      sma: { on: true, visible: true, period: 20, color: '#2962ff', width: 2 },
      ema: { on: true, visible: true, period: 12, color: '#c084fc', width: 2 },
      bb: {
        on: true,
        visible: true,
        period: 20,
        mult: 2,
        colorMid: '#787b86',
        colorUpper: '#787b86',
        colorLower: '#787b86',
        fillOpacity: 0.08,
        width: 1,
      },
      rsi: {
        on: true,
        visible: true,
        period: 14,
        overbought: 82,
        oversold: 27,
        signalBars: 5,
        markOversold: true,
        color: '#f59e0b',
        width: 2,
      },
    },
    drawings: [],
  }

  var TOOLS = [
    { id: 'crosshair', label: 'Курсор', icon: '✚' },
    { id: 'hline', label: 'Горизонт', icon: '―' },
    { id: 'trend', label: 'Тренд', icon: '╱' },
    { id: 'ray', label: 'Луч', icon: '↗' },
    { id: 'fib', label: 'Фибо', icon: 'φ' },
  ]

  var TFS = ['1m', '5m', '15m', '1h', '4h']

  function deepMerge(base, over) {
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base)
    if (!over || typeof over !== 'object') return out
    Object.keys(over).forEach(function (k) {
      if (
        over[k] &&
        typeof over[k] === 'object' &&
        !Array.isArray(over[k]) &&
        out[k] &&
        typeof out[k] === 'object' &&
        !Array.isArray(out[k])
      ) {
        out[k] = deepMerge(out[k], over[k])
      } else {
        out[k] = over[k]
      }
    })
    return out
  }

  function toLwcTime(ms) {
    return Math.floor(Number(ms) / 1000)
  }

  function LwcChartAgent(bus, tickersAgent, tagsAgent, markersAgent, root, opts) {
    this.bus = bus
    this.tickers = tickersAgent
    this.tags = tagsAgent
    this.markers = markersAgent
    this.root = root
    this.opts = opts || {}
    this.id = this.opts.id || 'workb-0'
    this._storageKey = this.opts.storageKey || 'scalp-workb-chart-' + this.id
    this.state = deepMerge(DEFAULT_STATE, global.Scalp.Config.load(this._storageKey, {}))
    if (this.opts.symbol) this.state.symbol = String(this.opts.symbol).toLowerCase()
    // migrate RSI defaults 70/30 → 27/82 if still stock
    if (this.state.indicators && this.state.indicators.rsi) {
      var r = this.state.indicators.rsi
      if (r.overbought === 70 && r.oversold === 30) {
        r.overbought = 82
        r.oversold = 27
      }
      if (r.signalBars == null) r.signalBars = 5
      if (r.markOversold == null) r.markOversold = true
    }
    if (this.state.fib && !Array.isArray(this.state.fib.catalog)) {
      this.state.fib.catalog = FIB_LEVELS_DEFAULT.slice()
    }
    this.candles = []
    this.status = 'idle'
    this.error = null
    this._paused = false
    this._destroyed = false
    this._chart = null
    this._candleSeries = null
    this._volumeSeries = null
    this._smaSeries = null
    this._emaSeries = null
    this._bbMid = null
    this._bbUpper = null
    this._bbLower = null
    this._rsiChart = null
    this._rsiSeries = null
    this._overlay = null
    this._pending = null
    this._selectedId = null
    this._timer = 0
    this._active = false
    this._panel = null
    this._el = {}
    this._bindBus()
  }

  LwcChartAgent.prototype._bindBus = function () {
    var self = this
    this.bus.on('workb:select-symbol', function (payload) {
      if (!payload || !payload.symbol) return
      if (payload.cell != null && payload.cell !== self.id) return
      if (payload.cell == null && !self._active) return
      self.setSymbol(payload.symbol)
      if (payload.source) {
        self.state.source = payload.source
        self._save()
      }
    })
    this.bus.on('workb:active-cell', function (cellId) {
      self.setActive(cellId === self.id)
    })
    this.bus.on('markers:changed', function (snap) {
      if (!snap || String(snap.symbol).toLowerCase() !== String(self.state.symbol).toLowerCase()) return
      self._paintOverlay()
    })
    this.bus.on('tickers:changed', function () {
      if (self._paused || self._destroyed) return
      self.load({ soft: true })
    })
  }

  LwcChartAgent.prototype._save = function () {
    global.Scalp.Config.save(this._storageKey, this.state)
  }

  LwcChartAgent.prototype.setActive = function (on) {
    this._active = !!on
    if (this.root) this.root.classList.toggle('workb-cell-active', this._active)
  }

  LwcChartAgent.prototype.setSymbol = function (symbol) {
    this.state.symbol = String(symbol || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    this._rsiWarm = 0
    this._prevRsiStreak = 0
    this._save()
    if (this._el.symbol) this._el.symbol.value = this.state.symbol.toUpperCase()
    this._updateTagBadge()
    this.load()
  }

  LwcChartAgent.prototype._pane = function () {
    var t = this.tickers.get()
    var src = this.state.source === 'futures' ? 'futures' : 'spot'
    var p = t[src] || t.spot || {}
    return {
      exchange: p.exchange,
      restBaseUrl: p.restBaseUrl,
      market: p.market || src,
      symbol: this.state.symbol || p.symbol || 'btcusdt',
      source: src,
    }
  }

  LwcChartAgent.prototype._intervalMeta = function () {
    var id = this.state.interval || '5m'
    var found = null
    ;(global.Scalp.Config.CHART_INTERVALS || []).forEach(function (x) {
      if (x.id === id) found = x
    })
    return found || { id: id, label: id }
  }

  LwcChartAgent.prototype._klinesUrl = function () {
    var pane = this._pane()
    var base = String(pane.restBaseUrl || '').replace(/\/+$/, '')
    var sym = String(pane.symbol || 'btcusdt').toUpperCase()
    var interval = this.state.interval || '5m'
    var limit = Math.min(1000, this.state.limit || 300)
    if (pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') {
      var iv = '5'
      ;(global.Scalp.Config.CHART_INTERVALS || []).forEach(function (x) {
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

  LwcChartAgent.prototype._parseKlines = function (raw, exchange) {
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

  LwcChartAgent.prototype.start = function () {
    this._mount()
    this.load()
  }

  LwcChartAgent.prototype.pause = function () {
    this._paused = true
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = 0
    }
  }

  LwcChartAgent.prototype.resume = function () {
    this._paused = false
    this._fit()
    this.load({ soft: true })
    this._startPoll()
  }

  LwcChartAgent.prototype.destroy = function () {
    this._destroyed = true
    this.pause()
    if (this._chart) {
      try {
        this._chart.remove()
      } catch (e) {}
    }
    if (this._rsiChart) {
      try {
        this._rsiChart.remove()
      } catch (e) {}
    }
    this._chart = null
  }

  LwcChartAgent.prototype._mount = function () {
    if (!this.root || this._chart) return
    var LW = global.LightweightCharts
    if (!LW || !LW.createChart) {
      this.root.innerHTML =
        '<div class="workb-err">Lightweight Charts не загружен</div>'
      return
    }
    var self = this
    var tag = this.tags
      ? this.tags.resolve(this.state.symbol, this._pane().exchange)
      : { chain: 'other', color: '#8b93a7' }

    var toolsHtml = TOOLS.map(function (t) {
      return (
        '<button type="button" class="tool-btn' +
        (self.state.tool === t.id ? ' active' : '') +
        '" data-tool="' +
        t.id +
        '" title="' +
        t.label +
        '">' +
        t.icon +
        '</button>'
      )
    }).join('')

    var tfHtml = TFS.map(function (tf) {
      return (
        '<button type="button" class="chart-tf' +
        (self.state.interval === tf ? ' active' : '') +
        '" data-tf="' +
        tf +
        '">' +
        tf +
        '</button>'
      )
    }).join('')

    this.root.innerHTML =
      '<div class="workb-cell-inner">' +
      '  <div class="workb-toolbar">' +
      '    <input class="chart-sym-input" data-el="symbol" value="' +
      String(this.state.symbol || '').toUpperCase() +
      '" spellcheck="false" />' +
      '    <span class="workb-chain-badge" data-el="chain" data-chain="' +
      tag.chain +
      '">' +
      (tag.chain === 'other' ? '' : tag.chain.toUpperCase()) +
      '</span>' +
      '    <div class="chart-tfs">' +
      tfHtml +
      '</div>' +
      '    <div class="chart-tools">' +
      toolsHtml +
      '      <button type="button" class="tool-btn" data-act="ind" title="Индикаторы">⚙</button>' +
      '      <button type="button" class="tool-btn" data-act="fib-set" title="Настройки Фибо">φ⚙</button>' +
      '      <button type="button" class="tool-btn" data-act="del-one" title="Удалить выбранный рисунок (Del)">🗑</button>' +
      '      <button type="button" class="tool-btn" data-act="clear" title="Очистить все рисунки">⌫</button>' +
      '    </div>' +
      '    <span class="workb-status" data-el="status"></span>' +
      '  </div>' +
      '  <div class="workb-chart-body">' +
      '    <div class="workb-lwc" data-el="lwc"></div>' +
      '    <canvas class="workb-overlay" data-el="overlay"></canvas>' +
      '    <div class="workb-rsi" data-el="rsi"></div>' +
      '    <div class="workb-panel" data-el="panel" hidden></div>' +
      '  </div>' +
      '</div>'

    this._el.symbol = this.root.querySelector('[data-el="symbol"]')
    this._el.chain = this.root.querySelector('[data-el="chain"]')
    this._el.status = this.root.querySelector('[data-el="status"]')
    this._el.lwc = this.root.querySelector('[data-el="lwc"]')
    this._el.rsi = this.root.querySelector('[data-el="rsi"]')
    this._el.panel = this.root.querySelector('[data-el="panel"]')
    this._overlay = this.root.querySelector('[data-el="overlay"]')

    this._chart = LW.createChart(this._el.lwc, {
      layout: {
        background: { color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42,46,57,0.6)' },
        horzLines: { color: 'rgba(42,46,57,0.6)' },
      },
      crosshair: { mode: LW.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2e39' },
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
      width: this._el.lwc.clientWidth || 400,
      height: Math.max(120, (this._el.lwc.clientHeight || 220) - 0),
    })

    this._candleSeries = this._chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    this._volumeSeries = this._chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    this._chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    this._smaSeries = this._chart.addLineSeries({ color: this.state.indicators.sma.color, lineWidth: this.state.indicators.sma.width, priceLineVisible: false, lastValueVisible: false })
    this._emaSeries = this._chart.addLineSeries({ color: this.state.indicators.ema.color, lineWidth: this.state.indicators.ema.width, priceLineVisible: false, lastValueVisible: false })
    this._bbMid = this._chart.addLineSeries({ color: this.state.indicators.bb.colorMid, lineWidth: this.state.indicators.bb.width, priceLineVisible: false, lastValueVisible: false })
    this._bbUpper = this._chart.addLineSeries({ color: this.state.indicators.bb.colorUpper, lineWidth: this.state.indicators.bb.width, priceLineVisible: false, lastValueVisible: false })
    this._bbLower = this._chart.addLineSeries({ color: this.state.indicators.bb.colorLower, lineWidth: this.state.indicators.bb.width, priceLineVisible: false, lastValueVisible: false })

    this._rsiChart = LW.createChart(this._el.rsi, {
      layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: 'rgba(42,46,57,0.4)' }, horzLines: { color: 'rgba(42,46,57,0.4)' } },
      rightPriceScale: { borderColor: '#2a2e39' },
      timeScale: { visible: false },
      width: this._el.rsi.clientWidth || 400,
      height: 72,
    })
    this._rsiSeries = this._rsiChart.addLineSeries({
      color: this.state.indicators.rsi.color,
      lineWidth: this.state.indicators.rsi.width,
      priceLineVisible: false,
    })

    this._chart.timeScale().subscribeVisibleLogicalRangeChange(function () {
      self._syncRsiRange()
      self._paintOverlay()
    })
    this._chart.subscribeCrosshairMove(function () {
      self._paintOverlay()
    })

    this.root.addEventListener('click', function () {
      self.bus.emit('workb:active-cell', self.id)
    })

    this._el.symbol.addEventListener('change', function () {
      self.setSymbol(self._el.symbol.value)
    })
    this._el.symbol.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        self.setSymbol(self._el.symbol.value)
      }
    })

    this.root.querySelectorAll('[data-tf]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation()
        self.state.interval = btn.getAttribute('data-tf')
        self._save()
        self.root.querySelectorAll('[data-tf]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-tf') === self.state.interval)
        })
        self.load()
      })
    })

    this.root.querySelectorAll('[data-tool]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation()
        self.state.tool = btn.getAttribute('data-tool')
        self._pending = null
        self._save()
        self.root.querySelectorAll('[data-tool]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-tool') === self.state.tool)
        })
        self._setOverlayPointer()
        if (self.state.tool === 'fib') self._openFibPanel()
      })
    })

    this.root.querySelector('[data-act="clear"]').addEventListener('click', function (e) {
      e.stopPropagation()
      self.state.drawings = []
      self._selectedId = null
      self._save()
      self._paintOverlay()
    })
    this.root.querySelector('[data-act="del-one"]').addEventListener('click', function (e) {
      e.stopPropagation()
      self._deleteSelected()
    })
    this.root.querySelector('[data-act="ind"]').addEventListener('click', function (e) {
      e.stopPropagation()
      self._openIndPanel()
    })
    this.root.querySelector('[data-act="fib-set"]').addEventListener('click', function (e) {
      e.stopPropagation()
      self._openFibPanel()
    })

    this._overlay.addEventListener('mousedown', function (e) {
      self._onDrawDown(e)
    })
    this._overlay.addEventListener('mousemove', function (e) {
      self._onDrawMove(e)
    })
    this._overlay.addEventListener('mouseup', function (e) {
      self._onDrawUp(e)
    })
    // select drawings when cursor tool (chart click)
    this._chart.subscribeClick(function (param) {
      if (self.state.tool !== 'crosshair') return
      if (!param || !param.point) return
      self.bus.emit('workb:active-cell', self.id)
      var hit = self._hitTest(param.point.x, param.point.y)
      self._selectedId = hit ? hit.id : null
      self._paintOverlay()
    })
    this.root.addEventListener('keydown', function (e) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (self._selectedId) {
          e.preventDefault()
          self._deleteSelected()
        }
      }
      if (e.key === 'Escape') {
        self._selectedId = null
        self._paintOverlay()
      }
    })
    // make cell focusable for Delete key
    this.root.tabIndex = 0
    this.root.addEventListener('mousedown', function () {
      self.root.focus({ preventScroll: true })
    })

    window.addEventListener('resize', function () {
      self._fit()
    })
    this._setOverlayPointer()
    this._fit()
    this._startPoll()
  }

  LwcChartAgent.prototype._setOverlayPointer = function () {
    if (!this._overlay) return
    var draw = this.state.tool && this.state.tool !== 'crosshair'
    this._overlay.style.pointerEvents = draw ? 'auto' : 'none'
  }

  LwcChartAgent.prototype._fit = function () {
    if (!this._chart || !this._el.lwc) return
    var w = this._el.lwc.clientWidth
    var h = this._el.lwc.clientHeight
    if (w > 0 && h > 0) this._chart.applyOptions({ width: w, height: h })
    if (this._rsiChart && this._el.rsi) {
      var rw = this._el.rsi.clientWidth
      if (rw > 0) this._rsiChart.applyOptions({ width: rw, height: 72 })
    }
    this._sizeOverlay()
    this._paintOverlay()
  }

  LwcChartAgent.prototype._sizeOverlay = function () {
    if (!this._overlay || !this._el.lwc) return
    var r = this._el.lwc.getBoundingClientRect()
    var dpr = window.devicePixelRatio || 1
    this._overlay.style.width = r.width + 'px'
    this._overlay.style.height = r.height + 'px'
    this._overlay.width = Math.floor(r.width * dpr)
    this._overlay.height = Math.floor(r.height * dpr)
    var ctx = this._overlay.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  LwcChartAgent.prototype._startPoll = function () {
    var self = this
    if (this._timer) clearInterval(this._timer)
    this._timer = setInterval(function () {
      if (self._paused || self._destroyed) return
      self.load({ soft: true })
    }, 15000)
  }

  LwcChartAgent.prototype._updateTagBadge = function () {
    if (!this._el.chain || !this.tags) return
    var tag = this.tags.resolve(this.state.symbol, this._pane().exchange)
    this._el.chain.setAttribute('data-chain', tag.chain)
    this._el.chain.textContent = tag.chain === 'other' ? '' : tag.chain.toUpperCase()
    this._el.chain.style.background = tag.chain === 'other' ? 'transparent' : tag.color
    this._el.chain.style.color = tag.chain === 'bnb' ? '#111' : '#0b0f14'
  }

  LwcChartAgent.prototype.load = async function (opts) {
    opts = opts || {}
    if (this._paused || this._destroyed || !this._candleSeries) return
    this._loadSeq = (this._loadSeq || 0) + 1
    var seq = this._loadSeq
    if (!opts.soft) {
      this.status = 'loading'
      this._paintStatus()
    }
    try {
      var pane = this._pane()
      var meta = this._intervalMeta()
      if ((pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') && meta.sec) {
        throw new Error('ТФ ' + meta.label + ' не для Bybit в Workb')
      }
      if ((pane.exchange === 'bybit' || pane.exchange === 'bybit-futures') && !meta.bybit && meta.sec == null) {
        // still try standard intervals with bybit mapping
      }
      var res = await fetch(this._klinesUrl())
      if (!res.ok) throw new Error('Klines HTTP ' + res.status)
      var raw = await res.json()
      if (seq !== this._loadSeq) return
      var candles = this._parseKlines(raw, pane.exchange)
      this.candles = candles
      this.status = 'live'
      this.error = null
      this._applySeries()
      this._paintStatus()
      this._paintOverlay()
    } catch (err) {
      if (seq !== this._loadSeq) return
      this.status = 'error'
      this.error = (err && err.message) || String(err)
      this._paintStatus()
    }
  }

  LwcChartAgent.prototype._paintStatus = function () {
    if (!this._el.status) return
    this._el.status.textContent =
      this.status === 'error' ? this.error || 'err' : this.status === 'loading' ? '…' : ''
  }

  LwcChartAgent.prototype._lineData = function (arr) {
    var out = []
    for (var i = 0; i < this.candles.length; i++) {
      if (arr[i] == null || !isFinite(arr[i])) continue
      out.push({ time: toLwcTime(this.candles[i].time), value: arr[i] })
    }
    return out
  }

  LwcChartAgent.prototype._applySeries = function () {
    var candleData = this.candles.map(function (c) {
      return {
        time: toLwcTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }
    })
    var volData = this.candles.map(function (c) {
      return {
        time: toLwcTime(c.time),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)',
      }
    })
    this._candleSeries.setData(candleData)
    if (this.state.showVolume !== false) this._volumeSeries.setData(volData)
    else this._volumeSeries.setData([])

    var ind = global.Scalp.Indicators.computeConfigured(this.candles, this.state.indicators)
    var smaOn = this.state.indicators.sma.on !== false && this.state.indicators.sma.visible !== false
    var emaOn = this.state.indicators.ema.on !== false && this.state.indicators.ema.visible !== false
    var bbOn = this.state.indicators.bb.on !== false && this.state.indicators.bb.visible !== false
    var rsiOn = this.state.indicators.rsi.on !== false && this.state.indicators.rsi.visible !== false

    this._smaSeries.applyOptions({
      color: this.state.indicators.sma.color,
      lineWidth: this.state.indicators.sma.width || 2,
      visible: smaOn,
    })
    this._emaSeries.applyOptions({
      color: this.state.indicators.ema.color,
      lineWidth: this.state.indicators.ema.width || 2,
      visible: emaOn,
    })
    this._bbMid.applyOptions({ color: this.state.indicators.bb.colorMid, visible: bbOn })
    this._bbUpper.applyOptions({ color: this.state.indicators.bb.colorUpper, visible: bbOn })
    this._bbLower.applyOptions({ color: this.state.indicators.bb.colorLower, visible: bbOn })

    this._smaSeries.setData(smaOn && ind.sma ? this._lineData(ind.sma) : [])
    this._emaSeries.setData(emaOn && ind.ema ? this._lineData(ind.ema) : [])
    if (bbOn && ind.bb) {
      this._bbMid.setData(this._lineData(ind.bb.mid))
      this._bbUpper.setData(this._lineData(ind.bb.upper))
      this._bbLower.setData(this._lineData(ind.bb.lower))
    } else {
      this._bbMid.setData([])
      this._bbUpper.setData([])
      this._bbLower.setData([])
    }

    if (this._el.rsi) this._el.rsi.style.display = rsiOn ? 'block' : 'none'
    if (rsiOn && ind.rsi) {
      this._rsiSeries.applyOptions({ color: this.state.indicators.rsi.color })
      this._rsiSeries.setData(this._lineData(ind.rsi))
      if (!this._rsiLines) {
        var ob = Number(this.state.indicators.rsi.overbought) || 82
        var os = Number(this.state.indicators.rsi.oversold) || 27
        this._rsiLines = {
          ob: this._rsiSeries.createPriceLine({
            price: ob,
            color: 'rgba(239,83,80,0.5)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'OB',
          }),
          os: this._rsiSeries.createPriceLine({
            price: os,
            color: 'rgba(38,166,154,0.5)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'OS',
          }),
        }
      } else {
        this._rsiLines.ob.applyOptions({ price: Number(this.state.indicators.rsi.overbought) || 82 })
        this._rsiLines.os.applyOptions({ price: Number(this.state.indicators.rsi.oversold) || 27 })
      }
    } else if (this._rsiSeries) {
      this._rsiSeries.setData([])
    }

    // markers: user + RSI oversold streak
    var marks = []
    if (this.markers) {
      var list = this.markers.list(this.state.source === 'futures' ? 'futures' : 'spot', this.state.symbol)
      list.forEach(function (m) {
        if (!m.visible || m.time == null) return
        marks.push({
          time: toLwcTime(m.time),
          position: 'belowBar',
          color: m.color || '#f0b90b',
          shape: 'circle',
          text: m.label || '',
        })
      })
    }
    if (rsiOn && ind.rsi && this.state.indicators.rsi.markOversold !== false) {
      var osLvl = Number(this.state.indicators.rsi.oversold)
      if (!isFinite(osLvl)) osLvl = 27
      var need = Math.max(1, Number(this.state.indicators.rsi.signalBars) || 5)
      var streak = 0
      for (var ri = 0; ri < ind.rsi.length; ri++) {
        var rv = ind.rsi[ri]
        if (rv == null || !isFinite(rv)) {
          streak = 0
          continue
        }
        if (rv <= osLvl) streak++
        else streak = 0
        if (streak > need) {
          marks.push({
            time: toLwcTime(this.candles[ri].time),
            position: 'belowBar',
            color: '#26a69a',
            shape: 'arrowUp',
            text: 'RSI≤' + osLvl,
          })
        }
      }
    }

    // RSI markers on chart only — Telegram шлётся отдельно через poll (если включено)
    if (false && rsiOn && ind.rsi && ind.rsi.length) {
      var osAlert = Number(this.state.indicators.rsi.oversold)
      if (!isFinite(osAlert)) osAlert = 27
      var needAlert = Math.max(1, Number(this.state.indicators.rsi.signalBars) || 5)
      var st = 0
      for (var si = 0; si < ind.rsi.length; si++) {
        var sv = ind.rsi[si]
        if (sv == null || !isFinite(sv)) {
          st = 0
          continue
        }
        if (sv <= osAlert) st++
        else st = 0
      }
      if (!this._rsiWarm) {
        this._rsiWarm = 1
        this._prevRsiStreak = st
      } else {
        var prevSt = this._prevRsiStreak || 0
        this._prevRsiStreak = st
        if (st === needAlert + 1 && prevSt === needAlert && this.bus) {
          var lastC = this.candles[this.candles.length - 1]
          this.bus.emit('alert:rsi', {
            symbol: this.state.symbol,
            label: String(this.state.symbol || '').toUpperCase(),
            interval: this.state.interval || '5m',
            oversold: osAlert,
            bars: st,
            rsi: ind.rsi[ind.rsi.length - 1],
            price: lastC ? lastC.close : null,
            candles: this.candles,
            source: 'workb',
            ts: Date.now(),
          })
        }
      }
    } else {
      this._prevRsiStreak = 0
      this._rsiWarm = 0
    }
    try {
      this._candleSeries.setMarkers(marks)
    } catch (e) {}

    if (!this._didFitOnce && candleData.length) {
      this._chart.timeScale().fitContent()
      this._didFitOnce = true
    }
    this._syncRsiRange()
  }

  LwcChartAgent.prototype._syncRsiRange = function () {
    if (!this._chart || !this._rsiChart) return
    try {
      var range = this._chart.timeScale().getVisibleLogicalRange()
      if (range) this._rsiChart.timeScale().setVisibleLogicalRange(range)
    } catch (e) {}
  }

  LwcChartAgent.prototype._newDrawId = function () {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  }

  LwcChartAgent.prototype._ensureDrawIds = function () {
    var changed = false
    ;(this.state.drawings || []).forEach(function (d) {
      if (!d.id) {
        d.id = 'd' + Math.random().toString(36).slice(2, 9)
        changed = true
      }
    })
    if (changed) this._save()
  }

  LwcChartAgent.prototype._deleteSelected = function () {
    if (!this._selectedId) return
    var id = this._selectedId
    this.state.drawings = (this.state.drawings || []).filter(function (d) {
      return d.id !== id
    })
    this._selectedId = null
    this._save()
    this._paintOverlay()
  }

  LwcChartAgent.prototype._distPointSeg = function (px, py, x1, y1, x2, y2) {
    var dx = x2 - x1
    var dy = y2 - y1
    var len2 = dx * dx + dy * dy
    if (len2 < 1e-6) {
      var ax = px - x1
      var ay = py - y1
      return Math.sqrt(ax * ax + ay * ay)
    }
    var t = ((px - x1) * dx + (py - y1) * dy) / len2
    if (t < 0) t = 0
    if (t > 1) t = 1
    var sx = x1 + t * dx
    var sy = y1 + t * dy
    var ex = px - sx
    var ey = py - sy
    return Math.sqrt(ex * ex + ey * ey)
  }

  LwcChartAgent.prototype._hitTest = function (x, y) {
    this._ensureDrawIds()
    var drawings = this.state.drawings || []
    var best = null
    var bestDist = 8
    var w = this._overlay ? this._overlay.clientWidth : 0
    for (var i = drawings.length - 1; i >= 0; i--) {
      var d = drawings[i]
      if (d.type === 'hline') {
        var hy = this._candleSeries.priceToCoordinate(d.price)
        if (hy == null) continue
        var hd = Math.abs(y - hy)
        if (hd < bestDist) {
          bestDist = hd
          best = d
        }
      } else if (d.type === 'trend' || d.type === 'ray') {
        var a = this._xy(d.t1, d.p1)
        var b = this._xy(d.t2, d.p2)
        if (!a || !b) continue
        var x2 = b.x
        var y2 = b.y
        if (d.type === 'ray') {
          var rdx = b.x - a.x
          var rdy = b.y - a.y
          if (Math.abs(rdx) < 0.001) rdx = 0.001
          var scale = (w - a.x) / rdx
          if (scale < 1) scale = 1
          x2 = a.x + rdx * scale
          y2 = a.y + rdy * scale
        }
        var td = this._distPointSeg(x, y, a.x, a.y, x2, y2)
        if (td < bestDist) {
          bestDist = td
          best = d
        }
      } else if (d.type === 'fib') {
        var levels = d.levels || FIB_LEVELS_DEFAULT
        var pLo = Math.min(d.p1, d.p2)
        var pHi = Math.max(d.p1, d.p2)
        for (var li = 0; li < levels.length; li++) {
          var price = pHi - (pHi - pLo) * levels[li]
          var fy = this._candleSeries.priceToCoordinate(price)
          if (fy == null) continue
          var fd = Math.abs(y - fy)
          if (fd < bestDist) {
            bestDist = fd
            best = d
          }
        }
      }
    }
    return best
  }

  LwcChartAgent.prototype._eventPoint = function (e) {
    var rect = this._overlay.getBoundingClientRect()
    var x = e.clientX - rect.left
    var y = e.clientY - rect.top
    var time = this._chart.timeScale().coordinateToTime(x)
    var price = this._candleSeries.coordinateToPrice(y)
    if (time == null || price == null || !isFinite(price)) return null
    var tMs = typeof time === 'object' ? null : Number(time) * 1000
    return { x: x, y: y, time: time, timeMs: tMs, price: price }
  }

  LwcChartAgent.prototype._onDrawDown = function (e) {
    if (this.state.tool === 'crosshair') return
    var p = this._eventPoint(e)
    if (!p) return
    e.preventDefault()
    e.stopPropagation()
    this.bus.emit('workb:active-cell', this.id)
    this._selectedId = null
    if (this.state.tool === 'hline') {
      this.state.drawings.push({
        id: this._newDrawId(),
        type: 'hline',
        price: p.price,
        color: '#d1d4dc',
      })
      this._save()
      this._paintOverlay()
      return
    }
    this._pending = { type: this.state.tool, a: p }
  }

  LwcChartAgent.prototype._onDrawMove = function (e) {
    if (!this._pending) return
    var p = this._eventPoint(e)
    if (!p) return
    this._pending.b = p
    this._paintOverlay()
  }

  LwcChartAgent.prototype._onDrawUp = function (e) {
    if (!this._pending) return
    var p = this._eventPoint(e) || this._pending.b
    if (!p || !this._pending.a) {
      this._pending = null
      return
    }
    var a = this._pending.a
    var type = this._pending.type
    this._pending = null
    if (type === 'trend' || type === 'ray') {
      this.state.drawings.push({
        id: this._newDrawId(),
        type: type,
        t1: a.time,
        p1: a.price,
        t2: p.time,
        p2: p.price,
        color: '#5b9cff',
      })
    } else if (type === 'fib') {
      this.state.drawings.push({
        id: this._newDrawId(),
        type: 'fib',
        t1: a.time,
        p1: a.price,
        t2: p.time,
        p2: p.price,
        color: this.state.fib.color,
        levels: (this.state.fib.levels || FIB_LEVELS_DEFAULT).slice(),
        extend: this.state.fib.extend !== false,
      })
    }
    this._save()
    this._paintOverlay()
  }

  LwcChartAgent.prototype._xy = function (time, price) {
    var x = this._chart.timeScale().timeToCoordinate(time)
    var y = this._candleSeries.priceToCoordinate(price)
    if (x == null || y == null) return null
    return { x: x, y: y }
  }

  LwcChartAgent.prototype._paintOverlay = function () {
    if (!this._overlay || !this._candleSeries) return
    var ctx = this._overlay.getContext('2d')
    var w = this._overlay.clientWidth
    var h = this._overlay.clientHeight
    ctx.clearRect(0, 0, w, h)

    this._ensureDrawIds()
    var drawings = this.state.drawings.slice()
    if (this._pending && this._pending.a && this._pending.b) {
      drawings.push({
        type: this._pending.type,
        t1: this._pending.a.time,
        p1: this._pending.a.price,
        t2: this._pending.b.time,
        p2: this._pending.b.price,
        color: '#5b9cff',
        levels: (this.state.fib.levels || FIB_LEVELS_DEFAULT).slice(),
        extend: this.state.fib.extend !== false,
      })
    }

    for (var i = 0; i < drawings.length; i++) {
      var d = drawings[i]
      var selected = d.id && d.id === this._selectedId
      var lw = selected ? 2.5 : 1.5
      if (d.type === 'hline') {
        var y = this._candleSeries.priceToCoordinate(d.price)
        if (y == null) continue
        if (selected) {
          ctx.strokeStyle = 'rgba(91,156,255,0.35)'
          ctx.lineWidth = 6
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
        }
        ctx.strokeStyle = selected ? '#5b9cff' : d.color || '#d1d4dc'
        ctx.lineWidth = selected ? 2 : 1
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
        ctx.fillStyle = selected ? '#5b9cff' : d.color || '#d1d4dc'
        ctx.font = '11px IBM Plex Sans, sans-serif'
        ctx.fillText(Number(d.price).toPrecision(6) + (selected ? '  ✕ Del' : ''), 6, y - 4)
      } else if (d.type === 'trend' || d.type === 'ray') {
        var a = this._xy(d.t1, d.p1)
        var b = this._xy(d.t2, d.p2)
        if (!a || !b) continue
        ctx.strokeStyle = selected ? '#5b9cff' : d.color || '#5b9cff'
        ctx.lineWidth = lw
        ctx.beginPath()
        if (d.type === 'ray') {
          var dx = b.x - a.x
          var dy = b.y - a.y
          if (Math.abs(dx) < 0.001) dx = 0.001
          var scale = (w - a.x) / dx
          if (scale < 1) scale = 1
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(a.x + dx * scale, a.y + dy * scale)
        } else {
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
        }
        ctx.stroke()
        if (selected) {
          ctx.fillStyle = '#5b9cff'
          ctx.beginPath()
          ctx.arc(a.x, a.y, 4, 0, Math.PI * 2)
          ctx.arc(b.x, b.y, 4, 0, Math.PI * 2)
          ctx.fill()
        }
      } else if (d.type === 'fib') {
        var fa = this._xy(d.t1, d.p1)
        var fb = this._xy(d.t2, d.p2)
        if (!fa || !fb) continue
        var levels = d.levels || FIB_LEVELS_DEFAULT
        var pLo = Math.min(d.p1, d.p2)
        var pHi = Math.max(d.p1, d.p2)
        var x1 = Math.min(fa.x, fb.x)
        var x2 = d.extend !== false ? w : Math.max(fa.x, fb.x)
        ctx.font = '10px IBM Plex Sans, sans-serif'
        for (var li = 0; li < levels.length; li++) {
          var lv = levels[li]
          var price = pHi - (pHi - pLo) * lv
          var yy = this._candleSeries.priceToCoordinate(price)
          if (yy == null) continue
          ctx.strokeStyle = selected ? '#5b9cff' : d.color || this.state.fib.color || '#f0b90b'
          ctx.lineWidth = selected ? 2 : 1
          ctx.globalAlpha = 0.85
          ctx.beginPath()
          ctx.moveTo(x1, yy)
          ctx.lineTo(x2, yy)
          ctx.stroke()
          ctx.globalAlpha = 1
          ctx.fillStyle = selected ? '#5b9cff' : d.color || '#f0b90b'
          ctx.fillText(lv.toFixed(3) + '  ' + price.toPrecision(6), x1 + 4, yy - 3)
        }
        if (selected) {
          ctx.fillStyle = '#5b9cff'
          ctx.font = '11px IBM Plex Sans, sans-serif'
          ctx.fillText('Фибо · Del / 🗑', x1 + 4, Math.min(fa.y, fb.y) - 8)
        }
      }
    }

    // price markers without time — horizontal dashed
    if (this.markers) {
      var list = this.markers.list(this.state.source === 'futures' ? 'futures' : 'spot', this.state.symbol)
      for (var mi = 0; mi < list.length; mi++) {
        var m = list[mi]
        if (!m.visible || m.price == null || m.time != null) continue
        var my = this._candleSeries.priceToCoordinate(Number(m.price))
        if (my == null) continue
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = m.color || '#f0b90b'
        ctx.beginPath()
        ctx.moveTo(0, my)
        ctx.lineTo(w, my)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = m.color || '#f0b90b'
        ctx.font = '11px IBM Plex Sans, sans-serif'
        ctx.fillText(m.label || '', 8, my - 4)
      }
    }
  }

  LwcChartAgent.prototype._closePanel = function () {
    if (this._el.panel) {
      this._el.panel.hidden = true
      this._el.panel.innerHTML = ''
    }
  }

  LwcChartAgent.prototype._openFibPanel = function () {
    var self = this
    var fib = this.state.fib
    var catalog = (fib.catalog && fib.catalog.length ? fib.catalog : FIB_LEVELS_DEFAULT).slice()
    catalog.sort(function (a, b) {
      return a - b
    })
    var active = fib.levels || catalog.slice()
    var rows = catalog
      .map(function (lv) {
        var on = active.indexOf(lv) >= 0 || active.indexOf(Number(lv)) >= 0
        return (
          '<label class="workb-fib-row">' +
          '<input type="checkbox" data-fib-lv="' +
          lv +
          '"' +
          (on ? ' checked' : '') +
          '>' +
          '<input type="number" step="0.001" min="0" max="5" data-fib-edit="' +
          lv +
          '" value="' +
          lv +
          '" class="workb-fib-val">' +
          '<button type="button" class="workb-fib-del" data-fib-del="' +
          lv +
          '" title="Убрать из каталога">×</button>' +
          '</label>'
        )
      })
      .join('')
    this._el.panel.hidden = false
    this._el.panel.innerHTML =
      '<div class="workb-panel-card">' +
      '<header><strong>Фибо — уровни</strong><button type="button" data-act="panel-close">×</button></header>' +
      '<div class="workb-panel-body">' +
      '<p class="workb-hint">Вкл/выкл уровни, правьте значение, добавьте свой.</p>' +
      '<div class="workb-fib-list">' +
      rows +
      '</div>' +
      '<div class="workb-tags-row">' +
      '<input type="number" step="0.001" min="0" max="5" data-fib-new placeholder="напр. 0.886" class="workb-fib-val">' +
      '<button type="button" class="btn ghost" data-act="fib-add">+ Уровень</button>' +
      '</div>' +
      '<label>Цвет <input type="color" data-fib="color" value="' +
      (fib.color || '#f0b90b') +
      '"></label>' +
      '<label class="workb-check"><input type="checkbox" data-fib="extend"' +
      (fib.extend !== false ? ' checked' : '') +
      '> Extend вправо</label>' +
      '</div>' +
      '<footer><button type="button" class="btn ghost" data-act="fib-reset">Сброс</button>' +
      '<button type="button" class="btn primary" data-act="fib-apply">Применить</button></footer>' +
      '</div>'
    this._el.panel.querySelector('[data-act="panel-close"]').onclick = function () {
      self._closePanel()
    }
    this._el.panel.querySelector('[data-act="fib-reset"]').onclick = function () {
      self.state.fib = deepMerge(DEFAULT_STATE.fib, {})
      self._save()
      self._openFibPanel()
      self._paintOverlay()
    }
    this._el.panel.querySelector('[data-act="fib-add"]').onclick = function () {
      var inp = self._el.panel.querySelector('[data-fib-new]')
      var v = Number(inp && inp.value)
      if (!isFinite(v) || v < 0) return
      v = Math.round(v * 1000) / 1000
      if (!self.state.fib.catalog) self.state.fib.catalog = FIB_LEVELS_DEFAULT.slice()
      if (self.state.fib.catalog.indexOf(v) < 0) self.state.fib.catalog.push(v)
      if (!self.state.fib.levels) self.state.fib.levels = []
      if (self.state.fib.levels.indexOf(v) < 0) self.state.fib.levels.push(v)
      self._save()
      self._openFibPanel()
    }
    this._el.panel.querySelectorAll('[data-fib-del]').forEach(function (btn) {
      btn.onclick = function () {
        var v = Number(btn.getAttribute('data-fib-del'))
        self.state.fib.catalog = (self.state.fib.catalog || []).filter(function (x) {
          return Number(x) !== v
        })
        self.state.fib.levels = (self.state.fib.levels || []).filter(function (x) {
          return Number(x) !== v
        })
        self._save()
        self._openFibPanel()
      }
    })
    this._el.panel.querySelector('[data-act="fib-apply"]').onclick = function () {
      var nextCat = []
      var nextOn = []
      self._el.panel.querySelectorAll('.workb-fib-row').forEach(function (row) {
        var edit = row.querySelector('[data-fib-edit]')
        var chk = row.querySelector('[data-fib-lv]')
        var v = Number(edit && edit.value)
        if (!isFinite(v)) return
        v = Math.round(v * 1000) / 1000
        if (nextCat.indexOf(v) < 0) nextCat.push(v)
        if (chk && chk.checked && nextOn.indexOf(v) < 0) nextOn.push(v)
      })
      nextCat.sort(function (a, b) {
        return a - b
      })
      nextOn.sort(function (a, b) {
        return a - b
      })
      self.state.fib.catalog = nextCat
      self.state.fib.levels = nextOn
      self.state.fib.color = self._el.panel.querySelector('[data-fib="color"]').value
      self.state.fib.extend = self._el.panel.querySelector('[data-fib="extend"]').checked
      // update existing fib drawings to new levels
      ;(self.state.drawings || []).forEach(function (d) {
        if (d.type === 'fib') {
          d.levels = nextOn.slice()
          d.color = self.state.fib.color
          d.extend = self.state.fib.extend
        }
      })
      self._save()
      self._closePanel()
      self._paintOverlay()
    }
  }

  LwcChartAgent.prototype._openIndPanel = function () {
    var self = this
    var ind = this.state.indicators
    function block(name, key, extra) {
      var c = ind[key]
      return (
        '<fieldset class="workb-ind-block" data-ind="' +
        key +
        '"><legend>' +
        name +
        '</legend>' +
        '<label class="workb-check"><input type="checkbox" data-f="on"' +
        (c.on !== false ? ' checked' : '') +
        '> Вкл</label>' +
        '<label>Период <input type="number" min="2" max="500" data-f="period" value="' +
        (c.period || 14) +
        '"></label>' +
        '<label>Цвет <input type="color" data-f="color" value="' +
        (c.color || c.colorMid || '#2962ff') +
        '"></label>' +
        '<label>Толщина <input type="number" min="1" max="4" data-f="width" value="' +
        (c.width || 2) +
        '"></label>' +
        (extra || '') +
        '</fieldset>'
      )
    }
    var bbExtra =
      '<label>σ <input type="number" min="0.5" max="5" step="0.1" data-f="mult" value="' +
      (ind.bb.mult || 2) +
      '"></label>'
    var rsiExtra =
      '<label>OB <input type="number" min="1" max="99" data-f="overbought" value="' +
      (ind.rsi.overbought != null ? ind.rsi.overbought : 82) +
      '"></label>' +
      '<label>OS <input type="number" min="1" max="99" data-f="oversold" value="' +
      (ind.rsi.oversold != null ? ind.rsi.oversold : 27) +
      '"></label>' +
      '<label>Баров ≤OS <input type="number" min="1" max="50" data-f="signalBars" value="' +
      (ind.rsi.signalBars != null ? ind.rsi.signalBars : 5) +
      '" title="Метка, если RSI≤OS дольше N баров"></label>' +
      '<label class="workb-check"><input type="checkbox" data-f="markOversold"' +
      (ind.rsi.markOversold !== false ? ' checked' : '') +
      '> Метки RSI≤OS</label>'

    this._el.panel.hidden = false
    this._el.panel.innerHTML =
      '<div class="workb-panel-card workb-panel-wide">' +
      '<header><strong>Индикаторы</strong><button type="button" data-act="panel-close">×</button></header>' +
      '<div class="workb-panel-body workb-ind-grid">' +
      block('SMA', 'sma') +
      block('EMA', 'ema') +
      block('Bollinger', 'bb', bbExtra) +
      block('RSI', 'rsi', rsiExtra) +
      '</div>' +
      '<footer><button type="button" class="btn ghost" data-act="ind-reset">Сброс</button>' +
      '<button type="button" class="btn primary" data-act="ind-apply">Применить</button></footer>' +
      '</div>'

    this._el.panel.querySelector('[data-act="panel-close"]').onclick = function () {
      self._closePanel()
    }
    this._el.panel.querySelector('[data-act="ind-reset"]').onclick = function () {
      self.state.indicators = deepMerge(DEFAULT_STATE.indicators, {})
      self._save()
      self._openIndPanel()
      self._applySeries()
    }
    this._el.panel.querySelector('[data-act="ind-apply"]').onclick = function () {
      self._el.panel.querySelectorAll('[data-ind]').forEach(function (fs) {
        var key = fs.getAttribute('data-ind')
        var c = self.state.indicators[key]
        var on = fs.querySelector('[data-f="on"]')
        var period = fs.querySelector('[data-f="period"]')
        var color = fs.querySelector('[data-f="color"]')
        var width = fs.querySelector('[data-f="width"]')
        if (on) c.on = on.checked
        if (period) c.period = Number(period.value) || c.period
        if (width) c.width = Number(width.value) || c.width
        if (color) {
          if (key === 'bb') c.colorMid = c.colorUpper = c.colorLower = color.value
          else c.color = color.value
        }
        var mult = fs.querySelector('[data-f="mult"]')
        if (mult) c.mult = Number(mult.value) || 2
        var ob = fs.querySelector('[data-f="overbought"]')
        var os = fs.querySelector('[data-f="oversold"]')
        var sb = fs.querySelector('[data-f="signalBars"]')
        var mk = fs.querySelector('[data-f="markOversold"]')
        if (ob) c.overbought = Number(ob.value) || 82
        if (os) c.oversold = Number(os.value) || 27
        if (sb) c.signalBars = Math.max(1, Number(sb.value) || 5)
        if (mk) c.markOversold = mk.checked
      })
      self._save()
      self._closePanel()
      self._applySeries()
    }
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.LwcChartAgent = LwcChartAgent
})(typeof window !== 'undefined' ? window : globalThis)
