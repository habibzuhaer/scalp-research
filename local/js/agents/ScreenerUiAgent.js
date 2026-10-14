/* ScreenerUiAgent — вкладка скринера на странице */
(function (global) {
  'use strict'

  var FILTER_PRESETS = {
    illiquid: {
      filterPreset: 'illiquid',
      minVolume: 50000,
      maxVolume: 2000000,
      minPrice: '',
      maxPrice: '',
      minMm: '',
      maxSpread: '',
      minDepth: '',
      minTrades: '',
      minJump: '',
      maxJump: '',
      minVolat: '',
      maxVolat: '',
      maxAgeDays: '',
      bookBias: 'all',
      onlyFav: false,
      move: 'all',
      sort: 'quoteVolume',
      dir: 'asc',
      limit: 250,
    },
    cheap: {
      filterPreset: 'cheap',
      minVolume: 100000,
      maxVolume: '',
      minPrice: '',
      maxPrice: 1,
      minMm: '',
      maxSpread: '',
      minDepth: '',
      minTrades: '',
      minJump: '',
      maxJump: '',
      minVolat: '',
      maxVolat: '',
      maxAgeDays: '',
      bookBias: 'all',
      onlyFav: false,
      move: 'all',
      sort: 'price',
      dir: 'asc',
      limit: 250,
    },
    new: {
      filterPreset: 'new',
      minVolume: 50000,
      maxVolume: '',
      minPrice: '',
      maxPrice: '',
      minMm: '',
      maxSpread: '',
      minDepth: '',
      minTrades: '',
      minJump: '',
      maxJump: '',
      minVolat: '',
      maxVolat: '',
      maxAgeDays: 30,
      bookBias: 'all',
      onlyFav: false,
      move: 'all',
      sort: 'listTime',
      dir: 'desc',
      limit: 250,
    },
  }

  function ScreenerUiAgent(bus, screenerAgent, root) {
    this.bus = bus
    this.screener = screenerAgent
    this.root = root
    this._searchTimer = 0
    this._noteTimer = 0
    this._noteDrafts = {}
    this._bind()
  }

  ScreenerUiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('screener:changed', function () {
      self.render()
    })
    this.bus.on('ui:set-page', function (page) {
      self._applyPage(page)
    })
    document.querySelectorAll('[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        self.bus.emit('ui:set-page', btn.getAttribute('data-page'))
      })
    })
  }

  ScreenerUiAgent.prototype._applyPage = function (page) {
    var pages = {
      trade: 1,
      screener: 1,
      learn: 1,
      visualizer: 1,
      top25: 1,
      atr30: 1,
      workb: 1,
      'rsi-boll': 1,
      'smc-flow': 1,
    }
    if (!pages[page]) page = 'trade'
    try {
      localStorage.setItem('scalp-page-view', page)
    } catch (e) {}
    var shell = document.querySelector('.app-shell')
    if (shell) {
      shell.classList.toggle('page-screener', page === 'screener')
      shell.classList.toggle('page-learn', page === 'learn')
      shell.classList.toggle('page-trade', page === 'trade')
      shell.classList.toggle('page-visualizer', page === 'visualizer')
      shell.classList.toggle('page-top25', page === 'top25' || page === 'visualizer')
      shell.classList.toggle('page-atr30', page === 'atr30')
      shell.classList.toggle('page-workb', page === 'workb')
      shell.classList.toggle('page-rsi-boll', page === 'rsi-boll')
      shell.classList.toggle('page-smc-flow', page === 'smc-flow')
    }
    // mark both top25 and visualizer tabs when either active
    document
      .querySelectorAll(
        '#page-tabs [data-page], [data-rail] [data-page], #btn-screener[data-page], #btn-top25[data-page], #btn-atr30[data-page], #btn-workb[data-page], #btn-visualizer[data-page], #btn-rsi-boll[data-page], #btn-smc-flow[data-page], #btn-learn[data-page], #page-tabs .page-tab',
      )
      .forEach(function (btn) {
        var p = btn.getAttribute('data-page')
        if (!p) return
        var active = p === page
        if (page === 'visualizer' && (p === 'visualizer' || p === 'top25')) active = true
        if (page === 'top25' && p === 'top25') active = true
        btn.classList.toggle('active', active)
      })
    var trade = document.getElementById('trade-view')
    var scr = this.root
    var learn = document.getElementById('learn-root')
    var viz = document.getElementById('viz-root')
    var workb = document.getElementById('workb-root')
    var top25 = document.getElementById('top25-root')
    var atr30 = document.getElementById('atr30-root')
    var rsiBoll = document.getElementById('rsi-boll-root')
    var smcFlow = document.getElementById('smc-flow-root')
    if (trade) trade.hidden = page !== 'trade'
    if (scr) scr.hidden = page !== 'screener'
    if (learn) learn.hidden = page !== 'learn'
    if (viz) viz.hidden = true
    if (workb) workb.hidden = page !== 'workb'
    if (top25) top25.hidden = page !== 'top25' && page !== 'visualizer'
    if (atr30) atr30.hidden = page !== 'atr30'
    if (rsiBoll) rsiBoll.hidden = page !== 'rsi-boll'
    if (smcFlow) smcFlow.hidden = page !== 'smc-flow'
    if (page === 'screener' && this.screener) this.screener.load(true)
    window.dispatchEvent(new Event('resize'))
  }

  ScreenerUiAgent.prototype.render = function () {
    if (!this.root || !this.screener) return
    var C = global.Scalp.Config
    var sc = this.screener.snapshot()
    var st = sc.state
    var self = this
    var focused = this.root.querySelector('[data-sc="search"]:focus')
    var searchVal = focused ? focused.value : st.search || ''
    var caret = focused ? focused.selectionStart : null
    var noteFocused = this.root.querySelector('[data-sc-note]:focus')
    var noteSym = noteFocused ? noteFocused.getAttribute('data-sc-note') : null
    var noteDraft = noteFocused ? noteFocused.value : null
    var noteCaret = noteFocused ? noteFocused.selectionStart : null
    var wrapEl = this.root.querySelector('.screener-table-wrap')
    var scrollTop = wrapEl ? wrapEl.scrollTop : 0
    var scrollLeft = wrapEl ? wrapEl.scrollLeft : 0

    var ex = ''
    try {
      var pane = this.screener._paneCfg()
      ex =
        C.EXCHANGE_PRESETS[pane.exchange] && C.EXCHANGE_PRESETS[pane.exchange].label
          ? C.EXCHANGE_PRESETS[pane.exchange].label
          : pane.exchange
    } catch (e) {
      ex = '—'
    }

    var status =
      sc.status === 'loading'
        ? 'загрузка…'
        : sc.status === 'error'
          ? sc.error || 'ошибка'
          : 'показано ' + sc.rows.length + ' из ' + sc.total

    function sel(key, opts, cur) {
      return (
        '<select data-sc="' +
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

    function num(key, placeholder, val) {
      return (
        '<input type="number" data-sc="' +
        key +
        '" placeholder="' +
        placeholder +
        '" value="' +
        (val != null && val !== '' ? val : '') +
        '" step="any">'
      )
    }

    function presetCur(val, allowed) {
      var s = val === '' || val == null ? '' : String(Number(val))
      return allowed.indexOf(s) !== -1 ? s : ''
    }

    function col(id, label) {
      var on = st.sort === id
      return (
        '<button type="button" class="sc-th' +
        (on ? ' on' : '') +
        '" data-sc-sort="' +
        id +
        '">' +
        label +
        (on ? (st.dir === 'asc' ? ' ↑' : ' ↓') : '') +
        '</button>'
      )
    }

    var tableHead =
      '<div class="screener-row head">' +
      col('fav', '★') +
      col('label', 'Тикер') +
      col('price', 'Цена') +
      col('change', 'Δ24h') +
      col('jump', '|Δ|') +
      col('volatility', 'Волат') +
      col('quoteVolume', 'Оборот$') +
      col('mmScore', 'ММ') +
      col('spreadBps', 'Спред') +
      col('topDepth', 'Глубина') +
      col('trades', 'Сделки') +
      col('note', 'Заметка') +
      '<span class="sc-tv-h">TV</span>' +
      '</div>'

    var paneCfg = null
    try {
      paneCfg = this.screener._paneCfg()
    } catch (e) {
      paneCfg = null
    }
    var exId = (paneCfg && paneCfg.exchange) || 'binance'
    var paneId = st.pane === 'futures' ? 'futures' : 'spot'

    function pick(arr) {
      return arr[Math.floor(Math.random() * arr.length)]
    }

    function tvTicker(sym) {
      var s = String(sym || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
      if (!s) return ''
      var fut = paneId === 'futures' || String(exId).indexOf('futures') !== -1
      var ex = String(exId || '').toLowerCase()
      if (ex.indexOf('bybit') === 0) {
        return fut ? 'BYBIT:' + s + '.P' : 'BYBIT:' + s
      }
      return fut ? 'BINANCE:' + s + '.P' : 'BINANCE:' + s
    }

    /** Прямая ссылка на TV со случайным interval/host (без popup-блокера). */
    function tvHref(sym) {
      var ticker = tvTicker(sym)
      if (!ticker) return '#'
      var interval = pick(['1', '3', '5', '15', '30', '60', '240', 'D'])
      var host = pick(['www.tradingview.com', 'ru.tradingview.com'])
      var mode = pick(['interval', 'interval-style', 'chart'])
      var base =
        'https://' + host + '/chart/?symbol=' + encodeURIComponent(ticker)
      if (mode === 'interval-style') {
        return base + '&interval=' + interval + '&style=' + pick(['1', '8', '9'])
      }
      if (mode === 'chart') return base
      return base + '&interval=' + interval
    }

    function escAttr(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    }

    var rowsHtml = ''
    if (sc.status === 'loading' && !sc.rows.length) {
      rowsHtml = '<div class="screener-empty">Загрузка крипты с биржи…</div>'
    } else if (sc.status === 'error' && !sc.rows.length) {
      rowsHtml = '<div class="screener-empty">' + (sc.error || 'Ошибка') + '</div>'
    } else if (!sc.rows.length) {
      rowsHtml = st.onlyFav
        ? '<div class="screener-empty">Нет избранного по фильтрам — нажмите ★ у тикера</div>'
        : '<div class="screener-empty">Нет пар по фильтрам</div>'
    } else {
      rowsHtml = sc.rows
        .map(function (r) {
          var ch = Number(r.change) || 0
          var jp = Number(r.jump) || Math.abs(ch)
          var vt = Number(r.volatility) || 0
          var mm = Number(r.mmScore) || 0
          var spr = Number(r.spreadBps)
          var dep = Number(r.topDepth) || 0
          var tr = Number(r.trades) || 0
          var chCls = ch > 0 ? 'up' : ch < 0 ? 'down' : ''
          var spikeCls = jp >= 5 ? ' spike' : ''
          var mmCls = mm >= 75 ? ' mm-good' : mm >= 55 ? ' mm-ok' : ' mm-weak'
          var isFav = !!r.fav
          var noteVal =
            noteSym === r.symbol && noteDraft != null
              ? noteDraft
              : self._noteDrafts[r.symbol] != null
                ? self._noteDrafts[r.symbol]
                : r.note || ''
          return (
            '<div class="screener-row' +
            spikeCls +
            (isFav ? ' is-fav' : '') +
            '" data-sc-sym="' +
            r.symbol +
            '" role="button" tabindex="0">' +
            '<button type="button" class="sc-fav' +
            (isFav ? ' on' : '') +
            '" data-sc-fav="' +
            r.symbol +
            '" title="' +
            (isFav ? 'Убрать из избранного' : 'Добавить в избранное') +
            '" aria-pressed="' +
            (isFav ? 'true' : 'false') +
            '">' +
            (isFav ? '★' : '☆') +
            '</button>' +
            '<span class="sc-sym">' +
            (r.label || r.symbol.toUpperCase()) +
            '</span>' +
            '<span class="sc-price">' +
            C.formatPrice(r.price, C.inferTickSize(r.price)) +
            '</span>' +
            '<span class="sc-chg ' +
            chCls +
            '">' +
            (ch >= 0 ? '+' : '') +
            ch.toFixed(2) +
            '%</span>' +
            '<span class="sc-jump' +
            (jp >= 5 ? ' hot' : '') +
            '">' +
            jp.toFixed(2) +
            '%</span>' +
            '<span class="sc-volat' +
            (vt >= 8 ? ' hot' : '') +
            '">' +
            vt.toFixed(2) +
            '%</span>' +
            '<span class="sc-vol">' +
            C.formatUsdVolume(r.quoteVolume, { shortenThousands: true }) +
            '</span>' +
            '<span class="sc-mm' +
            mmCls +
            '" title="Оценка работы маркет-мейкера 0–100: узкий спред + глубина лучшего уровня + оборот + число сделок">' +
            mm +
            '</span>' +
            '<span class="sc-spr' +
            (r.spreadBps == null ? '' : spr <= 5 ? ' tight' : spr >= 20 ? ' wide' : '') +
            '" title="Спред между лучшим bid и ask, в базисных пунктах (bps)">' +
            (r.spreadBps == null || !isFinite(spr) ? '—' : spr.toFixed(1)) +
            '</span>' +
            '<span class="sc-vol" title="Суммарная ликвидность на лучшем bid и ask, в $">' +
            C.formatUsdVolume(dep, { shortenThousands: true }) +
            '</span>' +
            '<span class="sc-vol" title="Количество сделок за 24 часа">' +
            (tr > 0 ? C.formatUsdVolume(tr, { shortenThousands: true }) : '—') +
            '</span>' +
            '<input class="sc-note" data-sc-note="' +
            r.symbol +
            '" type="text" maxlength="240" placeholder="заметка…" value="' +
            escAttr(noteVal) +
            '" title="Заметка по тикеру">' +
            '<a class="sc-tv" data-sc-tv="' +
            r.symbol +
            '" href="' +
            tvHref(r.symbol) +
            '" target="_blank" rel="noopener noreferrer" title="Открыть в TradingView">TV</a>' +
            '</div>'
          )
        })
        .join('')
    }

    this.root.innerHTML = [
      '<header class="screener-page-head">',
      '  <div class="screener-title"><h2>Скринер</h2><span class="screener-ex">' +
        ex +
        '</span><span class="screener-status">' +
        status +
        '</span></div>',
      '  <div class="screener-filters">',
      sel('pane', [
        { v: 'spot', l: 'Рынок: Spot' },
        { v: 'futures', l: 'Рынок: Futures' },
      ], st.pane),
      sel(
        'quote',
        ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'FDUSD', 'EUR', 'TRY', 'ALL'].map(function (q) {
          return { v: q, l: q === 'ALL' ? 'Котировка: все' : 'Котировка: ' + q }
        }),
        st.quote,
      ),
      '<input type="search" data-sc="search" placeholder="поиск тикера…" value="' +
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
        'move',
        [
          { v: 'all', l: 'Движение: все' },
          { v: 'up', l: 'Движение: только рост (Δ24h > 0)' },
          { v: 'down', l: 'Движение: только падение (Δ24h < 0)' },
        ],
        st.move || 'all',
      ),
      sel(
        'jumpPreset',
        [
          { v: '', l: 'Резкий скачок |Δ24h|: любой' },
          { v: '3', l: 'Резкий скачок |Δ24h| ≥ 3%' },
          { v: '5', l: 'Резкий скачок |Δ24h| ≥ 5%' },
          { v: '8', l: 'Резкий скачок |Δ24h| ≥ 8%' },
          { v: '15', l: 'Резкий скачок |Δ24h| ≥ 15%' },
        ],
        presetCur(st.minJump, ['3', '5', '8', '15']),
      ),
      sel(
        'volatPreset',
        [
          { v: '', l: 'Волатильность (high−low)/цена: любая' },
          { v: '5', l: 'Волатильность 24h ≥ 5%' },
          { v: '10', l: 'Волатильность 24h ≥ 10%' },
          { v: '15', l: 'Волатильность 24h ≥ 15%' },
          { v: '25', l: 'Волатильность 24h ≥ 25%' },
        ],
        presetCur(st.minVolat, ['5', '10', '15', '25']),
      ),
      sel(
        'mmPreset',
        [
          { v: '', l: 'Маркет-мейкер (оценка 0–100): любая' },
          { v: '40', l: 'Маркет-мейкер: слабый и выше (≥40)' },
          { v: '55', l: 'Маркет-мейкер: средний и выше (≥55)' },
          { v: '70', l: 'Маркет-мейкер: хороший (≥70) — узкий спред + ликвидность' },
          { v: '85', l: 'Маркет-мейкер: отличный (≥85) — плотный стакан' },
        ],
        presetCur(st.minMm, ['40', '55', '70', '85']),
      ),
      sel(
        'spreadPreset',
        [
          { v: '', l: 'Спред bid/ask: любой' },
          { v: '2', l: 'Спред bid/ask ≤ 2 bps (очень узкий)' },
          { v: '5', l: 'Спред bid/ask ≤ 5 bps (узкий)' },
          { v: '10', l: 'Спред bid/ask ≤ 10 bps' },
          { v: '25', l: 'Спред bid/ask ≤ 25 bps (допустимый)' },
        ],
        presetCur(st.maxSpread, ['2', '5', '10', '25']),
      ),
      sel(
        'depthPreset',
        [
          { v: '', l: 'Глубина лучшего уровня (Depth$): любая' },
          { v: '1000', l: 'Глубина top-of-book ≥ $1 000' },
          { v: '10000', l: 'Глубина top-of-book ≥ $10 000' },
          { v: '50000', l: 'Глубина top-of-book ≥ $50 000' },
          { v: '200000', l: 'Глубина top-of-book ≥ $200 000' },
        ],
        presetCur(st.minDepth, ['1000', '10000', '50000', '200000']),
      ),
      sel(
        'tradesPreset',
        [
          { v: '', l: 'Активность сделок 24h: любая' },
          { v: '1000', l: 'Сделок за 24h ≥ 1 000' },
          { v: '5000', l: 'Сделок за 24h ≥ 5 000' },
          { v: '20000', l: 'Сделок за 24h ≥ 20 000' },
          { v: '100000', l: 'Сделок за 24h ≥ 100 000' },
        ],
        presetCur(st.minTrades, ['1000', '5000', '20000', '100000']),
      ),
      sel(
        'bookBias',
        [
          { v: 'all', l: 'Перекос стакана: любой' },
          { v: 'bid', l: 'Перекос стакана: больше bid (покупатели)' },
          { v: 'ask', l: 'Перекос стакана: больше ask (продавцы)' },
          { v: 'balanced', l: 'Перекос стакана: баланс bid≈ask' },
        ],
        st.bookBias || 'all',
      ),
      num('minVolume', 'Оборот $ 24h от', st.minVolume),
      num('maxVolume', 'Оборот $ 24h до', st.maxVolume),
      num('minPrice', 'Цена от', st.minPrice),
      num('maxPrice', 'Цена до', st.maxPrice),
      sel(
        'limit',
        [50, 100, 250, 500, 1000].map(function (n) {
          return { v: String(n), l: 'Показать строк: ' + n }
        }),
        String(st.limit || 250),
      ),
      sel(
        'openPane',
        [
          { v: 'spot', l: 'Клик по тикеру → открыть Spot' },
          { v: 'futures', l: 'Клик по тикеру → открыть Futures' },
          { v: 'both', l: 'Клик по тикеру → открыть Spot и Futures' },
        ],
        st.openPane || 'spot',
      ),
      '<div class="screener-presets">',
      '<button type="button" class="btn ghost sc-preset' +
        (st.filterPreset === 'illiquid' ? ' active' : '') +
        '" data-act="preset-illiquid" title="Оборот $50k–$2M, сортировка по ликвидности ↑">Мелоликвидные</button>',
      '<button type="button" class="btn ghost sc-preset' +
        (st.filterPreset === 'cheap' ? ' active' : '') +
        '" data-act="preset-cheap" title="Цена ≤ $1, оборот ≥ $100k">Недорогие</button>',
      '<button type="button" class="btn ghost sc-preset' +
        (st.filterPreset === 'new' ? ' active' : '') +
        '" data-act="preset-new" title="Листинг ≤ 30 дней (Bybit / Binance Futures). Повторный клик — сброс">Новые</button>',
      '</div>',
      '<button type="button" class="btn ghost" data-act="reload" title="Обновить данные с биржи">Обновить с биржи</button>',
      '<button type="button" class="btn primary" data-act="open-viz" title="Текущий фильтр → Топ-25 / графики (до 55)">В Топ-25 / графики</button>',
      '<button type="button" class="btn ghost" data-act="reset-filters" title="Сбросить все фильтры">Сброс всех фильтров</button>',
      '  </div>',
      '  <p class="screener-hint">★ — избранное. Пресеты фильтров · «В Топ-25 / графики» — текущий список (до 55) сеткой. «Новые» — дата листинга (Bybit / Binance Futures). ММ — оценка стакана 0–100.</p>',
      '</header>',
      '<div class="screener-table-wrap">' + tableHead + rowsHtml + '</div>',
    ].join('')

    if (focused) {
      var again = this.root.querySelector('[data-sc="search"]')
      if (again) {
        again.focus()
        if (caret != null) {
          try {
            again.setSelectionRange(caret, caret)
          } catch (e) {}
        }
      }
    }
    if (noteSym) {
      var noteAgain = this.root.querySelector('[data-sc-note="' + noteSym + '"]')
      if (noteAgain) {
        noteAgain.focus()
        if (noteCaret != null) {
          try {
            noteAgain.setSelectionRange(noteCaret, noteCaret)
          } catch (e) {}
        }
      }
    }
    var wrapAgain = this.root.querySelector('.screener-table-wrap')
    if (wrapAgain) {
      wrapAgain.scrollTop = scrollTop
      wrapAgain.scrollLeft = scrollLeft
    }

    this.root.querySelectorAll('[data-sc]').forEach(function (node) {
      var key = node.getAttribute('data-sc')
      if (key === 'search') {
        node.oninput = function () {
          if (self._searchTimer) clearTimeout(self._searchTimer)
          self._searchTimer = setTimeout(function () {
            self.bus.emit('screener:patch', { search: node.value })
          }, 160)
        }
        return
      }
      var apply = function () {
        var val = node.value
        if (key === 'onlyFav') {
          self.bus.emit('screener:patch', { onlyFav: val === '1' })
          return
        }
        if (key === 'jumpPreset') {
          self.bus.emit('screener:patch', {
            minJump: val === '' ? '' : Number(val),
            maxJump: '',
          })
          return
        }
        if (key === 'volatPreset') {
          self.bus.emit('screener:patch', {
            minVolat: val === '' ? '' : Number(val),
            maxVolat: '',
          })
          return
        }
        if (key === 'mmPreset') {
          self.bus.emit('screener:patch', {
            minMm: val === '' ? '' : Number(val),
          })
          return
        }
        if (key === 'spreadPreset') {
          self.bus.emit('screener:patch', {
            maxSpread: val === '' ? '' : Number(val),
          })
          return
        }
        if (key === 'depthPreset') {
          self.bus.emit('screener:patch', {
            minDepth: val === '' ? '' : Number(val),
          })
          return
        }
        if (key === 'tradesPreset') {
          self.bus.emit('screener:patch', {
            minTrades: val === '' ? '' : Number(val),
          })
          return
        }
        if (
          key === 'limit' ||
          key === 'minVolume' ||
          key === 'maxVolume' ||
          key === 'minPrice' ||
          key === 'maxPrice' ||
          key === 'minVolat' ||
          key === 'maxVolat' ||
          key === 'minJump' ||
          key === 'maxJump' ||
          key === 'minMm' ||
          key === 'maxSpread' ||
          key === 'minDepth' ||
          key === 'minTrades'
        ) {
          val = val === '' ? '' : Number(val)
          if (key === 'limit') val = Number(val) || 250
        }
        var patch = {}
        patch[key] = val
        self.bus.emit('screener:patch', patch)
        if (key === 'pane') self.bus.emit('screener:reload')
      }
      node.onchange = apply
      if (node.tagName === 'INPUT' && node.type === 'number') node.onblur = apply
    })

    this.root.querySelectorAll('[data-sc-note]').forEach(function (node) {
      var flush = function () {
        var sym = node.getAttribute('data-sc-note')
        var val = node.value
        self._noteDrafts[sym] = val
        self.bus.emit('screener:note', { symbol: sym, note: val })
      }
      node.oninput = function () {
        var sym = node.getAttribute('data-sc-note')
        self._noteDrafts[sym] = node.value
        if (self._noteTimer) clearTimeout(self._noteTimer)
        self._noteTimer = setTimeout(flush, 220)
      }
      node.onblur = function () {
        if (self._noteTimer) clearTimeout(self._noteTimer)
        flush()
        var sym = node.getAttribute('data-sc-note')
        if (self._noteDrafts[sym] === node.value) delete self._noteDrafts[sym]
      }
      node.onclick = function (e) {
        e.stopPropagation()
      }
      node.onpointerdown = function (e) {
        e.stopPropagation()
      }
      node.onkeydown = function (e) {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          node.blur()
        }
      }
    })

    this.root.onpointerdown = function (e) {
      var tv = e.target.closest('[data-sc-tv]')
      if (!tv) return
      // свежий рандомный URL до клика — браузер откроет его нативно
      var sym = tv.getAttribute('data-sc-tv')
      tv.setAttribute('href', tvHref(sym))
    }

    this.root.onclick = function (e) {
      var tv = e.target.closest('[data-sc-tv]')
      if (tv) {
        // не открывать тикер в терминале; переход — нативный <a target=_blank>
        e.stopPropagation()
        return
      }
      var fav = e.target.closest('[data-sc-fav]')
      if (fav) {
        e.stopPropagation()
        e.preventDefault()
        self.bus.emit('screener:fav', { symbol: fav.getAttribute('data-sc-fav') })
        return
      }
      if (e.target.closest('[data-sc-note]')) {
        e.stopPropagation()
        return
      }
      var btn = e.target.closest('[data-sc-sym],[data-sc-sort],[data-act]')
      if (!btn) return
      var sym = btn.getAttribute('data-sc-sym')
      if (sym) {
        self.bus.emit('screener:open', { symbol: sym })
        self.bus.emit('ui:set-page', 'trade')
        return
      }
      var sort = btn.getAttribute('data-sc-sort')
      if (sort) {
        var cur = self.screener.get()
        var dir = cur.sort === sort && cur.dir === 'desc' ? 'asc' : 'desc'
        self.bus.emit('screener:patch', { sort: sort, dir: dir })
        return
      }
      var act = btn.getAttribute('data-act')
      if (act === 'reload') self.bus.emit('screener:reload')
      if (act === 'open-viz') {
        var rows = []
        try {
          rows = self.screener.filtered() || []
        } catch (e) {
          rows = (self.screener.snapshot() && self.screener.snapshot().rows) || []
        }
        if (!rows.length) {
          self.bus.emit('trade:toast', {
            ok: false,
            message: 'Нет тикеров по текущему фильтру',
          })
          return
        }
        var st = self.screener.get() || {}
        var label =
          st.filterPreset === 'illiquid'
            ? 'мелоликвидные'
            : st.filterPreset === 'cheap'
              ? 'недорогие'
              : st.filterPreset === 'new'
                ? 'новые'
                : 'фильтр скринера'
        self.bus.emit('top25:from-screener', {
          rows: rows,
          limit: 55,
          pane: st.pane === 'futures' ? 'futures' : 'spot',
          label: label,
        })
        self.bus.emit('top25:set-mode', 'charts')
        self.bus.emit('ui:set-page', 'visualizer')
        return
      }
      if (act && act.indexOf('preset-') === 0) {
        var pid = act.slice('preset-'.length)
        var cur = (self.screener.get() || {}).filterPreset
        if (cur === pid) {
          self.bus.emit('screener:patch', {
            filterPreset: '',
            minVolume: '',
            maxVolume: '',
            minPrice: '',
            maxPrice: '',
            maxAgeDays: '',
            minJump: '',
            maxJump: '',
            minVolat: '',
            maxVolat: '',
            minMm: '',
            maxSpread: '',
            minDepth: '',
            minTrades: '',
            bookBias: 'all',
            sort: 'quoteVolume',
            dir: 'desc',
          })
          return
        }
        var preset = FILTER_PRESETS[pid]
        if (preset) {
          self.bus.emit('screener:patch', Object.assign({}, preset))
          if (pid === 'new') {
            try {
              var cfg = self.screener._paneCfg && self.screener._paneCfg()
              if (cfg) {
                self.bus.emit('symbols:load', {
                  exchange: cfg.exchange,
                  restBaseUrl: cfg.restBaseUrl,
                  force: true,
                })
              }
            } catch (e) {}
            self.bus.emit('screener:reload')
          }
        }
        return
      }
      if (act === 'reset-filters') {
        self.bus.emit('screener:patch', {
          search: '',
          quote: 'USDT',
          move: 'all',
          minJump: '',
          maxJump: '',
          minVolat: '',
          maxVolat: '',
          minMm: '',
          maxSpread: '',
          minDepth: '',
          minTrades: '',
          maxAgeDays: '',
          filterPreset: '',
          bookBias: 'all',
          onlyFav: false,
          minVolume: '',
          maxVolume: '',
          minPrice: '',
          maxPrice: '',
          limit: 250,
          sort: 'quoteVolume',
          dir: 'desc',
        })
      }
    }
  }

  ScreenerUiAgent.prototype.start = function () {
    var page = 'trade'
    try {
      page = localStorage.getItem('scalp-page-view') || 'trade'
    } catch (e) {}
    this._applyPage(page)
    this.render()
  }

  global.Scalp.ScreenerUiAgent = ScreenerUiAgent
})(typeof window !== 'undefined' ? window : globalThis)
