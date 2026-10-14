/* SmcFlowUiAgent — страница Open SMC Flow backtest */
(function (global) {
  'use strict'

  var DATA_BASE = '/research/smc_flow/out/'

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function pct(n, dig) {
    if (n == null || !isFinite(Number(n))) return '—'
    return Number(n).toFixed(dig != null ? dig : 2) + '%'
  }

  function wr(n) {
    if (n == null || !isFinite(Number(n))) return '—'
    return (Number(n) * 100).toFixed(1) + '%'
  }

  function clsNum(n) {
    if (n == null || !isFinite(Number(n))) return ''
    if (Number(n) > 0) return ' pos'
    if (Number(n) < 0) return ' neg'
    return ''
  }

  function SmcFlowUiAgent(bus, tickersAgent, root) {
    this.bus = bus
    this.tickers = tickersAgent
    this.root = root
    this.tf = '15m'
    this.mode = 'raw'
    this.summary = null
    this.bySymbol = null
    this._loading = false
    this._err = null
    this._bind()
  }

  SmcFlowUiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('ui:set-page', function (page) {
      if (page === 'smc-flow') {
        self.load()
      }
    })
  }

  SmcFlowUiAgent.prototype.load = function () {
    var self = this
    if (this._loading) {
      this.render()
      return
    }
    this._loading = true
    this._err = null
    this.render()
    Promise.all([
      fetch(DATA_BASE + 'summary.json').then(function (r) {
        if (!r.ok) throw new Error('summary HTTP ' + r.status)
        return r.json()
      }),
      fetch(DATA_BASE + 'by_symbol.json').then(function (r) {
        if (!r.ok) throw new Error('by_symbol HTTP ' + r.status)
        return r.json()
      }),
    ])
      .then(function (arr) {
        self.summary = arr[0]
        self.bySymbol = arr[1]
        self._loading = false
        self.render()
      })
      .catch(function (e) {
        self._loading = false
        self._err = e.message || String(e)
        self.render()
      })
  }

  SmcFlowUiAgent.prototype._rowsForFilter = function () {
    var rows = []
    var data = this.bySymbol
    if (!data) return rows
    Object.keys(data).forEach(function (k) {
      var block = data[k]
      if (!block || typeof block !== 'object') return
      var symbol = block.symbol || k.split('_')[0]
      var tf = block.tf || (k.indexOf('_15m') >= 0 ? '15m' : '5m')
      var modes = block.modes || {}
      Object.keys(modes).forEach(function (mode) {
        var m = modes[mode] || {}
        var ft = m.flip_trades || {}
        var c = m.counts || {}
        rows.push({
          symbol: symbol,
          tf: tf,
          mode: mode,
          trades: ft.n,
          winrate: ft.winrate,
          avg_ret_pct: ft.avg_ret,
          sum_ret_pct: ft.sum_ret,
          avg_mfe: ft.avg_mfe,
          avg_mae: ft.avg_mae,
          buys: c.buy,
          sells: c.sell,
        })
      })
    })
    var tf = this.tf
    var mode = this.mode
    return rows
      .filter(function (r) {
        return (!tf || r.tf === tf) && (!mode || r.mode === mode) && r.trades != null
      })
      .sort(function (a, b) {
        return (Number(b.sum_ret_pct) || 0) - (Number(a.sum_ret_pct) || 0)
      })
  }

  SmcFlowUiAgent.prototype.render = function () {
    if (!this.root) return
    var self = this
    var s = this.summary || {}
    var uni = s.universe || {}
    var byTm = s.by_tf_mode || {}
    var params = uni.params || {}
    var modes = params.modes || {
      raw: 'Supertrend Buy/Sell only',
      struct: '+ structure trend filter',
      struct_zone: '+ Discount/Premium zone',
    }
    var gen = uni.generated_at || '—'

    var aggRows = Object.keys(byTm)
      .sort()
      .map(function (key) {
        var v = byTm[key]
        var parts = key.split('|')
        var active = parts[0] === self.tf && parts[1] === self.mode
        return (
          '<tr class="' +
          (active ? 'active' : '') +
          '" data-smc-tf="' +
          esc(parts[0]) +
          '" data-smc-mode="' +
          esc(parts[1]) +
          '">' +
          '<td>' +
          esc(parts[0]) +
          '</td><td>' +
          esc(parts[1]) +
          '</td>' +
          '<td class="num">' +
          (v.symbols != null ? v.symbols : '—') +
          '</td>' +
          '<td class="num">' +
          (v.trades != null ? v.trades : '—') +
          '</td>' +
          '<td class="num">' +
          wr(v.avg_winrate) +
          '</td>' +
          '<td class="num' +
          clsNum(v.avg_ret_pct) +
          '">' +
          pct(v.avg_ret_pct, 3) +
          '</td>' +
          '<td class="num' +
          clsNum(v.median_sum_ret_pct) +
          '">' +
          pct(v.median_sum_ret_pct, 2) +
          '</td>' +
          '<td class="num">' +
          pct(v.avg_mfe, 2) +
          '</td>' +
          '<td class="num">' +
          pct(v.avg_mae, 2) +
          '</td>' +
          '</tr>'
        )
      })
      .join('')

    var symRows = this._rowsForFilter()
    var symHtml = symRows.length
      ? symRows
          .map(function (r) {
            return (
              '<tr data-smc-sym="' +
              esc(r.symbol) +
              '">' +
              '<td><button type="button" class="smc-sym" data-smc-sym="' +
              esc(r.symbol) +
              '">' +
              esc(r.symbol) +
              '</button></td>' +
              '<td class="num">' +
              (r.trades != null ? r.trades : '—') +
              '</td>' +
              '<td class="num">' +
              wr(r.winrate) +
              '</td>' +
              '<td class="num' +
              clsNum(r.avg_ret_pct) +
              '">' +
              pct(r.avg_ret_pct, 3) +
              '</td>' +
              '<td class="num' +
              clsNum(r.sum_ret_pct) +
              '">' +
              pct(r.sum_ret_pct, 2) +
              '</td>' +
              '<td class="num">' +
              pct(r.avg_mfe, 2) +
              '</td>' +
              '<td class="num">' +
              pct(r.avg_mae, 2) +
              '</td>' +
              '<td class="num">' +
              (r.buys != null ? r.buys : '—') +
              '/' +
              (r.sells != null ? r.sells : '—') +
              '</td>' +
              '</tr>'
            )
          })
          .join('')
      : '<tr><td colspan="8" class="smc-empty">' +
        (this._loading ? 'Загрузка…' : this._err ? esc(this._err) : 'Нет строк для фильтра') +
        '</td></tr>'

    var chips5 = (uni.top_5m || [])
      .slice(0, 25)
      .map(function (s) {
        return '<span class="smc-chip">' + esc(s) + '</span>'
      })
      .join('')
    var chips15 = (uni.top_15m || [])
      .slice(0, 25)
      .map(function (s) {
        return '<span class="smc-chip">' + esc(s) + '</span>'
      })
      .join('')

    var modeOpts = Object.keys(modes)
      .map(function (m) {
        return (
          '<option value="' +
          esc(m) +
          '"' +
          (self.mode === m ? ' selected' : '') +
          '>' +
          esc(m) +
          '</option>'
        )
      })
      .join('')

    this.root.innerHTML = [
      '<header class="smc-head">',
      '  <div>',
      '    <h1>Open SMC Flow</h1>',
      '    <p class="smc-sub">Backtest top-25 волатильности · flip sim · fee 6bps/side · ' +
        esc(gen) +
        ' UTC</p>',
      '  </div>',
      '  <div class="smc-head-actions">',
      '    <button type="button" class="btn ghost" data-smc-act="reload">Обновить</button>',
      '    <a class="btn ghost" href="/research/smc_flow/out/RESULTS.md" target="_blank" rel="noopener">RESULTS.md</a>',
      '    <a class="btn ghost" href="/research/smc_flow/Open_SMC_Flow.pine" target="_blank" rel="noopener">Pine</a>',
      '    <button type="button" class="btn ghost" data-smc-act="trade">← Торговля</button>',
      '  </div>',
      '</header>',
      this._err
        ? '<div class="smc-banner err">Ошибка загрузки: ' + esc(this._err) + '</div>'
        : '',
      this._loading ? '<div class="smc-banner">Загрузка summary / by_symbol…</div>' : '',
      '<div class="smc-layout">',
      '  <section class="smc-card">',
      '    <h2>Режимы</h2>',
      '    <ul class="smc-modes">',
      Object.keys(modes)
        .map(function (m) {
          return '<li><b>' + esc(m) + '</b> — ' + esc(modes[m]) + '</li>'
        })
        .join('') +
        '    </ul>',
      '    <p class="smc-hint">ST ATR=' +
        esc(params.st_atr != null ? params.st_atr : 10) +
        ' · factor=' +
        esc(params.st_factor != null ? params.st_factor : 3) +
        ' · swing=' +
        esc(params.swing_len != null ? params.swing_len : 10) +
        '</p>',
      '  </section>',
      '  <section class="smc-card smc-wide">',
      '    <h2>Сводка TF × mode <span class="smc-muted">(клик — фильтр)</span></h2>',
      '    <div class="smc-scroll"><table class="smc-table">',
      '      <thead><tr><th>TF</th><th>Mode</th><th>Syms</th><th>Trades</th><th>Avg WR</th><th>Avg ret</th><th>Med sum</th><th>MFE</th><th>MAE</th></tr></thead>',
      '      <tbody>' +
        (aggRows || '<tr><td colspan="9" class="smc-empty">нет данных</td></tr>') +
        '</tbody>',
      '    </table></div>',
      '  </section>',
      '  <section class="smc-card smc-wide">',
      '    <div class="smc-filter-row">',
      '      <h2>По тикерам</h2>',
      '      <label>TF <select data-smc-filter="tf"><option value="5m"' +
        (this.tf === '5m' ? ' selected' : '') +
        '>5m</option><option value="15m"' +
        (this.tf === '15m' ? ' selected' : '') +
        '>15m</option></select></label>',
      '      <label>Mode <select data-smc-filter="mode">' +
        modeOpts +
        '</select></label>',
      '      <span class="smc-muted">' +
        symRows.length +
        ' строк</span>',
      '    </div>',
      '    <div class="smc-scroll"><table class="smc-table">',
      '      <thead><tr><th>Symbol</th><th>Trades</th><th>WR</th><th>Avg ret</th><th>Sum ret</th><th>MFE</th><th>MAE</th><th>B/S</th></tr></thead>',
      '      <tbody>' +
        symHtml +
        '</tbody>',
      '    </table></div>',
      '  </section>',
      '  <section class="smc-card">',
      '    <h2>Universe 5m</h2>',
      '    <div class="smc-chips">' +
        (chips5 || '—') +
        '</div>',
      '  </section>',
      '  <section class="smc-card">',
      '    <h2>Universe 15m</h2>',
      '    <div class="smc-chips">' +
        (chips15 || '—') +
        '</div>',
      '  </section>',
      '</div>',
    ].join('')

    this.root.onclick = function (e) {
      var act = e.target.closest('[data-smc-act]')
      if (act) {
        var a = act.getAttribute('data-smc-act')
        if (a === 'trade') self.bus.emit('ui:set-page', 'trade')
        if (a === 'reload') {
          self.summary = null
          self.bySymbol = null
          self.load()
        }
        return
      }
      var tr = e.target.closest('tr[data-smc-tf]')
      if (tr) {
        self.tf = tr.getAttribute('data-smc-tf')
        self.mode = tr.getAttribute('data-smc-mode')
        self.render()
        return
      }
      var symBtn = e.target.closest('[data-smc-sym]')
      if (symBtn) {
        var sym = String(symBtn.getAttribute('data-smc-sym') || '').toLowerCase()
        if (sym) {
          self.bus.emit('tickers:set-symbol', { pane: 'spot', symbol: sym })
          self.bus.emit('ui:set-page', 'trade')
        }
      }
    }

    this.root.querySelectorAll('[data-smc-filter]').forEach(function (node) {
      node.onchange = function () {
        var key = node.getAttribute('data-smc-filter')
        if (key === 'tf') self.tf = node.value
        if (key === 'mode') self.mode = node.value
        self.render()
      }
    })
  }

  global.Scalp.SmcFlowUiAgent = SmcFlowUiAgent
})(typeof window !== 'undefined' ? window : globalThis)
