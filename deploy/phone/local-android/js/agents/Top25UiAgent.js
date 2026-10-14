/* Top25UiAgent — Топ-25: список или TV-графики (по 4 в ряд) */
(function (global) {
  'use strict'

  var MODE_KEY = 'scalp-top25-view-mode'
  var UI_KEY = 'scalp-top25-ui-v1'
  var DEFAULT_UI = { head: true, tools: true, list: true, hint: true }

  function Top25UiAgent(bus, top25Agent, root, tickers, tags, markers, screener) {
    this.bus = bus
    this.top25 = top25Agent
    this.root = root
    this.tickers = tickers || null
    this.tags = tags || null
    this.markers = markers || null
    this.screener = screener || null
    this._searchTimer = 0
    this._mode = 'list'
    this._paint = { shape: 'star', color: '#f0b90b' }
    this._ui = Object.assign({}, DEFAULT_UI)
    try {
      var m = localStorage.getItem(MODE_KEY)
      if (m === 'charts' || m === 'list') this._mode = m
      var p = localStorage.getItem('scalp-top25-paint')
      if (p) this._paint = Object.assign(this._paint, JSON.parse(p))
      var u = localStorage.getItem(UI_KEY)
      if (u) this._ui = Object.assign({}, DEFAULT_UI, JSON.parse(u))
    } catch (e) {}
    this.charts = []
    this._chartSig = ''
    this._bind()
  }

  Top25UiAgent.prototype._saveUi = function () {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(this._ui))
    } catch (e) {}
  }

  Top25UiAgent.prototype._toggleUi = function (key) {
    if (!Object.prototype.hasOwnProperty.call(this._ui, key)) return
    this._ui[key] = !this._ui[key]
    this._saveUi()
    this._applyUiClasses()
    // list visibility in charts needs re-render for sidebar
    if (key === 'list' && this._mode === 'charts') this.render()
  }

  Top25UiAgent.prototype._applyUiClasses = function () {
    if (!this.root) return
    this.root.classList.toggle('ui-hide-head', this._ui.head === false)
    this.root.classList.toggle('ui-hide-tools', this._ui.tools === false)
    this.root.classList.toggle('ui-hide-list', this._ui.list === false)
    this.root.classList.toggle('ui-hide-hint', this._ui.hint === false)
    var shell = document.querySelector('.app-shell')
    if (shell) shell.classList.toggle('ui-hide-page-tabs', this._ui.head === false && this._ui.tools === false)
  }

  Top25UiAgent.prototype._uiToggleHtml = function () {
    var u = this._ui
    function btn(key, label, title) {
      return (
        '<button type="button" class="ui-vis-btn' +
        (u[key] === false ? ' is-off' : '') +
        '" data-ui-toggle="' +
        key +
        '" title="' +
        title +
        '">' +
        label +
        '</button>'
      )
    }
    return (
      '<div class="ui-vis-bar" title="Показать / скрыть">' +
      btn('head', 'Шапка', 'Шапка') +
      btn('tools', 'Фильтры', 'Фильтры и кисть') +
      btn('list', 'Список', 'Список / watchlist') +
      btn('hint', 'Подсказка', 'Текст-подсказка') +
      '</div>'
    )
  }

  Top25UiAgent.prototype._setMode = function (mode) {
    if (mode !== 'charts' && mode !== 'list') return
    this._mode = mode
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch (e) {}
    this.render()
  }

  Top25UiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('top25:changed', function () {
      if (!self.root || self.root.hidden) return
      if (self._mode === 'list') self.render()
      else self._syncCharts()
    })
    this.bus.on('screener:changed', function () {
      if (!self.root || self.root.hidden) return
      if (self._mode === 'list') self.render()
    })
    this.bus.on('top25:set-mode', function (mode) {
      self._setMode(mode === 'charts' ? 'charts' : 'list')
    })
    this.bus.on('ui:set-page', function (page) {
      var on = page === 'top25' || page === 'visualizer'
      if (self.root) self.root.hidden = !on
      if (on) {
        if (page === 'visualizer') self._mode = 'charts'
        try {
          localStorage.setItem(MODE_KEY, self._mode)
        } catch (e) {}
        if (self.top25) self.top25.load(false)
        self.render()
      } else {
        self._destroyCharts()
      }
    })
  }

  Top25UiAgent.prototype._destroyCharts = function () {
    ;(this.charts || []).forEach(function (ch) {
      if (ch.destroy) ch.destroy()
      else if (ch.pause) ch.pause()
    })
    this.charts = []
    this._chartSig = ''
  }

  Top25UiAgent.prototype._symbols = function () {
    var sc = this.top25.snapshot()
    return (sc.rows || []).map(function (r) {
      return String(r.symbol || '').toLowerCase()
    }).filter(Boolean)
  }

  Top25UiAgent.prototype._scrollByRows = function (dir) {
    var scroller = this.root && this.root.querySelector('[data-el="charts-scroll"]')
    if (!scroller) return
    var cell = scroller.querySelector('.t25-chart-cell')
    var h = cell ? cell.offsetHeight + 8 : 328
    scroller.scrollBy({ top: dir * h, behavior: 'smooth' })
  }

  Top25UiAgent.prototype._syncCharts = function () {
    if (this._mode !== 'charts' || !this.root) return
    var host = this.root.querySelector('[data-el="charts-grid"]')
    if (!host) {
      this.render()
      return
    }
    var syms = this._symbols()
    var sig = syms.join(',')
    if (sig === this._chartSig && this.charts.length === syms.length) {
      this.charts.forEach(function (ch) {
        if (ch._fit) ch._fit()
      })
      return
    }
    this._mountCharts(host, syms)
  }

  Top25UiAgent.prototype._mountCharts = function (host, syms) {
    var self = this
    this._destroyCharts()
    this._chartSig = syms.join(',')
    if (!syms.length) {
      host.innerHTML = '<div class="screener-empty">Нет тикеров для графиков — обновите Топ-25</div>'
      return
    }
    var Lwc = global.Scalp.LwcChartAgent
    if (!Lwc || !global.LightweightCharts) {
      host.innerHTML = '<div class="screener-empty">Lightweight Charts не загружен</div>'
      return
    }
    host.innerHTML = syms
      .map(function (s, i) {
        return '<div class="t25-chart-cell" id="t25-chart-' + i + '" data-sym="' + s + '"></div>'
      })
      .join('')

    this.charts = []
    for (var i = 0; i < syms.length; i++) {
      var el = document.getElementById('t25-chart-' + i)
      var ch = new Lwc(this.bus, this.tickers, this.tags, this.markers, el, {
        id: 't25-' + i,
        storageKey: 'scalp-t25-chart-' + i,
        symbol: syms[i],
      })
    // force symbol from current Top-25 row (storage may have another ticker)
      ch.state.symbol = syms[i]
      try {
        global.Scalp.Config.save(ch._storageKey, ch.state)
      } catch (e) {}
      ch.start()
      this.charts.push(ch)
    }
    requestAnimationFrame(function () {
      window.dispatchEvent(new Event('resize'))
      self.charts.forEach(function (ch) {
        if (ch._fit) ch._fit()
      })
    })
  }

  Top25UiAgent.prototype._modeToggleHtml = function () {
    return (
      '<div class="t25-mode-toggle" role="tablist">' +
      '<button type="button" class="t25-mode-btn' +
      (this._mode === 'list' ? ' active' : '') +
      '" data-mode="list">Список</button>' +
      '<button type="button" class="t25-mode-btn' +
      (this._mode === 'charts' ? ' active' : '') +
      '" data-mode="charts">Графики</button>' +
      '</div>'
    )
  }

  Top25UiAgent.prototype.render = function () {
    if (!this.root || !this.top25) return
    if (this._mode === 'charts') {
      this._renderChartsShell()
      return
    }
    this._destroyCharts()
    this._renderList()
  }

  Top25UiAgent.prototype._renderChartsShell = function () {
    var C = global.Scalp.Config
    var sc = this.top25.snapshot()
    var st = sc.state
    var self = this
    var ex = '—'
    try {
      var pane = this.top25._paneCfg()
      ex =
        C.EXCHANGE_PRESETS[pane.exchange] && C.EXCHANGE_PRESETS[pane.exchange].label
          ? C.EXCHANGE_PRESETS[pane.exchange].label
          : pane.exchange
    } catch (e) {}
    var status =
      sc.status === 'loading'
        ? 'загрузка…'
        : sc.status === 'error'
          ? sc.error || 'ошибка'
          : sc.fromScreener
            ? (sc.overrideLabel || 'скринер') + ' → ' + sc.rows.length + ' · графики'
            : 'топ ' + sc.rows.length + ' · графики TV по 4 в ряд'

    function sel(key, opts, cur) {
      return (
        '<select data-t25="' +
        key +
        '">' +
        opts
          .map(function (o) {
            var v = typeof o === 'string' ? o : o.v
            var l = typeof o === 'string' ? o : o.l
            return (
              '<option value="' +
              v +
              '"' +
              (String(cur) === String(v) ? ' selected' : '') +
              '>' +
              l +
              '</option>'
            )
          })
          .join('') +
        '</select>'
      )
    }

    this.root.classList.add('top25-fullscreen')
    var listSide =
      this._ui.list !== false
        ? '<aside class="t25-side-list" data-el="side-list"></aside>'
        : ''
    this.root.innerHTML = [
      '<header class="screener-page-head t25-charts-head" data-el="head">',
      '  <div class="screener-title" data-el="title-row"><h2>' +
        (sc.fromScreener ? 'Скринер → графики' : 'Топ-25') +
        '</h2><span class="screener-ex">' +
        ex +
        '</span><span class="screener-status">' +
        status +
        '</span>' +
        this._modeToggleHtml() +
        this._uiToggleHtml() +
        '</div>',
      '  <div class="screener-filters" data-el="tools">',
      sel(
        'pane',
        [
          { v: 'spot', l: 'Рынок: Spot' },
          { v: 'futures', l: 'Рынок: Futures' },
        ],
        st.pane,
      ),
      sel(
        'quote',
        ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'FDUSD', 'EUR', 'TRY', 'ALL'].map(function (q) {
          return { v: q, l: q === 'ALL' ? 'Котировка: все' : 'Котировка: ' + q }
        }),
        st.quote,
      ),
      '<button type="button" class="btn ghost" data-act="reload">Обновить</button>',
      sc.fromScreener
        ? '<button type="button" class="btn ghost" data-act="clear-override" title="Вернуть обычный Топ-25">Обычный Топ-25</button>'
        : '',
      '<button type="button" class="btn ghost" data-act="charts-up" title="Прокрутка вверх на 4 графика">▲ −4</button>',
      '<button type="button" class="btn ghost" data-act="charts-down" title="Прокрутка вниз на 4 графика">▼ +4</button>',
      '  </div>',
      '  <p class="screener-hint" data-el="hint">' +
        (sc.fromScreener
          ? 'Список из скринера («' +
            (sc.overrideLabel || 'фильтр') +
            '»), до 55 графиков · ▲▼ по 4 ряда'
          : 'TV-графики · ±4 · прячьте шапку/список кнопками справа сверху') +
        '</p>',
      '</header>',
      '<div class="t25-charts-wrap' +
        (this._ui.list === false ? ' no-list' : '') +
        '">' +
        listSide +
        '<div class="t25-charts-scroll" data-el="charts-scroll"><div class="t25-charts-grid" data-el="charts-grid"></div></div>' +
        '</div>',
      '<button type="button" class="ui-vis-fab" data-act="ui-show-all" title="Показать панели">☰</button>',
    ].join('')

    this._applyUiClasses()
    this._bindFilters()
    this.root.onclick = function (e) {
      var uiBtn = e.target.closest('[data-ui-toggle]')
      if (uiBtn) {
        self._toggleUi(uiBtn.getAttribute('data-ui-toggle'))
        return
      }
      var modeBtn = e.target.closest('[data-mode]')
      if (modeBtn) {
        self._setMode(modeBtn.getAttribute('data-mode'))
        return
      }
      var act = e.target.closest('[data-act]')
      if (!act) return
      var a = act.getAttribute('data-act')
      if (a === 'reload') self.bus.emit('top25:reload')
      if (a === 'clear-override') self.bus.emit('top25:clear-override')
      if (a === 'charts-up') self._scrollByRows(-1)
      if (a === 'charts-down') self._scrollByRows(1)
      if (a === 'ui-show-all') {
        self._ui = Object.assign({}, DEFAULT_UI)
        self._saveUi()
        self.render()
      }
    }

    if (this._ui.list !== false) this._fillSideList()
    var host = this.root.querySelector('[data-el="charts-grid"]')
    this._mountCharts(host, this._symbols())
  }

  Top25UiAgent.prototype._fillSideList = function () {
    var box = this.root.querySelector('[data-el="side-list"]')
    if (!box || !this.top25) return
    var self = this
    var rows = this.top25.snapshot().rows || []
    box.innerHTML =
      '<div class="t25-side-title">Список</div>' +
      rows
        .map(function (r, i) {
          var ch = Number(r.change) || 0
          return (
            '<button type="button" class="t25-side-row" data-side-sym="' +
            r.symbol +
            '"><span>' +
            (i + 1) +
            '</span><b>' +
            (r.label || r.symbol.toUpperCase()) +
            '</b><em class="' +
            (ch >= 0 ? 'up' : 'down') +
            '">' +
            (ch >= 0 ? '+' : '') +
            ch.toFixed(2) +
            '%</em></button>'
          )
        })
        .join('')
    box.onclick = function (e) {
      var row = e.target.closest('[data-side-sym]')
      if (!row) return
      // put symbol into first visible chart / active
      var sym = row.getAttribute('data-side-sym')
      if (self.charts[0] && self.charts[0].setSymbol) self.charts[0].setSymbol(sym)
    }
  }

  Top25UiAgent.prototype._bindFilters = function () {
    var self = this
    this.root.querySelectorAll('[data-t25]').forEach(function (node) {
      var key = node.getAttribute('data-t25')
      if (key === 'search') {
        node.oninput = function () {
          if (self._searchTimer) clearTimeout(self._searchTimer)
          self._searchTimer = setTimeout(function () {
            self.bus.emit('top25:patch', { search: node.value })
          }, 160)
        }
        return
      }
      node.onchange = function () {
        var val = node.value
        if (key === 'minVolume' || key === 'minMm' || key === 'maxSpread') {
          val = val === '' ? '' : Number(val)
        }
        var patch = {}
        patch[key] = val
        self.bus.emit('top25:patch', patch)
      }
    })
  }

  Top25UiAgent.prototype._savePaint = function () {
    try {
      localStorage.setItem('scalp-top25-paint', JSON.stringify(this._paint))
    } catch (e) {}
  }

  Top25UiAgent.prototype._markIcon = function (shape) {
    if (shape === 'flag') return '⚑'
    if (shape === 'sq') return '■'
    return '★'
  }

  Top25UiAgent.prototype._renderList = function () {
    var C = global.Scalp.Config
    var sc = this.top25.snapshot()
    var st = sc.state
    var self = this
    var focused = this.root.querySelector('[data-t25="search"]:focus')
    var searchVal = focused ? focused.value : st.search || ''
    var caret = focused ? focused.selectionStart : null
    var wrapEl = this.root.querySelector('.tv-wl-body')
    var scrollTop = wrapEl ? wrapEl.scrollTop : 0

    var ex = '—'
    try {
      var pane = this.top25._paneCfg()
      ex =
        C.EXCHANGE_PRESETS[pane.exchange] && C.EXCHANGE_PRESETS[pane.exchange].label
          ? C.EXCHANGE_PRESETS[pane.exchange].label
          : pane.exchange
    } catch (e) {}

    var status =
      sc.status === 'loading'
        ? 'загрузка…'
        : sc.status === 'error'
          ? sc.error || 'ошибка'
          : sc.fromScreener
            ? (sc.overrideLabel || 'скринер') + ' → ' + sc.rows.length
            : 'топ ' + sc.rows.length + ' из ' + sc.universe

    var COLORS = ['#f0b90b', '#ef5350', '#26a69a', '#2962ff', '#c084fc', '#ff9800', '#00bcd4', '#e91e63', '#8bc34a', '#ffffff']
    var paint = this._paint || { shape: 'star', color: '#f0b90b' }

    function sel(key, opts, cur) {
      return (
        '<select data-t25="' +
        key +
        '">' +
        opts
          .map(function (o) {
            var v = typeof o === 'string' ? o : o.v
            var l = typeof o === 'string' ? o : o.l
            return (
              '<option value="' +
              v +
              '"' +
              (String(cur) === String(v) ? ' selected' : '') +
              '>' +
              l +
              '</option>'
            )
          })
          .join('') +
        '</select>'
      )
    }

    var shapeBtns = ['star', 'flag', 'sq']
      .map(function (sh) {
        return (
          '<button type="button" class="tv-paint-shape' +
          (paint.shape === sh ? ' active' : '') +
          '" data-paint-shape="' +
          sh +
          '" title="' +
          sh +
          '">' +
          self._markIcon(sh) +
          '</button>'
        )
      })
      .join('')

    var colorBtns = COLORS.map(function (c) {
      return (
        '<button type="button" class="tv-paint-color' +
        (paint.color === c ? ' active' : '') +
        '" data-paint-color="' +
        c +
        '" style="--c:' +
        c +
        '" title="' +
        c +
        '"></button>'
      )
    }).join('')

    var rowsHtml = ''
    if (sc.status === 'loading' && !sc.rows.length) {
      rowsHtml = '<div class="screener-empty">Загрузка…</div>'
    } else if (sc.status === 'error' && !sc.rows.length) {
      rowsHtml = '<div class="screener-empty">' + (sc.error || 'Ошибка') + '</div>'
    } else if (!sc.rows.length) {
      rowsHtml = '<div class="screener-empty">Нет пар по фильтрам</div>'
    } else {
      rowsHtml = sc.rows
        .map(function (r, i) {
          var ch = Number(r.change) || 0
          var chCls = ch > 0 ? 'up' : ch < 0 ? 'down' : ''
          var mark = r.mark
          var markHtml = mark
            ? '<span class="tv-wl-mark on" style="color:' +
              mark.color +
              '">' +
              self._markIcon(mark.shape) +
              '</span>'
            : '<span class="tv-wl-mark off">☆</span>'
          return (
            '<div class="tv-wl-row' +
            (mark ? ' marked' : '') +
            '" data-t25-sym="' +
            r.symbol +
            '">' +
            '<button type="button" class="tv-wl-mark-btn" data-t25-mark="' +
            r.symbol +
            '" title="Избранное (ПКМ — снять)">' +
            markHtml +
            '</button>' +
            '<span class="tv-wl-rank">' +
            (i + 1) +
            '</span>' +
            '<span class="tv-wl-sym">' +
            (r.label || String(r.symbol).toUpperCase()) +
            '</span>' +
            '<span class="tv-wl-px">' +
            C.formatPrice(r.price, C.inferTickSize(r.price)) +
            '</span>' +
            '<span class="tv-wl-chg ' +
            chCls +
            '">' +
            (ch >= 0 ? '+' : '') +
            ch.toFixed(2) +
            '%</span>' +
            '<span class="tv-wl-vol">' +
            (Number(r.volatility) || 0).toFixed(2) +
            '%</span>' +
            '<span class="tv-wl-mm">' +
            (Number(r.mmScore) || 0) +
            '</span>' +
            '</div>'
          )
        })
        .join('')
    }

    this.root.classList.add('top25-fullscreen')
    this.root.innerHTML = [
      '<header class="tv-wl-head">',
      '  <div class="tv-wl-title-row">',
      '    <h2>Watchlist</h2>',
      '    <span class="screener-ex">' + ex + '</span>',
      '    <span class="screener-status">' + status + '</span>',
      this._modeToggleHtml(),
      this._uiToggleHtml(),
      '  </div>',
      '  <div class="tv-wl-tools" data-el="tools">',
      '    <div class="tv-paint" title="Кисть метки">' + shapeBtns + '<span class="tv-paint-sep"></span>' + colorBtns + '</div>',
      sel(
        'pane',
        [
          { v: 'spot', l: 'Spot' },
          { v: 'futures', l: 'Futures' },
        ],
        st.pane,
      ),
      sel(
        'quote',
        ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'ALL'].map(function (q) {
          return { v: q, l: q }
        }),
        st.quote,
      ),
      '<input type="search" data-t25="search" placeholder="Поиск…" value="' +
        String(searchVal).replace(/"/g, '&quot;') +
        '">',
      sel(
        'sort',
        [
          { v: 'volatility', l: 'Сорт: волат' },
          { v: 'mark', l: 'Сорт: метка' },
          { v: 'change', l: 'Сорт: Δ%' },
          { v: 'quoteVolume', l: 'Сорт: оборот' },
          { v: 'mmScore', l: 'Сорт: ММ' },
          { v: 'label', l: 'Сорт: тикер' },
        ],
        st.sort || 'volatility',
      ),
      sel(
        'dir',
        [
          { v: 'desc', l: '↓' },
          { v: 'asc', l: '↑' },
        ],
        st.dir || 'desc',
      ),
      '<button type="button" class="btn ghost" data-act="reload">↻</button>',
      sc.fromScreener
        ? '<button type="button" class="btn ghost" data-act="clear-override" title="Вернуть обычный Топ-25">Обычный Топ-25</button>'
        : '',
      '<button type="button" class="btn primary" data-act="to-charts">Графики</button>',
      '  </div>',
      '  <div class="tv-wl-cols" data-el="cols"><span></span><span>#</span><span>Тикер</span><span>Цена</span><span>Δ%</span><span>Волат</span><span>ММ</span></div>',
      '</header>',
      '<div class="tv-wl-body" data-el="list">' + rowsHtml + '</div>',
      '<button type="button" class="ui-vis-fab" data-act="ui-show-all" title="Показать панели">☰</button>',
    ].join('')

    this._applyUiClasses()
    if (focused) {
      var again = this.root.querySelector('[data-t25="search"]')
      if (again) {
        again.focus()
        if (caret != null) {
          try {
            again.setSelectionRange(caret, caret)
          } catch (e) {}
        }
      }
    }
    var wrapAgain = this.root.querySelector('.tv-wl-body')
    if (wrapAgain) wrapAgain.scrollTop = scrollTop

    this._bindFilters()

    this.root.onclick = function (e) {
      var uiBtn = e.target.closest('[data-ui-toggle]')
      if (uiBtn) {
        self._toggleUi(uiBtn.getAttribute('data-ui-toggle'))
        // list hide in list-mode: show fab only
        if (self._mode === 'list') self._applyUiClasses()
        return
      }
      var showAll = e.target.closest('[data-act="ui-show-all"]')
      if (showAll) {
        self._ui = Object.assign({}, DEFAULT_UI)
        self._saveUi()
        self.render()
        return
      }
      var modeBtn = e.target.closest('[data-mode]')
      if (modeBtn) {
        self._setMode(modeBtn.getAttribute('data-mode'))
        return
      }
      var sh = e.target.closest('[data-paint-shape]')
      if (sh) {
        self._paint.shape = sh.getAttribute('data-paint-shape')
        self._savePaint()
        self.render()
        return
      }
      var col = e.target.closest('[data-paint-color]')
      if (col) {
        self._paint.color = col.getAttribute('data-paint-color')
        self._savePaint()
        self.render()
        return
      }
      var mk = e.target.closest('[data-t25-mark]')
      if (mk) {
        e.stopPropagation()
        var symM = mk.getAttribute('data-t25-mark')
        var paneM = self.top25.get().pane === 'futures' ? 'futures' : 'spot'
        var cur = self.screener && self.screener.getMark(symM, paneM)
        if (cur) {
          self.bus.emit('screener:mark-clear', { symbol: symM, pane: paneM })
        } else {
          self.bus.emit('screener:mark', {
            symbol: symM,
            pane: paneM,
            mark: { shape: self._paint.shape, color: self._paint.color },
          })
        }
        return
      }
      var row = e.target.closest('[data-t25-sym]')
      if (row && !e.target.closest('[data-t25-mark]')) {
        self.bus.emit('top25:open', { symbol: row.getAttribute('data-t25-sym') })
        self.bus.emit('ui:set-page', 'trade')
        return
      }
      var act = e.target.closest('[data-act]')
      if (!act) return
      var a = act.getAttribute('data-act')
      if (a === 'reload') self.bus.emit('top25:reload')
      if (a === 'clear-override') self.bus.emit('top25:clear-override')
      if (a === 'to-charts') self._setMode('charts')
    }

    this.root.oncontextmenu = function (e) {
      var mk = e.target.closest('[data-t25-mark]')
      if (!mk) return
      e.preventDefault()
      var paneM = self.top25.get().pane === 'futures' ? 'futures' : 'spot'
      self.bus.emit('screener:mark-clear', {
        symbol: mk.getAttribute('data-t25-mark'),
        pane: paneM,
      })
    }
  }

  Top25UiAgent.prototype.start = function () {
    var page = 'trade'
    try {
      page = localStorage.getItem('scalp-page-view') || 'trade'
    } catch (e) {}
    var on = page === 'top25' || page === 'visualizer'
    if (this.root) this.root.hidden = !on
    if (page === 'visualizer') this._mode = 'charts'
    if (on) this.render()
  }

  global.Scalp.Top25UiAgent = Top25UiAgent
})(typeof window !== 'undefined' ? window : globalThis)
