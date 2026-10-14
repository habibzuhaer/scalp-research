/* DomAgent — настраиваемый стакан (биржа + тикер + сжатие) */
(function (global) {
  'use strict'

  /**
   * @param {object} paneBus
   * @param {object} globalBus
   * @param {HTMLElement} root
   * @param {object} apiFacade
   * @param {object} settingsFacade
   * @param {string} paneId
   * @param {object} [symbolsAgent]
   */
  function DomAgent(paneBus, globalBus, root, apiFacade, settingsFacade, paneId, symbolsAgent) {
    this.bus = paneBus
    this.global = globalBus
    this.root = root
    this.api = apiFacade
    this.settings = settingsFacade
    this.paneId = paneId
    this.symbols = symbolsAgent || null
    this.book = { bids: [], asks: [], lastUpdateId: 0 }
    this.status = 'idle'
    this.error = null
    this.hoverPrice = null
    this.flash = null
    this.centered = false
    this.symbolFilter = ''
    this._bind()
  }

  DomAgent.prototype._bind = function () {
    var self = this
    this.bus.on('market:book', function (book) {
      self.book = book
      self.renderBook()
    })
    this.bus.on('market:status', function (payload) {
      self.status = payload.status
      self.error = payload.error
      self.renderHeader()
    })
    this.bus.on('api:changed', function () {
      self.centered = false
      self.renderAll()
    })
    this.bus.on('settings:changed', function () {
      self.centered = false
      self.renderAll()
    })
    this.global.on('settings:changed', function () {
      self.centered = false
      self.renderAll()
    })
    this.global.on('tickers:changed', function () {
      self.centered = false
      self.renderAll()
    })
    this.global.on('symbols:changed', function () {
      self.renderHeader()
      self.renderBook()
    })
    this.global.on('symbols:loaded', function () {
      self.renderHeader()
      self.renderBook()
    })
  }

  DomAgent.prototype.mount = function () {
    this.root.innerHTML = this._shell()
    this._els()
    this._wireUi()
    this.renderAll()
  }

  DomAgent.prototype._shell = function () {
    var marketLabel = this.paneId === 'futures' ? 'FUTURES' : 'SPOT'
    var marketClass = this.paneId === 'futures' ? 'badge-fut' : 'badge-spot'
    return [
      '<div class="dom-pane-label" data-chrome="label">',
      '  <span class="market-badge ' + marketClass + '">' + marketLabel + '</span>',
      '  <select class="exchange-select" data-el="exSelect" title="Биржа"></select>',
      '  <span class="sym-count" data-el="symCount"></span>',
      '</div>',
      '<header class="dom-header">',
      '  <div class="dom-title dom-title-sym">',
      '    <input class="symbol-filter" data-el="symFilter" data-chrome="search" placeholder="поиск…" spellcheck="false" />',
      '    <select class="symbol-select" data-el="symbol" size="1"></select>',
      '    <span class="status-dot" data-el="dot"></span>',
      '    <span class="status-label" data-el="status" data-chrome="status">…</span>',
      '  </div>',
      '  <div class="dom-toolbar">',
      '    <button type="button" class="tool-btn" data-act="zoom-out" title="Разобрать">−</button>',
      '    <span class="step-label" data-el="step">—</span>',
      '    <button type="button" class="tool-btn" data-act="zoom-in" title="Сжать">+</button>',
      '    <button type="button" class="tool-btn" data-act="center" title="К спреду">⌖</button>',
      '    <button type="button" class="tool-btn" data-act="chrome" title="Свернуть UI стакана">▾</button>',
      '    <button type="button" class="tool-btn" data-act="quick" title="Быстрые настройки">☰</button>',
      '    <button type="button" class="tool-btn" data-act="settings" title="Все настройки">⚙</button>',
      '  </div>',
      '</header>',
      '<div class="dom-quick" data-el="quick" hidden></div>',
      '<div class="dom-meta" data-chrome="meta">',
      '  <span class="ask-tag" data-el="ask">ASK —</span>',
      '  <span class="spread-tag" data-el="spread">—</span>',
      '  <span class="bid-tag" data-el="bid">BID —</span>',
      '</div>',
      '<div class="dom-mid" data-el="midRow" data-chrome="mid"></div>',
      '<div class="dom-cols" data-chrome="cols"><span>Ask</span><span>Цена</span><span>Bid</span></div>',
      '<div class="dom-scroll" data-el="scroll"></div>',
      '<footer class="dom-footer" data-chrome="footer">',
      '  <div class="scalp-bar" data-el="scalp"></div>',
      '  <div class="volume-slots" data-el="volumes"></div>',
      '  <div class="dom-hint" data-chrome="hint">▾ UI · ☰ быстрые · ⚙ все</div>',
      '</footer>',
    ].join('\n')
  }

  DomAgent.prototype._els = function () {
    var self = this
    this.el = {}
    this.root.querySelectorAll('[data-el]').forEach(function (node) {
      self.el[node.getAttribute('data-el')] = node
    })
  }

  DomAgent.prototype._wireUi = function () {
    var self = this
    this.root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]')
      if (!btn) return
      var act = btn.getAttribute('data-act')
      if (act === 'zoom-in') self.global.emit('tickers:zoom-in', { pane: self.paneId })
      if (act === 'zoom-out') self.global.emit('tickers:zoom-out', { pane: self.paneId })
      if (act === 'center') {
        self.centered = false
        self._center()
      }
      if (act === 'settings') {
        self.global.emit('ui:open-settings', { tab: 'dom', pane: self.paneId })
      }
      if (act === 'chrome') {
        var modes = ['full', 'compact', 'minimal']
        var cur = self.settings.state.domChrome || 'full'
        var next = modes[(modes.indexOf(cur) + 1) % modes.length]
        self.global.emit('settings:patch', { domChrome: next })
      }
      if (act === 'quick') {
        self.global.emit('settings:patch', {
          showQuickPanel: !self.settings.state.showQuickPanel,
        })
      }
      if (act === 'qset') {
        var key = btn.getAttribute('data-k')
        var val = btn.getAttribute('data-v')
        var patch = {}
        if (val === 'toggle') patch[key] = !self.settings.state[key]
        else patch[key] = val
        self.global.emit('settings:patch', patch)
      }
      if (act === 'vol') {
        self.global.emit('settings:patch', {
          activeVolumeIndex: Number(btn.getAttribute('data-i')),
        })
      }
      if (act === 'unit') {
        var unit = self.settings.state.volumeUnit === 'lots' ? 'usd' : 'lots'
        self.global.emit('settings:patch', { volumeUnit: unit })
      }
      if (act === 'scalp') {
        self._scalpPlace(btn.getAttribute('data-side'), btn.getAttribute('data-type'))
      }
    })

    this.root.addEventListener('input', function (e) {
      var range = e.target.closest('[data-scalp-range]')
      if (range && self.root.contains(range)) {
        self._scalpSyncControl(range.getAttribute('data-scalp-range'), range.value, 'range', true)
        return
      }
      var num = e.target.closest('input[type="number"][data-scalp-set]')
      if (num && self.root.contains(num)) {
        // только синхрон ползунка; сохранение — на change/blur
        self._scalpSyncControl(num.getAttribute('data-scalp-set'), num.value, 'number', false)
      }
    })
    this.root.addEventListener('change', function (e) {
      var inp = e.target.closest('[data-scalp-set]')
      if (!inp || !self.root.contains(inp)) return
      if (inp.type === 'checkbox') {
        self.global.emit('settings:patch', { attachSlTp: !!inp.checked })
        return
      }
      self._scalpSyncControl(inp.getAttribute('data-scalp-set'), inp.value, 'number', true)
    })

    this.el.symbol.addEventListener('change', function () {
      self.global.emit('tickers:set-symbol', {
        pane: self.paneId,
        symbol: self.el.symbol.value,
      })
    })

    if (this.el.symFilter) {
      this.el.symFilter.addEventListener('input', function () {
        self.symbolFilter = self.el.symFilter.value
        self.renderHeader()
      })
      this.el.symFilter.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && self.el.symbol.options.length) {
          self.el.symbol.selectedIndex = 0
          self.global.emit('tickers:set-symbol', {
            pane: self.paneId,
            symbol: self.el.symbol.value,
          })
        }
      })
    }

    this.el.exSelect.addEventListener('change', function () {
      self.global.emit('tickers:set-exchange', {
        pane: self.paneId,
        exchange: self.el.exSelect.value,
      })
    })

    this.el.scroll.addEventListener(
      'wheel',
      function (e) {
        if (!e.shiftKey) return
        e.preventDefault()
        if (e.deltaY > 0) self.global.emit('tickers:zoom-in', { pane: self.paneId })
        else self.global.emit('tickers:zoom-out', { pane: self.paneId })
      },
      { passive: false },
    )
  }

  DomAgent.prototype.renderAll = function () {
    var dom = this.settings.state
    var paneCfg = this.api.get()
    var live = paneCfg.viewOnly === false
    this.root.className =
      'dom theme-' +
      dom.theme +
      (this.paneId === 'futures' ? ' dom-futures' : ' dom-spot') +
      ' chrome-' +
      (dom.domChrome || 'full') +
      (dom.showQuickPanel ? ' quick-open' : '') +
      (live ? ' live-trade' : '')
    this.root.style.setProperty('--row-h', dom.rowHeight + 'px')
    this.root.style.setProperty('--font-size', dom.fontSize + 'px')
    this.root.style.setProperty('--bar-opacity', String(dom.barOpacity != null ? dom.barOpacity : 0.28))
    this.root.style.setProperty('--ask-hue', String(dom.askBarHue != null ? dom.askBarHue : 350))
    this.root.style.setProperty('--bid-hue', String(dom.bidBarHue != null ? dom.bidBarHue : 150))
    this.root.style.setProperty('--heat-boost', String(dom.heatBoost != null ? dom.heatBoost : 1.15))
    this.renderHeader()
    this.renderQuick()
    var scalpFocus = this.el.scalp && this.el.scalp.contains(document.activeElement)
    if (!scalpFocus) this.renderScalp()
    this.renderVolumes()
    this.renderBook()
    this.renderTradeHint(live, paneCfg)
  }

  DomAgent.prototype.renderTradeHint = function (live, paneCfg) {
    var hint = this.root.querySelector('[data-chrome="hint"]')
    if (!hint) return
    if (!live) {
      hint.textContent = '▾ UI · ☰ быстрые · ⚙ все · просмотр'
      return
    }
    var dom = this.settings.state
    var vols = dom.workVolumes || []
    var idx = Math.min(Math.max(0, dom.activeVolumeIndex || 0), Math.max(0, vols.length - 1))
    var vol = vols[idx] != null ? vols[idx] : '—'
    var unit = dom.volumeUnit === 'usd' ? '$' : ''
    var sl = Number(dom.stopLoss) || 0
    var tp = Number(dom.takeProfit) || 0
    var mode = dom.pnlMode === 'usdt' ? '$' : '%'
    hint.textContent =
      'LIVE · ' +
      unit +
      vol +
      ' · MKT/LMT кнопки · ЛКМ LIMIT · Shift MARKET' +
      (sl || tp ? ' · SL ' + sl + mode + ' / TP ' + tp + mode : '') +
      (paneCfg && paneCfg.apiKey ? '' : ' · нет ключа')
  }

  DomAgent.prototype._bookBest = function () {
    var bids = (this.book && this.book.bids) || []
    var asks = (this.book && this.book.asks) || []
    return {
      bid: bids[0] && bids[0].price > 0 ? Number(bids[0].price) : 0,
      ask: asks[0] && asks[0].price > 0 ? Number(asks[0].price) : 0,
    }
  }

  DomAgent.prototype._scalpSliderMax = function () {
    return this.settings.state.pnlMode === 'usdt' ? 500 : 20
  }

  DomAgent.prototype._scalpSliderStep = function () {
    return this.settings.state.pnlMode === 'usdt' ? 1 : 0.1
  }

  DomAgent.prototype._scalpRowHtml = function (key, label, value, mode) {
    var max = this._scalpSliderMax()
    var step = this._scalpSliderStep()
    var v = Number(value)
    if (!(v >= 0)) v = 0
    var rangeVal = Math.min(max, v)
    return (
      '<div class="scalp-slider-row" title="' +
      label +
      ' (' +
      mode +
      ')">' +
      '<span class="scalp-slider-lab">' +
      label +
      '</span>' +
      '<input type="range" data-scalp-range="' +
      key +
      '" min="0" max="' +
      max +
      '" step="' +
      step +
      '" value="' +
      rangeVal +
      '">' +
      '<input type="number" data-scalp-set="' +
      key +
      '" min="0" step="' +
      step +
      '" value="' +
      v +
      '">' +
      '<em class="scalp-slider-unit">' +
      mode +
      '</em>' +
      '</div>'
    )
  }

  DomAgent.prototype._scalpSyncControl = function (key, raw, from, commit) {
    if (!key) return
    var v = Number(raw)
    if (!(v >= 0) || !isFinite(v)) v = 0
    var max = this._scalpSliderMax()
    if (!this.el.scalp) return
    var range = this.el.scalp.querySelector('[data-scalp-range="' + key + '"]')
    var num = this.el.scalp.querySelector('input[type="number"][data-scalp-set="' + key + '"]')
    if (from === 'range') {
      if (num) num.value = String(v)
      if (range) range.value = String(Math.min(max, v))
    } else if (range) {
      var rangeMax = Math.max(max, v)
      range.max = String(rangeMax)
      range.value = String(Math.min(rangeMax, v))
    }
    if (!commit) return
    var cur = Number(this.settings.state[key])
    if (!isFinite(cur)) cur = 0
    if (Math.abs(cur - v) < 1e-9) return
    var patch = {}
    patch[key] = v
    this.global.emit('settings:patch', patch)
  }

  DomAgent.prototype.renderScalp = function () {
    if (!this.el.scalp) return
    var dom = this.settings.state
    var mode = dom.pnlMode === 'usdt' ? '$' : '%'
    var sl = Number(dom.stopLoss) || 0
    var tp = Number(dom.takeProfit) || 0
    var tp2 = Number(dom.takeProfit2) || 0
    var attach = dom.attachSlTp !== false
    this.el.scalp.innerHTML = [
      '<div class="scalp-btns">',
      '  <button type="button" class="scalp-btn buy" data-act="scalp" data-side="buy" data-type="MARKET" title="Рыночная покупка">BUY MKT</button>',
      '  <button type="button" class="scalp-btn sell" data-act="scalp" data-side="sell" data-type="MARKET" title="Рыночная продажа">SELL MKT</button>',
      '  <button type="button" class="scalp-btn buy ghost" data-act="scalp" data-side="buy" data-type="LIMIT" title="Лимит на бид (− заброс)">BUY LMT</button>',
      '  <button type="button" class="scalp-btn sell ghost" data-act="scalp" data-side="sell" data-type="LIMIT" title="Лимит на аск (+ заброс)">SELL LMT</button>',
      '</div>',
      '<div class="scalp-sets">',
      this._scalpRowHtml('stopLoss', 'SL', sl, mode),
      this._scalpRowHtml('takeProfit', 'TP', tp, mode),
      this._scalpRowHtml('takeProfit2', 'TP2', tp2, mode),
      '  <label class="scalp-attach" title="Ставить SL/TP после входа"><input type="checkbox" data-scalp-set="attachSlTp"' +
        (attach ? ' checked' : '') +
        '> SL/TP</label>',
      '</div>',
    ].join('')
  }

  DomAgent.prototype._scalpPlace = function (side, type) {
    side = side === 'sell' ? 'sell' : 'buy'
    type = type === 'MARKET' ? 'MARKET' : 'LIMIT'
    var best = this._bookBest()
    var bid = best.bid
    var ask = best.ask
    var mid = bid && ask ? (bid + ask) / 2 : bid || ask
    if (!(mid > 0)) {
      this.global.emit('trade:toast', { ok: false, message: 'Нет цены в стакане' })
      return
    }
    var dom = this.settings.state
    var meta = this.settings.meta ? this.settings.meta() : {}
    var tick = (meta && meta.tickSize > 0 ? meta.tickSize : 0) || this.settings.step(mid) || 0.01
    var throwN = Math.max(0, Number(dom.throwDistance) || 0)
    var price = 0
    var refPrice = mid
    if (type === 'MARKET') {
      refPrice = side === 'buy' ? ask || mid : bid || mid
    } else {
      if (side === 'buy') {
        price = bid || mid
        if (throwN > 0) price = price - throwN * tick
      } else {
        price = ask || mid
        if (throwN > 0) price = price + throwN * tick
      }
      if (!(price > 0)) {
        this.global.emit('trade:toast', { ok: false, message: 'Нет цены для лимита' })
        return
      }
      refPrice = price
    }
    this.flash = { price: price || refPrice, side: side }
    this.global.emit('trade:flash', {
      pane: this.paneId,
      price: price || refPrice,
      side: side,
    })
    this.global.emit('trade:place', {
      pane: this.paneId,
      side: side,
      type: type,
      price: type === 'LIMIT' ? price : undefined,
      refPrice: refPrice,
      attachStops: true,
    })
    var self = this
    this.renderBook()
    setTimeout(function () {
      self.flash = null
      self.renderBook()
    }, 400)
  }

  DomAgent.prototype.renderQuick = function () {
    if (!this.el.quick) return
    var dom = this.settings.state
    if (!dom.showQuickPanel) {
      this.el.quick.hidden = true
      this.el.quick.innerHTML = ''
      return
    }
    this.el.quick.hidden = false
    var mode = dom.volumeColorMode || 'heat'
    var chrome = dom.domChrome || 'full'
    function chip(label, act, k, v, on) {
      return (
        '<button type="button" class="q-chip' +
        (on ? ' on' : '') +
        '" data-act="' +
        act +
        '" data-k="' +
        k +
        '" data-v="' +
        v +
        '">' +
        label +
        '</button>'
      )
    }
    this.el.quick.innerHTML = [
      '<div class="q-row q-themes">',
      Object.keys(global.Scalp.Config.DOM_THEMES || {})
        .map(function (id) {
          var t = global.Scalp.Config.DOM_THEMES[id]
          return (
            '<button type="button" class="q-chip theme-dot theme-swatch-' +
            id +
            (dom.theme === id ? ' on' : '') +
            '" data-act="qset" data-k="theme" data-v="' +
            id +
            '" title="' +
            t.label +
            '">' +
            t.label.slice(0, 4) +
            '</button>'
          )
        })
        .join(''),
      '</div>',
      '<div class="q-row">',
      chip('Heat', 'qset', 'volumeColorMode', 'heat', mode === 'heat'),
      chip('Solid', 'qset', 'volumeColorMode', 'solid', mode === 'solid'),
      chip('Row', 'qset', 'volumeColorMode', 'heat-row', mode === 'heat-row'),
      chip('Бары', 'qset', 'showVolumeBars', 'toggle', dom.showVolumeBars !== false),
      chip('Cum', 'qset', 'cumVolumeMode', 'toggle', !!dom.cumVolumeMode),
      chip('Л+$', 'qset', 'volumeShowBoth', 'toggle', dom.volumeShowBoth !== false),
      chip('Wall', 'qset', 'wallHighlight', 'toggle', dom.wallHighlight !== false),
      chip('Крупн.', 'qset', 'highlightLarge', 'toggle', !!dom.highlightLarge),
      '</div>',
      '<div class="q-row">',
      chip('UI полный', 'qset', 'domChrome', 'full', chrome === 'full'),
      chip('UI компакт', 'qset', 'domChrome', 'compact', chrome === 'compact'),
      chip('UI мин', 'qset', 'domChrome', 'minimal', chrome === 'minimal'),
      '<button type="button" class="q-chip accent" data-act="settings">Все настройки…</button>',
      '</div>',
    ].join('')
  }

  DomAgent.prototype._symbolOptions = function () {
    var cfg = this.api.get()
    var dom = this.settings.state
    var quote = dom.quoteFilter || 'USDT'
    var max = dom.maxSymbolOptions || 400
    var q = this.symbolFilter
    if (this.symbols) {
      var list = this.symbols.getList(cfg.exchange, { quote: quote, search: q })
      return list.slice(0, max)
    }
    return global.Scalp.Config.SYMBOLS.filter(function (s) {
      if (!q) return true
      return s.id.indexOf(q.toLowerCase()) !== -1
    })
  }

  DomAgent.prototype.renderHeader = function () {
    var C = global.Scalp.Config
    var self = this
    var cfg = this.api.get()
    var market = this.paneId === 'futures' ? 'futures' : 'spot'
    var exchanges = C.exchangesForMarket(market)

    this.el.exSelect.innerHTML = exchanges
      .map(function (id) {
        return (
          '<option value="' +
          id +
          '"' +
          (cfg.exchange === id ? ' selected' : '') +
          '>' +
          C.EXCHANGE_PRESETS[id].label +
          '</option>'
        )
      })
      .join('')

    var opts = this._symbolOptions()
    var cur = self.settings.symbol
    var hasCur = opts.some(function (s) {
      return s.id === cur
    })
    if (!hasCur && cur) {
      var meta = this.symbols ? this.symbols.find(cfg.exchange, cur) : { id: cur, label: cur.toUpperCase() }
      opts = [meta].concat(opts)
    }
    this.el.symbol.innerHTML = opts
      .map(function (s) {
        return (
          '<option value="' +
          s.id +
          '"' +
          (s.id === cur ? ' selected' : '') +
          '>' +
          s.label +
          '</option>'
        )
      })
      .join('')

    if (this.el.symCount) {
      var total = this.symbols && this.symbols.cache[cfg.exchange]
        ? this.symbols.cache[cfg.exchange].length
        : opts.length
      var st = this.symbols ? this.symbols.status[cfg.exchange] : ''
      this.el.symCount.textContent =
        (st === 'loading' ? '…' : opts.length + (total > opts.length ? '/' + total : '')) + ' тикеров'
    }

    this.el.dot.className = 'status-dot ' + this.status
    this.el.status.textContent =
      this.status === 'live' ? 'LIVE' : this.status === 'connecting' ? '…' : 'ERR'
    this.el.status.title = this.error || this.status

    var ref =
      (this.book.bids[0] && this.book.bids[0].price) ||
      (this.book.asks[0] && this.book.asks[0].price) ||
      0
    var step = this.settings.step()
    var meta = this.settings.meta()
    this.el.step.textContent = C.formatPrice(
      step,
      this.settings.formatTick ? this.settings.formatTick(ref) : Math.min(step, meta.tickSize || step),
    )

    var chromeBtn = this.root.querySelector('[data-act="chrome"]')
    if (chromeBtn) {
      var ch = this.settings.state.domChrome || 'full'
      chromeBtn.textContent = ch === 'minimal' ? '▴' : ch === 'compact' ? '▪' : '▾'
      chromeBtn.title =
        ch === 'minimal'
          ? 'UI: минимум (клик → полный)'
          : ch === 'compact'
            ? 'UI: компакт (клик → минимум)'
            : 'UI: полный (клик → компакт)'
    }
    var quickBtn = this.root.querySelector('[data-act="quick"]')
    if (quickBtn) quickBtn.classList.toggle('active', !!this.settings.state.showQuickPanel)
  }

  DomAgent.prototype.renderVolumes = function () {
    var dom = this.settings.state
    var html = dom.workVolumes
      .map(function (v, i) {
        return (
          '<button type="button" data-act="vol" data-i="' +
          i +
          '" class="' +
          (i === dom.activeVolumeIndex ? 'active' : '') +
          '">' +
          v +
          '</button>'
        )
      })
      .join('')
    html +=
      '<button type="button" class="unit-btn" data-act="unit">' +
      (dom.volumeUnit === 'lots' ? 'L' : '$') +
      '</button>'
    this.el.volumes.innerHTML = html
  }

  DomAgent.prototype.renderBook = function () {
    var C = global.Scalp.Config
    var dom = this.settings.state
    var ref =
      (this.book.bids[0] && this.book.bids[0].price) ||
      (this.book.asks[0] && this.book.asks[0].price) ||
      0
    var step = this.settings.step(ref)
    var meta = this.settings.meta()
    var fmtTick = this.settings.formatTick
      ? this.settings.formatTick(ref)
      : meta.tickSize > 0
        ? Math.min(step, meta.tickSize)
        : C.inferTickSize(ref)
    var minQty = Number(dom.filterMinQty) || 0
    var bids = C.aggregateLevels(this.book.bids, step, 'bid').filter(function (l) {
      return !minQty || l.qty >= minQty
    })
    var asks = C.aggregateLevels(this.book.asks, step, 'ask').filter(function (l) {
      return !minQty || l.qty >= minQty
    })
    var bestBid = bids[0] ? bids[0].price : 0
    var bestAsk = asks[0] ? asks[0].price : 0
    var mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk
    var n = Math.max(1, Math.min(120, Number(dom.levelsPerSide) || 24))
    var maxQty = 1
    var i
    for (i = 0; i < Math.min(n, bids.length); i++) maxQty = Math.max(maxQty, bids[i].qty)
    for (i = 0; i < Math.min(n, asks.length); i++) maxQty = Math.max(maxQty, asks[i].qty)

    var spread = bestAsk && bestBid ? bestAsk - bestBid : 0
    var spreadPct = mid ? (spread / mid) * 100 : 0
    var askTop = asks.slice(0, n).reduce(function (s, l) {
      return s + l.qty
    }, 0)
    var bidTop = bids.slice(0, n).reduce(function (s, l) {
      return s + l.qty
    }, 0)
    var imb = askTop + bidTop ? bidTop / (askTop + bidTop) : 0.5

    this.el.ask.textContent = 'ASK ' + (bestAsk ? C.formatPrice(bestAsk, fmtTick) : '—')
    this.el.bid.textContent = 'BID ' + (bestBid ? C.formatPrice(bestBid, fmtTick) : '—')
    this.el.spread.textContent = spread
      ? C.formatPrice(spread, fmtTick) + ' · ' + spreadPct.toFixed(3) + '%'
      : '—'

    if (this.el.midRow) {
      if (dom.showMidPrice && mid) {
        var imbTxt =
          dom.showImbalance
            ? ' · imb ' + (imb * 100).toFixed(0) + '% bid'
            : ''
        this.el.midRow.innerHTML =
          '<span>MID ' +
          C.formatPrice(mid, fmtTick) +
          imbTxt +
          '</span><span class="imb-bar"><i style="width:' +
          (imb * 100).toFixed(1) +
          '%"></i></span>'
        this.el.midRow.style.display = ''
      } else {
        this.el.midRow.style.display = 'none'
      }
    }

    var askRows = asks.slice(0, n).reverse()
    var bidRows = bids.slice(0, n)

    // cumulative from spread outward
    var askCum = {}
    var bidCum = {}
    if (dom.cumVolumeMode) {
      var run = 0
      for (i = 0; i < asks.slice(0, n).length; i++) {
        run += asks[i].qty
        askCum[asks[i].price] = run
      }
      run = 0
      for (i = 0; i < bidRows.length; i++) {
        run += bidRows[i].qty
        bidCum[bidRows[i].price] = run
      }
      maxQty = Math.max(maxQty, run)
      Object.keys(askCum).forEach(function (k) {
        maxQty = Math.max(maxQty, askCum[k])
      })
    }

    var html = ''
    var self = this
    var showBars = dom.showVolumeBars !== false

    if (!askRows.length && !bidRows.length) {
      var rawB = (this.book.bids && this.book.bids.length) || 0
      var rawA = (this.book.asks && this.book.asks.length) || 0
      var err = this.error || ''
      var hint
      if (this.status === 'error' || /418|429|rate limit|Пауза/i.test(err)) {
        hint = err || 'Нет данных'
      } else if (rawB || rawA) {
        hint = 'Отфильтровано (мин. объём / шаг) · raw ' + rawB + '/' + rawA
      } else if (this.status === 'live') {
        hint = 'Пустой стакан'
      } else {
        hint = err ? err : 'Загрузка стакана…'
      }
      this.el.scroll.innerHTML = '<div class="dom-empty">' + hint + '</div>'
      return
    }

    function heatFactor(qty) {
      var t = maxQty > 0 ? qty / maxQty : 0
      if ((dom.volumeHeatScale || 'sqrt') === 'sqrt') t = Math.sqrt(t)
      t = Math.max(0, Math.min(1, t * (dom.heatBoost != null ? dom.heatBoost : 1.15)))
      return t
    }

    function barStyle(side, qty) {
      if (!showBars) return 'width:0'
      var t = heatFactor(qty)
      var width = Math.min(100, ((dom.volumeHeatScale || 'sqrt') === 'sqrt' ? Math.sqrt(qty / maxQty) : qty / maxQty) * 100)
      var mode = dom.volumeColorMode || 'heat'
      var hue = side === 'ask' ? (dom.askBarHue != null ? dom.askBarHue : 350) : (dom.bidBarHue != null ? dom.bidBarHue : 150)
      var alpha = Math.max(0.08, (dom.barOpacity != null ? dom.barOpacity : 0.28) * (0.35 + t * 1.4))
      if (mode === 'solid') {
        return (
          'width:' +
          width +
          '%;background:hsla(' +
          hue +
          ',72%,' +
          (side === 'ask' ? '52%' : '42%') +
          ',' +
          alpha +
          ')'
        )
      }
      var light = 28 + t * 28
      var sat = 55 + t * 40
      return (
        'width:' +
        width +
        '%;background:linear-gradient(' +
        (side === 'ask' ? '270deg' : '90deg') +
        ', hsla(' +
        hue +
        ',' +
        sat +
        '%,' +
        light +
        '%,' +
        alpha +
        '), hsla(' +
        hue +
        ',' +
        (sat + 10) +
        '%,' +
        (light + 12) +
        '%,' +
        Math.min(0.95, alpha * 1.35) +
        '))'
      )
    }

    function rowHtml(side, price, qty) {
      var displayQty = dom.cumVolumeMode
        ? side === 'ask'
          ? askCum[price] || qty
          : bidCum[price] || qty
        : qty
      var t = heatFactor(displayQty)
      var notional = qty * price
      var largeByQty = dom.highlightLarge && qty >= (dom.largeVolumeThreshold || 5)
      var largeByUsd =
        dom.highlightLarge && notional >= (Number(dom.largeNotionalUsd) || 25000)
      var large = !!(largeByQty || largeByUsd)
      var wallByHeat =
        dom.wallHighlight !== false && t >= (dom.wallThreshold != null ? dom.wallThreshold : 0.65)
      var wallByUsd =
        dom.wallHighlight !== false && notional >= (Number(dom.wallNotionalUsd) || 100000)
      var wall = !!(wallByHeat || wallByUsd)
      var flashed = dom.flashUpdates !== false && self.flash && self.flash.price === price
      var rowH = Number(dom.rowHeight) || 24
      if (dom.volumeShowBoth !== false) rowH = Math.max(rowH, 28)
      if (wall) rowH = Math.max(rowH, 34)
      else if (large) rowH = Math.max(rowH, 30)
      var ruler = ''
      if (dom.showRuler && self.hoverPrice === price && bestBid && bestAsk) {
        var ref = price >= bestAsk ? bestAsk : bestBid
        if (dom.rulerMode === 'percent') {
          var pct = ((price - ref) / ref) * 100
          ruler =
            '<span class="ruler">' + (pct >= 0 ? '+' : '') + pct.toFixed(3) + '%</span>'
        } else {
          var pts = Math.round((price - ref) / (meta.tickSize || step))
          ruler = '<span class="ruler">' + (pts >= 0 ? '+' : '') + pts + '</span>'
        }
      }
      var imbClass = ''
      if (dom.showImbalance && large) {
        if (side === 'bid' && imb >= (dom.imbalanceThreshold || 0.65)) imbClass = ' imb-bid'
        if (side === 'ask' && imb <= 1 - (dom.imbalanceThreshold || 0.65)) imbClass = ' imb-ask'
      }
      var heatRow =
        (dom.volumeColorMode || 'heat') === 'heat-row'
          ? ' style="--row-heat:' +
            t.toFixed(3) +
            ';height:' +
            rowH +
            'px"'
          : ' style="height:' + rowH + 'px"'
      var askBar = side === 'ask' ? barStyle('ask', displayQty) : 'width:0'
      var bidBar = side === 'bid' ? barStyle('bid', displayQty) : 'width:0'
      var volHtml = ''
      if (displayQty > 0) {
        var formatted = C.formatDomVolume
          ? C.formatDomVolume(displayQty, price, dom)
          : { html: C.formatVolume(displayQty, dom) }
        volHtml = formatted.html
      }
      var badge = ''
      if (dom.showWallBadge !== false && (wall || large)) {
        var usdLabel = formatUsdShort(notional)
        badge =
          '<span class="wall-badge ' +
          (wall ? 'is-wall' : 'is-large') +
          '">' +
          (wall ? 'WALL' : 'BIG') +
          ' ' +
          usdLabel +
          '</span>'
      }
      return [
        '<div class="dom-row ' +
          side +
          (large ? ' large' : '') +
          (wall ? ' wall' : '') +
          imbClass +
          (flashed ? ' flash-' + self.flash.side : '') +
          (dom.volumeShowBoth !== false ? ' dual-vol' : '') +
          '"' +
          heatRow +
          ' data-price="' +
          price +
          '" data-notional="' +
          Math.round(notional) +
          '">',
        '  <button type="button" class="cell ask-cell" data-place="sell">',
        '    <span class="bar ask-bar" style="' + askBar + '"></span>',
        '    <span class="qty">' + (side === 'ask' ? volHtml : '') + '</span>',
        '  </button>',
        '  <button type="button" class="cell price-cell" data-place="' +
          (side === 'ask' ? 'sell' : 'buy') +
          '">' +
          badge +
          C.formatPrice(price, fmtTick) +
          ruler +
          '</button>',
        '  <button type="button" class="cell bid-cell" data-place="buy">',
        '    <span class="bar bid-bar" style="' + bidBar + '"></span>',
        '    <span class="qty">' + (side === 'bid' ? volHtml : '') + '</span>',
        '  </button>',
        '</div>',
      ].join('')
    }

    function formatUsdShort(n) {
      if (!(n > 0)) return ''
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M'
      if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K'
      return '$' + Math.round(n)
    }

    for (i = 0; i < askRows.length; i++) {
      html += rowHtml('ask', askRows[i].price, askRows[i].qty)
      if (dom.showSpreadRow !== false && askRows[i].price === bestAsk) {
        html +=
          '<div class="spread-row" data-spread><span>спред</span><span>' +
          C.formatPrice(spread, fmtTick) +
          ' (' +
          spreadPct.toFixed(3) +
          '%)</span></div>'
      }
    }
    for (i = 0; i < bidRows.length; i++) {
      html += rowHtml('bid', bidRows[i].price, bidRows[i].qty)
    }

    this.el.scroll.innerHTML = html

    this.el.scroll.querySelectorAll('.dom-row').forEach(function (row) {
      row.addEventListener('mouseenter', function () {
        self.hoverPrice = Number(row.getAttribute('data-price'))
        self.renderBook()
      })
      row.addEventListener('mouseleave', function () {
        self.hoverPrice = null
      })
      row.querySelectorAll('[data-place]').forEach(function (cell) {
        cell.addEventListener('click', function (e) {
          var price = Number(row.getAttribute('data-price'))
          var side = cell.getAttribute('data-place')
          var orderSide = side === 'buy' ? 'buy' : 'sell'
          self.flash = { price: price, side: orderSide }
          self.global.emit('trade:flash', {
            pane: self.paneId,
            price: price,
            side: orderSide,
          })
          self.global.emit('trade:place', {
            pane: self.paneId,
            price: price,
            side: orderSide,
            type: e.shiftKey ? 'MARKET' : 'LIMIT',
            refPrice: price,
          })
          self.renderBook()
          setTimeout(function () {
            self.flash = null
            self.renderBook()
          }, 400)
        })
      })
    })

    if (dom.autoScroll || dom.stickyCenter) this._center()
  }

  DomAgent.prototype._center = function () {
    if (this.centered && this.settings.state.autoScroll) return
    var midEl = this.el.scroll.querySelector('[data-spread]')
    if (!midEl) return
    this.el.scroll.scrollTop =
      midEl.offsetTop - this.el.scroll.clientHeight / 2 + midEl.clientHeight / 2
    this.centered = true
  }

  DomAgent.prototype.start = function () {
    this.mount()
  }

  global.Scalp.DomAgent = DomAgent
})(typeof window !== 'undefined' ? window : globalThis)
