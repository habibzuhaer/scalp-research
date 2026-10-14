/* WorkbUiAgent — списки как TV + сетка 1…8 LWC-графиков */
(function (global) {
  'use strict'

  var FALLBACK = ['solusdt', 'bnbusdt', 'btcusdt', 'ethusdt', 'avaxusdt', 'nearusdt', 'linkusdt', 'dogeusdt']
  var LAYOUT_KEY = 'scalp-workb-layout-v1'
  var PAINT_KEY = 'scalp-workb-paint'
  var ALL_EXCHANGES = ['binance', 'binance-futures', 'bybit', 'bybit-futures']
  var ALL_SOFT_CAP = 400
  var DEFAULT_LAYOUT = {
    chartCount: 4,
    search: '',
    hideRail: false,
    hideHead: false,
    hideMarkers: false,
    open: { favs: true, all: true, bnb: false, sol: false, mm: false, known: false },
  }
  var KNOWN_MM = [
    { id: 'jump', name: 'Jump', color: '#22c55e' },
    { id: 'wintermute', name: 'Wintermute', color: '#38bdf8' },
  ]
  var PAINT_COLORS = [
    '#f0b90b',
    '#ef5350',
    '#26a69a',
    '#2962ff',
    '#c084fc',
    '#ff9800',
    '#00bcd4',
    '#e91e63',
    '#8bc34a',
    '#ffffff',
  ]

  function uniqueSymbols(screener, tickers) {
    var out = []
    var seen = Object.create(null)
    function add(s) {
      s = String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      if (!s || seen[s]) return
      seen[s] = 1
      out.push(s)
    }
    try {
      if (screener && screener.favs) {
        var pane = screener.state && screener.state.pane === 'futures' ? 'futures' : 'spot'
        Object.keys(screener.favs).forEach(function (k) {
          if (screener.favs[k] && k.indexOf(pane + ':') === 0) add(k.slice(pane.length + 1))
        })
        Object.keys(screener.favs).forEach(function (k) {
          if (screener.favs[k]) add(k.split(':').slice(1).join(':'))
        })
      }
    } catch (e) {}
    try {
      var t = tickers.get()
      if (t.spot) add(t.spot.symbol)
      if (t.futures) add(t.futures.symbol)
    } catch (e) {}
    FALLBACK.forEach(add)
    return out
  }

  function gridCols(n) {
    if (n <= 1) return 1
    if (n <= 2) return 2
    if (n <= 4) return 2
    if (n <= 6) return 3
    return 4
  }

  function fmtPrice(p) {
    p = Number(p)
    if (!isFinite(p) || p === 0) return '—'
    if (p >= 1000) return p.toFixed(2)
    if (p >= 1) return p.toFixed(4)
    if (p >= 0.01) return p.toFixed(5)
    return p.toPrecision(4)
  }

  function WorkbUiAgent(bus, tickers, screener, tags, markers, root, symbols) {
    this.bus = bus
    this.tickers = tickers
    this.screener = screener
    this.tags = tags
    this.markers = markers
    this.symbols = symbols || null
    this.root = root
    this.charts = []
    this.activeCell = 'workb-0'
    this._booted = false
    this._chainFilter = 'all'
    this.layout = global.Scalp.Config.load(LAYOUT_KEY, DEFAULT_LAYOUT)
    if (!this.layout.open) this.layout.open = Object.assign({}, DEFAULT_LAYOUT.open)
    if (this.layout.open.all == null) this.layout.open.all = true
    this.layout.chartCount = Math.max(1, Math.min(8, Number(this.layout.chartCount) || 4))
    if (this.layout.hideRail == null) this.layout.hideRail = false
    if (this.layout.hideHead == null) this.layout.hideHead = false
    if (this.layout.hideMarkers == null) this.layout.hideMarkers = false
    this._paint = { shape: 'star', color: '#f0b90b' }
    try {
      var rawPaint = localStorage.getItem(PAINT_KEY)
      if (rawPaint) this._paint = Object.assign(this._paint, JSON.parse(rawPaint))
    } catch (e) {}
    this._bind()
  }

  WorkbUiAgent.prototype._saveLayout = function () {
    global.Scalp.Config.save(LAYOUT_KEY, this.layout)
  }

  WorkbUiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('ui:set-page', function (page) {
      self._onPage(page)
    })
    this.bus.on('screener:changed', function () {
      if (self._booted && self.root && !self.root.hidden) self._renderLists()
    })
    this.bus.on('symbols:changed', function () {
      if (self._booted && self.root && !self.root.hidden) self._renderLists()
    })
    this.bus.on('tags:changed', function () {
      if (self._booted && self.root && !self.root.hidden) self._renderLists()
    })
    this.bus.on('workb:active-cell', function (cellId) {
      self.activeCell = cellId
      self.charts.forEach(function (ch) {
        ch.setActive(ch.id === cellId)
      })
      if (self._booted) self._renderMarkerForm()
    })
    this.bus.on('markers:changed', function () {
      if (self._booted && self.root && !self.root.hidden) self._renderMarkerForm()
    })
  }

  WorkbUiAgent.prototype._savePaint = function () {
    try {
      localStorage.setItem(PAINT_KEY, JSON.stringify(this._paint))
    } catch (e) {}
  }

  WorkbUiAgent.prototype._markIcon = function (shape) {
    if (shape === 'flag') return '⚑'
    if (shape === 'sq') return '■'
    return '★'
  }

  WorkbUiAgent.prototype._markPane = function () {
    try {
      var pane = this.screener && this.screener.state && this.screener.state.pane
      return pane === 'futures' ? 'futures' : 'spot'
    } catch (e) {
      return 'spot'
    }
  }

  WorkbUiAgent.prototype._onPage = function (page) {
    if (!this.root) return
    var on = page === 'workb'
    this.root.hidden = !on
    if (on) {
      this._boot()
      try {
        if (this.screener && this.screener.load) this.screener.load(true)
      } catch (e) {}
      this.charts.forEach(function (ch) {
        if (ch.resume) ch.resume()
      })
      var self = this
      requestAnimationFrame(function () {
        window.dispatchEvent(new Event('resize'))
        self.charts.forEach(function (ch) {
          if (ch._fit) ch._fit()
        })
        self._renderLists()
      })
    } else {
      this.charts.forEach(function (ch) {
        if (ch.pause) ch.pause()
      })
    }
  }

  WorkbUiAgent.prototype._boot = function () {
    if (this._booted || !this.root) return
    this._booted = true
    var self = this
    var n = this.layout.chartCount
    var cols = gridCols(n)

    this.root.innerHTML =
      '<div class="workb-layout' +
      (this.layout.hideRail ? ' hide-rail' : '') +
      (this.layout.hideHead ? ' hide-head' : '') +
      (this.layout.hideMarkers ? ' hide-markers' : '') +
      '">' +
      '  <aside class="workb-rail workb-rail-tv" data-el="rail">' +
      '    <header class="workb-rail-head">' +
      '      <h2>Watchlist</h2>' +
      '      <div class="workb-legend">' +
      '        <button type="button" class="workb-pill active" data-chain-filter="all">Все</button>' +
      '        <button type="button" class="workb-pill workb-pill-bnb" data-chain-filter="bnb">BNB</button>' +
      '        <button type="button" class="workb-pill workb-pill-sol" data-chain-filter="sol">SOL</button>' +
      '      </div>' +
      '      <div class="tv-paint workb-tv-paint" data-el="paint">' +
      '        <button type="button" class="tv-paint-shape' +
      (this._paint.shape === 'star' ? ' active' : '') +
      '" data-paint-shape="star" title="star">★</button>' +
      '        <button type="button" class="tv-paint-shape' +
      (this._paint.shape === 'flag' ? ' active' : '') +
      '" data-paint-shape="flag" title="flag">⚑</button>' +
      '        <button type="button" class="tv-paint-shape' +
      (this._paint.shape === 'sq' ? ' active' : '') +
      '" data-paint-shape="sq" title="sq">■</button>' +
      '        <span class="tv-paint-sep"></span>' +
      PAINT_COLORS.map(function (c) {
        return (
          '<button type="button" class="tv-paint-color' +
          (self._paint.color === c ? ' active' : '') +
          '" data-paint-color="' +
          c +
          '" style="--c:' +
          c +
          '" title="' +
          c +
          '"></button>'
        )
      }).join('') +
      '      </div>' +
      '      <input class="workb-tv-search" data-el="search" type="search" placeholder="Поиск…" value="' +
      String(this.layout.search || '').replace(/"/g, '&quot;') +
      '" />' +
      '    </header>' +
      '    <div class="workb-tv-cols"><span></span><span>Тикер</span><span>Цена</span><span>Δ%</span></div>' +
      '    <div class="workb-list workb-tv-list" data-el="list"></div>' +
      '    <div class="workb-marker-box" data-el="marker-box"></div>' +
      '    <div class="workb-tags-box">' +
      '      <div class="workb-tags-title">Свой словарь сетей</div>' +
      '      <div class="workb-tags-row">' +
      '        <input data-tag="sym" placeholder="SYMBOL" class="chart-sym-input" />' +
      '        <select data-tag="chain"><option value="bnb">BNB</option><option value="sol">SOL</option><option value="other">other</option></select>' +
      '        <button type="button" class="btn primary" data-act="tag-save">OK</button>' +
      '      </div>' +
      '    </div>' +
      '  </aside>' +
      '  <section class="workb-main">' +
      '    <header class="workb-main-head" data-el="head">' +
      '      <h2>Workb</h2>' +
      '      <label class="workb-count-label">Графиков ' +
      '        <select data-el="chart-count">' +
      [1, 2, 3, 4, 5, 6, 7, 8]
        .map(function (c) {
          return (
            '<option value="' +
            c +
            '"' +
            (c === n ? ' selected' : '') +
            '>' +
            c +
            '</option>'
          )
        })
        .join('') +
      '        </select>' +
      '      </label>' +
      '      <div class="ui-vis-bar">' +
      '        <button type="button" class="ui-vis-btn' +
      (this.layout.hideRail ? ' is-off' : '') +
      '" data-workb-ui="rail" title="Список">Список</button>' +
      '        <button type="button" class="ui-vis-btn' +
      (this.layout.hideHead ? ' is-off' : '') +
      '" data-workb-ui="head" title="Шапка">Шапка</button>' +
      '        <button type="button" class="ui-vis-btn' +
      (this.layout.hideMarkers ? ' is-off' : '') +
      '" data-workb-ui="markers" title="Маркеры">Маркеры</button>' +
      '      </div>' +
      '      <span class="viz-hint">TV · список/шапку можно скрыть</span>' +
      '    </header>' +
      '    <div class="workb-grid" data-el="grid" style="grid-template-columns:repeat(' +
      cols +
      ',1fr)"></div>' +
      '  </section>' +
      '  <button type="button" class="ui-vis-fab" data-act="workb-show-all" title="Показать панели">☰</button>' +
      '</div>'

    this._mountCharts(n)

    this.root.querySelectorAll('[data-workb-ui]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-workb-ui')
        if (key === 'rail') self.layout.hideRail = !self.layout.hideRail
        if (key === 'head') self.layout.hideHead = !self.layout.hideHead
        if (key === 'markers') self.layout.hideMarkers = !self.layout.hideMarkers
        self._saveLayout()
        var lay = self.root.querySelector('.workb-layout')
        if (lay) {
          lay.classList.toggle('hide-rail', !!self.layout.hideRail)
          lay.classList.toggle('hide-head', !!self.layout.hideHead)
          lay.classList.toggle('hide-markers', !!self.layout.hideMarkers)
        }
        btn.classList.toggle('is-off')
        requestAnimationFrame(function () {
          window.dispatchEvent(new Event('resize'))
          self.charts.forEach(function (ch) {
            if (ch._fit) ch._fit()
          })
        })
      })
    })
    var showAll = this.root.querySelector('[data-act="workb-show-all"]')
    if (showAll) {
      showAll.addEventListener('click', function () {
        self.layout.hideRail = false
        self.layout.hideHead = false
        self.layout.hideMarkers = false
        self._saveLayout()
        self._booted = false
        self.root.innerHTML = ''
        self._boot()
      })
    }
    this.root.querySelectorAll('[data-chain-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        self._chainFilter = btn.getAttribute('data-chain-filter')
        self.root.querySelectorAll('[data-chain-filter]').forEach(function (b) {
          b.classList.toggle('active', b === btn)
        })
        self._renderLists()
      })
    })
    var search = this.root.querySelector('[data-el="search"]')
    if (search) {
      search.addEventListener('input', function () {
        self.layout.search = search.value || ''
        self._saveLayout()
        self._renderLists()
      })
    }
    var paintBox = this.root.querySelector('[data-el="paint"]')
    if (paintBox) {
      paintBox.addEventListener('click', function (e) {
        var sh = e.target.closest('[data-paint-shape]')
        if (sh) {
          self._paint.shape = sh.getAttribute('data-paint-shape') || 'star'
          self._savePaint()
          paintBox.querySelectorAll('[data-paint-shape]').forEach(function (b) {
            b.classList.toggle('active', b === sh)
          })
          return
        }
        var col = e.target.closest('[data-paint-color]')
        if (col) {
          self._paint.color = col.getAttribute('data-paint-color') || '#f0b90b'
          self._savePaint()
          paintBox.querySelectorAll('[data-paint-color]').forEach(function (b) {
            b.classList.toggle('active', b === col)
          })
        }
      })
    }
    var countSel = this.root.querySelector('[data-el="chart-count"]')
    if (countSel) {
      countSel.addEventListener('change', function () {
        var next = Math.max(1, Math.min(8, Number(countSel.value) || 4))
        self._setChartCount(next)
      })
    }
    var tagSave = this.root.querySelector('[data-act="tag-save"]')
    if (tagSave) {
      tagSave.addEventListener('click', function () {
        var sym = self.root.querySelector('[data-tag="sym"]').value
        var chain = self.root.querySelector('[data-tag="chain"]').value
        self.bus.emit('tags:set-override', { symbol: sym, chain: chain })
        self.root.querySelector('[data-tag="sym"]').value = ''
      })
    }

    this._renderLists()
    this._renderMarkerForm()
  }

  WorkbUiAgent.prototype._setChartCount = function (n) {
    var kept = this.charts.map(function (ch) {
      return ch.state && ch.state.symbol
    })
    this.layout.chartCount = n
    this._saveLayout()
    this.charts.forEach(function (ch) {
      if (ch.destroy) ch.destroy()
    })
    this.charts = []
    this._mountCharts(n, kept)
    var self = this
    requestAnimationFrame(function () {
      window.dispatchEvent(new Event('resize'))
      self.charts.forEach(function (ch) {
        if (ch._fit) ch._fit()
      })
    })
  }

  WorkbUiAgent.prototype._mountCharts = function (n, preferSyms) {
    var grid = this.root.querySelector('[data-el="grid"]')
    if (!grid) return
    var symbols = uniqueSymbols(this.screener, this.tickers)
    preferSyms = preferSyms || []
    var Lwc = global.Scalp.LwcChartAgent

    var html = ''
    for (var c = 0; c < n; c++) {
      html += '<div class="workb-cell" id="workb-cell-' + c + '" data-cell="workb-' + c + '"></div>'
    }
    grid.innerHTML = html
    grid.style.gridTemplateColumns = 'repeat(' + gridCols(n) + ', 1fr)'

    this.charts = []
    for (var k = 0; k < n; k++) {
      var el = document.getElementById('workb-cell-' + k)
      var ch = new Lwc(this.bus, this.tickers, this.tags, this.markers, el, {
        id: 'workb-' + k,
        storageKey: 'scalp-workb-chart-' + k,
        symbol: preferSyms[k] || symbols[k] || FALLBACK[k] || 'solusdt',
      })
      ch.start()
      this.charts.push(ch)
    }
    var activeOk = this.charts.some(function (ch) {
      return ch.id === this.activeCell
    }, this)
    if (!activeOk) this.activeCell = 'workb-0'
    this.bus.emit('workb:active-cell', this.activeCell)
  }

  WorkbUiAgent.prototype._allMapped = function () {
    var snap = this.screener && this.screener.snapshot ? this.screener.snapshot() : null
    var rows = (snap && snap.rows) || []
    var pane = this._markPane()
    var self = this
    var exchange = ''
    try {
      exchange = this.tickers.get()[pane === 'futures' ? 'futures' : 'spot'].exchange
    } catch (e) {}

    function tagOf(sym) {
      return self.tags ? self.tags.resolve(sym, exchange) : { chain: 'other', color: '#8b93a7' }
    }

    function markOf(sym) {
      if (!self.screener || !self.screener.getMark) return null
      return self.screener.getMark(sym, pane) || self.screener.getMark(sym)
    }

    var priceBySym = Object.create(null)
    rows.forEach(function (r) {
      if (!r || !r.symbol) return
      priceBySym[r.symbol] = r
    })

    var byId = Object.create(null)

    function upsert(sym, extra) {
      sym = String(sym || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      if (!sym) return
      var t = tagOf(sym)
      var live = priceBySym[sym]
      var mark = markOf(sym)
      var prev = byId[sym]
      var row = Object.assign(
        {
          symbol: sym,
          label: (live && live.label) || sym.toUpperCase(),
          price: live ? live.price : 0,
          change: live ? live.change : 0,
          mmScore: live ? live.mmScore || 0 : 0,
          chain: t.chain,
          chainColor: t.color,
          fav: !!(mark || (self.screener && self.screener.isFav && self.screener.isFav(sym))),
          mark: mark,
          exchanges: (prev && prev.exchanges) || [],
        },
        extra || {},
      )
      if (prev && prev.exchanges && extra && extra.exchanges) {
        extra.exchanges.forEach(function (ex) {
          if (row.exchanges.indexOf(ex) === -1) row.exchanges.push(ex)
        })
      } else if (extra && extra.exchanges) {
        row.exchanges = extra.exchanges.slice()
      }
      byId[sym] = row
    }

    // universe from SymbolsAgent (4 exchanges)
    var quote =
      (this.symbols && this.symbols.quoteFilter) ||
      (global.Scalp.Config && localStorage.getItem('scalp-quote-filter')) ||
      'USDT'
    quote = String(quote || 'USDT').toUpperCase()
    if (this.symbols) {
      ALL_EXCHANGES.forEach(function (ex) {
        var list = self.symbols.getList(ex, { quote: quote, search: '' }) || []
        list.forEach(function (s) {
          upsert(s.id || s.label, {
            label: s.label || String(s.id || '').toUpperCase(),
            exchanges: [ex],
          })
        })
      })
    }

    // overlay live screener rows
    rows.forEach(function (r) {
      upsert(r.symbol, {
        label: r.label,
        price: r.price,
        change: r.change,
        mmScore: r.mmScore,
      })
    })

    // ensure marks/favs present even if not in universe yet
    try {
      var favs = (this.screener && this.screener.favs) || {}
      Object.keys(favs).forEach(function (k) {
        if (!favs[k]) return
        var sym = k.split(':').slice(1).join(':')
        upsert(sym, {})
      })
      var marks = (this.screener && this.screener.marks) || {}
      Object.keys(marks).forEach(function (k) {
        if (!marks[k]) return
        var sym = k.split(':').slice(1).join(':')
        upsert(sym, {})
      })
    } catch (e) {}

    var mapped = Object.keys(byId).map(function (k) {
      return byId[k]
    })

    if (this._chainFilter === 'bnb' || this._chainFilter === 'sol') {
      mapped = mapped.filter(function (r) {
        return r.chain === self._chainFilter
      })
    }

    var q = String(this.layout.search || '')
      .toLowerCase()
      .trim()
    if (q) {
      mapped = mapped.filter(function (r) {
        return String(r.symbol || '').indexOf(q) >= 0 || String(r.label || '').toLowerCase().indexOf(q) >= 0
      })
    }

    mapped.sort(function (a, b) {
      var am = a.mark || a.fav ? 1 : 0
      var bm = b.mark || b.fav ? 1 : 0
      if (am !== bm) return bm - am
      return String(a.label || a.symbol).localeCompare(String(b.label || b.symbol))
    })

    return mapped
  }

  WorkbUiAgent.prototype._sectionRows = function (id, mapped) {
    if (id === 'favs') {
      return mapped.filter(function (r) {
        return r.fav || r.mark
      })
    }
    if (id === 'all') {
      var q = String(this.layout.search || '').trim()
      if (q) return mapped.slice(0, 800)
      return mapped.slice(0, ALL_SOFT_CAP)
    }
    if (id === 'bnb') {
      return mapped.filter(function (r) {
        return r.chain === 'bnb'
      })
    }
    if (id === 'sol') {
      return mapped.filter(function (r) {
        return r.chain === 'sol'
      })
    }
    if (id === 'mm') {
      return mapped
        .slice()
        .sort(function (a, b) {
          return (b.mmScore || 0) - (a.mmScore || 0)
        })
        .slice(0, 40)
    }
    if (id === 'known') {
      return KNOWN_MM.map(function (mm) {
        return {
          symbol: '',
          label: mm.name,
          isMmInfo: true,
          mmColor: mm.color,
          price: 0,
          change: 0,
        }
      })
    }
    return []
  }

  WorkbUiAgent.prototype._renderLists = function () {
    var box = this.root && this.root.querySelector('[data-el="list"]')
    if (!box) return
    var self = this
    var mapped = this._allMapped()
    var totalAll = mapped.length
    var sections = [
      { id: 'favs', title: '★ Избранное' },
      { id: 'all', title: 'Все тикеры' },
      { id: 'bnb', title: 'Сеть BNB' },
      { id: 'sol', title: 'Сеть SOL' },
      { id: 'mm', title: 'MM score' },
      { id: 'known', title: 'Known MM' },
    ]

    box.innerHTML = sections
      .map(function (sec) {
        var rows = self._sectionRows(sec.id, mapped)
        var open = self.layout.open[sec.id] !== false
        var countLabel = rows.length
        if (sec.id === 'all' && !String(self.layout.search || '').trim() && totalAll > ALL_SOFT_CAP) {
          countLabel = ALL_SOFT_CAP + '/' + totalAll
        }
        var body = ''
        if (!rows.length) {
          body =
            '<div class="workb-tv-empty">' +
            (sec.id === 'all' && (!self.symbols || !Object.keys(self.symbols.cache || {}).length)
              ? 'загрузка тикеров…'
              : 'пусто') +
            '</div>'
        } else {
          body = rows
            .map(function (r) {
              if (r.isMmInfo) {
                return (
                  '<div class="workb-tv-row workb-tv-row-mm"><span class="workb-mm-dot" style="background:' +
                  r.mmColor +
                  '"></span><span class="workb-tv-sym">' +
                  r.label +
                  '</span></div>'
                )
              }
              var chg = Number(r.change) || 0
              var ch = r.chain === 'bnb' || r.chain === 'sol' ? r.chain : ''
              var mark = r.mark
              var markHtml = mark
                ? '<span class="tv-wl-mark on" style="color:' +
                  mark.color +
                  '">' +
                  self._markIcon(mark.shape) +
                  '</span>'
                : '<span class="tv-wl-mark off">☆</span>'
              return (
                '<div class="workb-tv-row' +
                (mark ? ' marked' : '') +
                '" data-row-sym="' +
                r.symbol +
                '">' +
                '<button type="button" class="tv-wl-mark-btn" data-workb-mark="' +
                r.symbol +
                '" title="Избранное">' +
                markHtml +
                '</button>' +
                '<button type="button" class="workb-tv-sym-btn" data-sym="' +
                r.symbol +
                '">' +
                '<span class="workb-tv-sym">' +
                (r.label || String(r.symbol).toUpperCase()) +
                (ch
                  ? ' <i class="workb-chain-badge" data-chain="' +
                    ch +
                    '">' +
                    ch.toUpperCase() +
                    '</i>'
                  : '') +
                '</span>' +
                '<span class="workb-tv-px">' +
                fmtPrice(r.price) +
                '</span>' +
                '<span class="workb-tv-chg ' +
                (chg >= 0 ? 'up' : 'down') +
                '">' +
                (chg >= 0 ? '+' : '') +
                chg.toFixed(2) +
                '%</span>' +
                '</button></div>'
              )
            })
            .join('')
          if (sec.id === 'all' && !String(self.layout.search || '').trim() && totalAll > ALL_SOFT_CAP) {
            body +=
              '<div class="workb-tv-empty">показано ' +
              ALL_SOFT_CAP +
              ' из ' +
              totalAll +
              ' · введите поиск</div>'
          }
        }
        return (
          '<div class="workb-tv-sec" data-sec="' +
          sec.id +
          '">' +
          '<button type="button" class="workb-tv-sec-head" data-toggle="' +
          sec.id +
          '">' +
          '<span class="workb-tv-caret">' +
          (open ? '▾' : '▸') +
          '</span> ' +
          sec.title +
          ' <em>' +
          countLabel +
          '</em></button>' +
          '<div class="workb-tv-sec-body"' +
          (open ? '' : ' hidden') +
          '>' +
          body +
          '</div></div>'
        )
      })
      .join('')

    box.querySelectorAll('[data-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-toggle')
        self.layout.open[id] = !self.layout.open[id]
        self._saveLayout()
        self._renderLists()
      })
    })
    box.querySelectorAll('[data-sym]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sym = btn.getAttribute('data-sym')
        box.querySelectorAll('.workb-tv-row').forEach(function (r) {
          r.classList.toggle('active', r.getAttribute('data-row-sym') === sym)
        })
        self.bus.emit('workb:select-symbol', { symbol: sym, cell: self.activeCell })
        self._renderMarkerForm()
      })
    })
    box.querySelectorAll('[data-workb-mark]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()
        var sym = btn.getAttribute('data-workb-mark')
        if (!sym) return
        var pane = self._markPane()
        var cur = self.screener && self.screener.getMark ? self.screener.getMark(sym, pane) : null
        if (cur) {
          self.bus.emit('screener:mark-clear', { symbol: sym, pane: pane })
        } else {
          self.bus.emit('screener:mark', {
            symbol: sym,
            pane: pane,
            mark: { shape: self._paint.shape, color: self._paint.color },
          })
        }
      })
      btn.addEventListener('contextmenu', function (e) {
        e.preventDefault()
        e.stopPropagation()
        var sym = btn.getAttribute('data-workb-mark')
        if (!sym) return
        self.bus.emit('screener:mark-clear', { symbol: sym, pane: self._markPane() })
      })
    })
  }

  WorkbUiAgent.prototype._renderMarkerForm = function () {
    var box = this.root && this.root.querySelector('[data-el="marker-box"]')
    if (!box) return
    var self = this
    var active = this.charts.filter(function (c) {
      return c.id === self.activeCell
    })[0]
    var symbol = active ? active.state.symbol : ''
    var pane = active && active.state.source === 'futures' ? 'futures' : 'spot'
    var items = this.markers ? this.markers.list(pane, symbol) : []

    box.innerHTML =
      '<div class="workb-tags-title">Маркер · ' +
      String(symbol || '').toUpperCase() +
      '</div>' +
      '<div class="workb-tags-row">' +
      '<input data-mk="label" placeholder="Label" />' +
      '<input data-mk="price" placeholder="Price" type="number" step="any" />' +
      '<input data-mk="color" type="color" value="#f0b90b" />' +
      '</div>' +
      '<input data-mk="desc" placeholder="Описание" class="workb-desc" />' +
      '<button type="button" class="btn primary" data-act="mk-add">+ Маркер</button>' +
      '<div class="workb-mk-list">' +
      items
        .map(function (m) {
          return (
            '<div class="workb-mk-item"><span style="color:' +
            m.color +
            '">●</span> ' +
            m.label +
            (m.price != null ? ' @ ' + m.price : '') +
            ' <button type="button" data-mk-del="' +
            m.id +
            '">×</button></div>'
          )
        })
        .join('') +
      '</div>'

    var addBtn = box.querySelector('[data-act="mk-add"]')
    if (addBtn) {
      addBtn.onclick = function () {
        var label = box.querySelector('[data-mk="label"]').value
        var price = box.querySelector('[data-mk="price"]').value
        var color = box.querySelector('[data-mk="color"]').value
        var desc = box.querySelector('[data-mk="desc"]').value
        if (!symbol) return
        self.bus.emit('markers:add', {
          pane: pane,
          symbol: symbol,
          label: label,
          price: price === '' ? null : Number(price),
          color: color,
          description: desc,
          type: 'price',
        })
        self._renderMarkerForm()
        if (active && active._paintOverlay) active._paintOverlay()
        if (active && active._applySeries) active._applySeries()
      }
    }
    box.querySelectorAll('[data-mk-del]').forEach(function (btn) {
      btn.onclick = function () {
        self.bus.emit('markers:remove', { id: btn.getAttribute('data-mk-del') })
        self._renderMarkerForm()
        if (active && active._paintOverlay) active._paintOverlay()
        if (active && active._applySeries) active._applySeries()
      }
    })
  }

  WorkbUiAgent.prototype.start = function () {
    var page = 'trade'
    try {
      page = localStorage.getItem('scalp-page-view') || 'trade'
    } catch (e) {}
    if (page === 'workb') this._onPage('workb')
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.WorkbUiAgent = WorkbUiAgent
})(typeof window !== 'undefined' ? window : globalThis)
