/* Atr30UiAgent — вкладка топ-25 по дневному ATR% за 30 дней */
(function (global) {
  'use strict'

  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

  function dayTime(ts) {
    var n = Number(ts) || 0
    if (!n) return null
    if (n < 1e12) n *= 1000
    var d = new Date(n)
    return isNaN(d.getTime()) ? null : d
  }

  function daysFromRow(r) {
    if (r.days && r.days.length) return r.days
    return (r.spark || []).map(function (b) {
      var o = Number(b[0]) || 0
      var h = Number(b[1]) || 0
      var l = Number(b[2]) || 0
      var c = Number(b[3]) || 0
      var t = Number(b[4]) || 0
      return {
        t: t,
        rng: c > 0 ? ((h - l) / c) * 100 : 0,
        ch: o > 0 ? ((c - o) / o) * 100 : 0,
        o: o,
        h: h,
        l: l,
        c: c,
      }
    })
  }

  function daysStrip(days, lvPct) {
    var list = days || []
    if (!list.length) return '<div class="atr-days atr-days-empty">нет дневных данных</div>'
    return (
      '<div class="atr-days" title="Ход (high−low)/close за каждый из последних 30 дней">' +
      list
        .map(function (d, i) {
          var rng = Number(d.rng) || 0
          var ch = Number(d.ch) || 0
          var dir = ch > 0.02 ? 'up' : ch < -0.02 ? 'dn' : 'flat'
          var dt = dayTime(d.t)
          var label = dt
            ? String(dt.getDate())
            : String(i + 1)
          var title = dt
            ? dt.getDate() +
              ' ' +
              MONTHS[dt.getMonth()] +
              ' · ход ' +
              rng.toFixed(2) +
              '% · день ' +
              (ch >= 0 ? '+' : '') +
              ch.toFixed(2) +
              '%'
            : 'день ' +
              (i + 1) +
              ' · ход ' +
              rng.toFixed(2) +
              '%'
          var num = rng >= 10 ? rng.toFixed(0) : rng.toFixed(1)
          return (
            '<span class="atr-day atr-chip-pct lv-' +
            lvPct(rng) +
            ' ' +
            dir +
            '" title="' +
            title +
            '">' +
            '<em>' +
            label +
            '</em>' +
            '<b>' +
            num +
            '</b>' +
            '</span>'
          )
        })
        .join('') +
      '</div>'
    )
  }

  function Atr30UiAgent(bus, atr30Agent, root) {
    this.bus = bus
    this.atr = atr30Agent
    this.root = root
    this._searchTimer = 0
    this._bind()
  }

  Atr30UiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('atr30:changed', function () {
      self.render()
    })
    this.bus.on('ui:set-page', function (page) {
      if (self.root) self.root.hidden = page !== 'atr30'
    })
  }

  Atr30UiAgent.prototype.render = function () {
    if (!this.root || !this.atr) return
    var C = global.Scalp.Config
    var sc = this.atr.snapshot()
    var st = sc.state
    var self = this
    var focused = this.root.querySelector('[data-atr="search"]:focus')
    var searchVal = focused ? focused.value : st.search || ''
    var caret = focused ? focused.selectionStart : null
    var wrapEl = this.root.querySelector('.screener-table-wrap')
    var scrollTop = wrapEl ? wrapEl.scrollTop : 0
    var scrollLeft = wrapEl ? wrapEl.scrollLeft : 0

    var ex = '—'
    try {
      var pane = this.atr._paneCfg()
      ex =
        C.EXCHANGE_PRESETS[pane.exchange] && C.EXCHANGE_PRESETS[pane.exchange].label
          ? C.EXCHANGE_PRESETS[pane.exchange].label
          : pane.exchange
    } catch (e) {}

    var pg = sc.progress || { done: 0, total: 0, cached: 0 }
    var status =
      sc.status === 'loading'
        ? 'считаю ATR… ' + pg.done + '/' + pg.total + (pg.cached ? ' · кэш ' + pg.cached : '')
        : sc.status === 'error'
          ? sc.error || 'ошибка'
          : 'топ ' + sc.rows.length + ' · посчитано ' + sc.total + (pg.cached ? ' · кэш ' + pg.cached : '')

    function sel(key, opts, cur) {
      return (
        '<select data-atr="' +
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

    function col(id, label, kind) {
      var on = st.sort === id
      return (
        '<button type="button" class="sc-th atr-th atr-th-' +
        kind +
        (on ? ' on' : '') +
        '" data-atr-sort="' +
        id +
        '">' +
        label +
        (on ? (st.dir === 'asc' ? ' ↑' : ' ↓') : '') +
        '</button>'
      )
    }

    function lvPct(v) {
      if (v >= 8) return 4
      if (v >= 5) return 3
      if (v >= 3) return 2
      if (v >= 1.5) return 1
      return 0
    }

    function lvAbs(v, a, b, c, d) {
      v = Math.abs(Number(v) || 0)
      if (v >= d) return 4
      if (v >= c) return 3
      if (v >= b) return 2
      if (v >= a) return 1
      return 0
    }

    function chip(kind, text, lv, title) {
      return (
        '<span class="atr-chip atr-chip-' +
        kind +
        ' lv-' +
        lv +
        '" title="' +
        title +
        '">' +
        text +
        '</span>'
      )
    }

    var tableHead =
      '<div class="screener-row head atr30-row">' +
      '<span class="sc-th">★</span>' +
      '<span class="sc-th">#</span>' +
      col('label', 'Тикер', 'sym') +
      col('price', 'Цена', 'px') +
      col('atrPct', 'ATR%', 'pct') +
      col('atr', 'ATR$', 'usd') +
      col('adrPct', 'ADR 30д', 'adr') +
      col('change30', 'Δ30д', 'chg') +
      col('quoteVolume', 'Оборот$', 'vol') +
      '<span class="sc-tv-h">TV</span>' +
      '</div>'

    var paneCfg = null
    try {
      paneCfg = this.atr._paneCfg()
    } catch (e) {}
    var exId = (paneCfg && paneCfg.exchange) || 'binance'
    var paneId = st.pane === 'futures' ? 'futures' : 'spot'

    function tvHref(sym) {
      var s = String(sym || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
      if (!s) return '#'
      var fut = paneId === 'futures' || String(exId).indexOf('futures') !== -1
      var exn = String(exId || '').toLowerCase()
      var ticker =
        exn.indexOf('bybit') === 0
          ? fut
            ? 'BYBIT:' + s + '.P'
            : 'BYBIT:' + s
          : fut
            ? 'BINANCE:' + s + '.P'
            : 'BINANCE:' + s
      return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(ticker) + '&interval=D'
    }

    var rowsHtml = ''
    if (sc.status === 'loading' && !sc.rows.length) {
      rowsHtml =
        '<div class="screener-empty">Считаю дневной ATR по ликвидным тикерам… ' +
        pg.done +
        '/' +
        pg.total +
        '</div>'
    } else if (sc.status === 'error' && !sc.rows.length) {
      rowsHtml = '<div class="screener-empty">' + (sc.error || 'Ошибка') + '</div>'
    } else if (!sc.rows.length) {
      rowsHtml = st.onlyFav
        ? '<div class="screener-empty">Нет избранного — нажмите ★ у тикера или снимите «только избранное»</div>'
        : '<div class="screener-empty">Нет данных ATR по фильтрам</div>'
    } else {
      rowsHtml = sc.rows
        .map(function (r, i) {
          var ch = Number(r.change30) || 0
          var atrPct = Number(r.atrPct) || 0
          var adr = Number(r.adrPct) || 0
          var atrUsd = Number(r.atr) || 0
          var qv = Number(r.quoteVolume) || 0
          var chKind = ch > 0 ? 'up' : ch < 0 ? 'dn' : 'flat'
          var rank = i + 1
          var isFav = !!r.fav
          return (
            '<div class="atr30-block' +
            (isFav ? ' is-fav' : '') +
            '" data-atr-sym="' +
            r.symbol +
            '" role="button" tabindex="0">' +
            '<div class="screener-row atr30-row' +
            (isFav ? ' is-fav' : '') +
            '">' +
            '<button type="button" class="sc-fav' +
            (isFav ? ' on' : '') +
            '" data-atr-fav="' +
            r.symbol +
            '" title="' +
            (isFav ? 'Убрать из избранного ATR' : 'В избранное ATR') +
            '" aria-pressed="' +
            (isFav ? 'true' : 'false') +
            '">' +
            (isFav ? '★' : '☆') +
            '</button>' +
            '<span class="sc-rank' +
            (rank <= 3 ? ' top3' : '') +
            '">' +
            rank +
            '</span>' +
            '<span class="sc-sym">' +
            (r.label || r.symbol.toUpperCase()) +
            '</span>' +
            chip(
              'px',
              C.formatPrice(r.price, C.inferTickSize(r.price)),
              1,
              'Последняя цена',
            ) +
            chip(
              'pct',
              atrPct.toFixed(2) + '%',
              lvPct(atrPct),
              'ATR% — дневной ход относительно цены (Wilder 14). Янтарный. Ярче = волатильнее',
            ) +
            chip(
              'usd',
              C.formatPrice(atrUsd, C.inferTickSize(atrUsd)),
              lvAbs(atrUsd, 0.05, 1, 20, 500),
              'ATR$ — тот же ATR в долларах. Голубой',
            ) +
            chip(
              'adr',
              adr.toFixed(2) + '%',
              lvPct(adr),
              'ADR 30д — средний дневной диапазон (high−low)/close. Фиолетовый',
            ) +
            chip(
              chKind,
              (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%',
              lvAbs(ch, 4, 10, 20, 40),
              'Изменение цены за 30 дней. Зелёный рост, красный падение',
            ) +
            chip(
              'vol',
              C.formatUsdVolume(qv, { shortenThousands: true }),
              lvAbs(qv, 1e7, 2e7, 5e7, 2e8),
              'Оборот 24h в $. Синий — ликвидность',
            ) +
            '<a class="sc-tv" data-atr-tv="' +
            r.symbol +
            '" href="' +
            tvHref(r.symbol) +
            '" target="_blank" rel="noopener noreferrer">TV</a>' +
            '</div>' +
            '<div class="atr-days-cap">ход % по дням →</div>' +
            daysStrip(daysFromRow(r), lvPct) +
            '</div>'
          )
        })
        .join('')
    }

    this.root.innerHTML = [
      '<header class="screener-page-head">',
      '  <div class="screener-title"><h2>ATR 30д</h2><span class="screener-ex">' +
        ex +
        '</span><span class="screener-status">' +
        status +
        '</span></div>',
      '  <div class="screener-filters">',
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
      '<input type="search" data-atr="search" placeholder="поиск тикера…" value="' +
        String(searchVal).replace(/"/g, '&quot;') +
        '">',
      sel(
        'onlyFav',
        [
          { v: '0', l: 'Список: все' },
          { v: '1', l: 'Список: только избранное' },
        ],
        st.onlyFav ? '1' : '0',
      ),
      sel(
        'minVolume',
        [
          { v: '', l: 'Ликвидность: любая' },
          { v: '5000000', l: 'Оборот 24h ≥ $5M' },
          { v: '10000000', l: 'Оборот 24h ≥ $10M' },
          { v: '20000000', l: 'Оборот 24h ≥ $20M' },
          { v: '50000000', l: 'Оборот 24h ≥ $50M' },
        ],
        st.minVolume === '' || st.minVolume == null ? '' : String(Number(st.minVolume)),
      ),
      sel(
        'openPane',
        [
          { v: 'spot', l: 'Клик → Spot' },
          { v: 'futures', l: 'Клик → Futures' },
          { v: 'both', l: 'Клик → Spot и Futures' },
        ],
        st.openPane || 'futures',
      ),
      '<button type="button" class="btn ghost" data-act="reload" title="Пересчитать ATR, игнорируя кэш">Пересчитать</button>',
      '<button type="button" class="btn ghost" data-act="reset">Сброс</button>',
      '  </div>',
      '  <div class="atr-legend" aria-label="Цвета колонок">',
      '    <span class="atr-chip atr-chip-pct lv-3">ATR% ход</span>',
      '    <span class="atr-chip atr-chip-usd lv-3">ATR$ в $</span>',
      '    <span class="atr-chip atr-chip-adr lv-3">ADR средний день</span>',
      '    <span class="atr-chip atr-chip-up lv-3">Δ рост</span>',
      '    <span class="atr-chip atr-chip-dn lv-3">Δ падение</span>',
      '    <span class="atr-chip atr-chip-vol lv-3">Оборот</span>',
      '    <span class="atr-chip atr-chip-pct lv-3">день ход %</span>',
      '  </div>',
      '  <p class="screener-hint">★ — избранное ATR (отдельно от скринера). Под тикером — 30 ячеек: ход % за день. Янтарный ярче = волатильнее. Зелёная/красная обводка — день закрылся выше/ниже.</p>',
      '</header>',
      '<div class="screener-table-wrap">' + tableHead + rowsHtml + '</div>',
    ].join('')

    if (focused) {
      var again = this.root.querySelector('[data-atr="search"]')
      if (again) {
        again.focus()
        if (caret != null) {
          try {
            again.setSelectionRange(caret, caret)
          } catch (e) {}
        }
      }
    }
    var wrapAgain = this.root.querySelector('.screener-table-wrap')
    if (wrapAgain) {
      wrapAgain.scrollTop = scrollTop
      wrapAgain.scrollLeft = scrollLeft
    }

    this.root.querySelectorAll('[data-atr]').forEach(function (node) {
      var key = node.getAttribute('data-atr')
      if (key === 'search') {
        node.oninput = function () {
          if (self._searchTimer) clearTimeout(self._searchTimer)
          self._searchTimer = setTimeout(function () {
            self.bus.emit('atr30:patch', { search: node.value })
          }, 160)
        }
        return
      }
      node.onchange = function () {
        var val = node.value
        if (key === 'minVolume') val = val === '' ? '' : Number(val)
        if (key === 'onlyFav') val = val === '1'
        var patch = {}
        patch[key] = val
        self.bus.emit('atr30:patch', patch)
      }
    })

    this.root.onclick = function (e) {
      var fav = e.target.closest('[data-atr-fav]')
      if (fav) {
        e.stopPropagation()
        e.preventDefault()
        self.bus.emit('atr30:fav', { symbol: fav.getAttribute('data-atr-fav') })
        return
      }
      var tv = e.target.closest('[data-atr-tv]')
      if (tv) {
        e.stopPropagation()
        return
      }
      var btn = e.target.closest('[data-atr-sym],[data-atr-sort],[data-act]')
      if (!btn) return
      var sym = btn.getAttribute('data-atr-sym')
      if (sym) {
        self.bus.emit('atr30:open', { symbol: sym })
        self.bus.emit('ui:set-page', 'trade')
        return
      }
      var sort = btn.getAttribute('data-atr-sort')
      if (sort) {
        var cur = self.atr.get()
        var dir = cur.sort === sort && cur.dir === 'desc' ? 'asc' : 'desc'
        self.bus.emit('atr30:patch', { sort: sort, dir: dir })
        return
      }
      var act = btn.getAttribute('data-act')
      if (act === 'reload') self.bus.emit('atr30:reload')
      if (act === 'reset') self.bus.emit('atr30:patch', self.atr.defaults())
    }
  }

  Atr30UiAgent.prototype.start = function () {
    var page = 'trade'
    try {
      page = localStorage.getItem('scalp-page-view') || 'trade'
    } catch (e) {}
    if (this.root) this.root.hidden = page !== 'atr30'
    this.render()
  }

  global.Scalp.Atr30UiAgent = Atr30UiAgent
})(typeof window !== 'undefined' ? window : globalThis)
