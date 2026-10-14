/* RsiBollUiAgent — страница RSI+Boll сигналы → Telegram */
(function (global) {
  'use strict'

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function RsiBollUiAgent(bus, telegramAgent, tickersAgent, root) {
    this.bus = bus
    this.telegram = telegramAgent
    this.tickers = tickersAgent
    this.root = root
    this._alertId = null
    this._bind()
  }

  RsiBollUiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('ui:set-page', function (page) {
      if (page === 'rsi-boll') self.render()
    })
    this.bus.on('telegram:changed', function () {
      if (self._visible()) self.render()
    })
    this.bus.on('telegram:alerts', function () {
      if (self._visible()) self.render()
    })
  }

  RsiBollUiAgent.prototype._visible = function () {
    return this.root && !this.root.hidden
  }

  RsiBollUiAgent.prototype.render = function () {
    if (!this.root) return
    var tg = (this.telegram && this.telegram.get && this.telegram.get()) || {}
    var watch =
      (this.telegram && this.telegram.getWatchlist && this.telegram.getWatchlist()) || []
    var alerts = (this.telegram && this.telegram.getAlerts && this.telegram.getAlerts()) || []
    var self = this
    var sel = this._alertId
      ? alerts.filter(function (a) {
          return a.id === self._alertId
        })[0]
      : alerts[0]
    if (sel) this._alertId = sel.id

    var chips = watch
      .map(function (s) {
        return '<button type="button" class="rb-chip" data-rb-sym="' + esc(s) + '">' + esc(s) + '</button>'
      })
      .join('')

    var hist = alerts.length
      ? alerts
          .map(function (a) {
            return (
              '<button type="button" class="rb-alert-row' +
              (sel && sel.id === a.id ? ' active' : '') +
              '" data-rb-alert="' +
              esc(a.id) +
              '">' +
              '<span class="rb-a-sym">' +
              esc(a.label || a.symbol) +
              '</span>' +
              '<span class="rb-a-meta">' +
              (a.kind === 'rsi_boll' ? 'RSI+Boll' : 'RSI') +
              ' ≤' +
              a.oversold +
              ' · ' +
              a.bars +
              ' бар · ' +
              esc(a.interval || '') +
              '</span>' +
              '<span class="rb-a-ts">' +
              new Date(a.ts).toLocaleString() +
              '</span>' +
              '</button>'
            )
          })
          .join('')
      : '<div class="rb-empty">Пока нет сигналов — poll ждёт RSI+Boll на watchlist</div>'

    this.root.innerHTML = [
      '<header class="rb-head">',
      '  <div>',
      '    <h1>RSI + Bollinger</h1>',
      '    <p class="rb-sub">Сигналы в Telegram · вход open следующей · стоп / тейк1 в тексте алерта</p>',
      '  </div>',
      '  <div class="rb-head-actions">',
      '    <button type="button" class="btn ghost" data-rb-act="tg-settings">Telegram token</button>',
      '    <button type="button" class="btn ghost" data-rb-act="test">Тест TG</button>',
      '    <button type="button" class="btn ghost" data-rb-act="trade">← Торговля</button>',
      '  </div>',
      '</header>',
      '<div class="rb-layout">',
      '  <section class="rb-card">',
      '    <h2>Правило</h2>',
      '    <ol class="rb-steps">',
      '      <li>RSI ≤ <b>' +
        esc(tg.rsiOversold != null ? tg.rsiOversold : 27) +
        '</b> и цена у нижней Boll (вблизи)</li>',
      '      <li>Так подряд <b>' +
        esc(tg.rsiSignalBars != null ? tg.rsiSignalBars : 5) +
        '</b> баров на <b>' +
        esc(tg.rsiInterval || '15m') +
        '</b></li>',
      '      <li>Алерт → вход на open следующей</li>',
      '      <li>Стоп −' +
        esc(tg.rsiStopPct != null ? tg.rsiStopPct : 1.2) +
        '% · тейк1 +' +
        esc(tg.rsiTakePct != null ? tg.rsiTakePct : 1.6) +
        '% × ' +
        esc(tg.rsiTakePartialPct != null ? tg.rsiTakePartialPct : 50) +
        '%</li>',
      '    </ol>',
      '  </section>',
      '  <section class="rb-card">',
      '    <h2>Параметры</h2>',
      '    <div class="rb-toggles">',
      '      <label class="settings-toggle"><span>Вкл. алерты</span><input type="checkbox" data-tg="enabled"' +
        (tg.enabled ? ' checked' : '') +
        '></label>',
      '      <label class="settings-toggle"><span>RSI → TG</span><input type="checkbox" data-tg="alertRsi"' +
        (tg.alertRsi !== false ? ' checked' : '') +
        '></label>',
      '      <label class="settings-toggle"><span>RSI + нижняя Boll</span><input type="checkbox" data-tg="rsiBollRequired"' +
        (tg.rsiBollRequired !== false ? ' checked' : '') +
        '></label>',
      '      <label class="settings-toggle"><span>Watchlist</span><input type="checkbox" data-tg="rsiStrategyWatch"' +
        (tg.rsiStrategyWatch !== false ? ' checked' : '') +
        '></label>',
      '      <label class="settings-toggle"><span>Только ★</span><input type="checkbox" data-tg="rsiFavsOnly"' +
        (tg.rsiFavsOnly ? ' checked' : '') +
        '></label>',
      '    </div>',
      '    <div class="rb-fields">',
      '      <label>RSI OS<input type="number" min="1" max="50" data-tg="rsiOversold" value="' +
        (tg.rsiOversold != null ? tg.rsiOversold : 27) +
        '"></label>',
      '      <label>Баров<input type="number" min="1" max="50" data-tg="rsiSignalBars" value="' +
        (tg.rsiSignalBars != null ? tg.rsiSignalBars : 5) +
        '"></label>',
      '      <label>TF<select data-tg="rsiInterval">' +
        ['1m', '5m', '15m', '1h']
          .map(function (iv) {
            return (
              '<option value="' +
              iv +
              '"' +
              ((tg.rsiInterval || '15m') === iv ? ' selected' : '') +
              '>' +
              iv +
              '</option>'
            )
          })
          .join('') +
        '</select></label>',
      '      <label>Стоп %<input type="number" step="0.1" data-tg="rsiStopPct" value="' +
        (tg.rsiStopPct != null ? tg.rsiStopPct : 1.2) +
        '"></label>',
      '      <label>Тейк %<input type="number" step="0.1" data-tg="rsiTakePct" value="' +
        (tg.rsiTakePct != null ? tg.rsiTakePct : 1.6) +
        '"></label>',
      '      <label>Доля %<input type="number" step="5" data-tg="rsiTakePartialPct" value="' +
        (tg.rsiTakePartialPct != null ? tg.rsiTakePartialPct : 50) +
        '"></label>',
      '      <label>Poll сек<input type="number" min="45" data-tg="rsiPollSec" value="' +
        (tg.rsiPollSec != null ? tg.rsiPollSec : 90) +
        '"></label>',
      '    </div>',
      '  </section>',
      '  <section class="rb-card rb-watch">',
      '    <h2>Watchlist · ' + watch.length + '</h2>',
      '    <div class="rb-chips">' + (chips || '<span class="rb-empty">пусто</span>') + '</div>',
      '  </section>',
      '  <section class="rb-card rb-hist">',
      '    <div class="rb-hist-head">',
      '      <h2>История · ' + alerts.length + '</h2>',
      '      <button type="button" class="btn ghost" data-rb-act="clear">Очистить</button>',
      '    </div>',
      '    <div class="rb-hist-list">' + hist + '</div>',
      sel
        ? '    <div class="rb-hist-detail">' +
          '<div><b>' +
          esc(sel.label || sel.symbol) +
          '</b> · ' +
          esc(sel.interval || '') +
          (sel.rsi != null ? ' · RSI ' + Number(sel.rsi).toFixed(1) : '') +
          (sel.price != null ? ' · ' + sel.price : '') +
          '</div>' +
          '<button type="button" class="btn primary" data-rb-act="open" data-rb-alert="' +
          esc(sel.id) +
          '">Открыть тикер</button>' +
          '</div>'
        : '',
      '  </section>',
      '</div>',
    ].join('')

    this.root.onclick = function (e) {
      var actBtn = e.target.closest('[data-rb-act]')
      if (actBtn) {
        var act = actBtn.getAttribute('data-rb-act')
        if (act === 'trade') self.bus.emit('ui:set-page', 'trade')
        if (act === 'test') self.bus.emit('telegram:test')
        if (act === 'clear') self.bus.emit('telegram:alerts-clear')
        if (act === 'tg-settings') self.bus.emit('ui:open-settings', { tab: 'telegram' })
        if (act === 'open') {
          var id = actBtn.getAttribute('data-rb-alert') || self._alertId
          var a = alerts.filter(function (x) {
            return x.id === id
          })[0]
          if (a && a.symbol) {
            self.bus.emit('tickers:set-symbol', {
              pane: 'spot',
              symbol: String(a.symbol).toLowerCase(),
            })
            self.bus.emit('ui:set-page', 'trade')
          }
        }
        return
      }
      var chip = e.target.closest('[data-rb-sym]')
      if (chip) {
        self.bus.emit('tickers:set-symbol', {
          pane: 'spot',
          symbol: String(chip.getAttribute('data-rb-sym')).toLowerCase(),
        })
        self.bus.emit('ui:set-page', 'trade')
        return
      }
      var row = e.target.closest('[data-rb-alert]')
      if (row && !row.getAttribute('data-rb-act')) {
        self._alertId = row.getAttribute('data-rb-alert')
        self.render()
      }
    }

    this.root.querySelectorAll('[data-tg]').forEach(function (node) {
      var apply = function () {
        var key = node.getAttribute('data-tg')
        var val = node.type === 'checkbox' ? node.checked : node.value
        if (
          node.type === 'number' ||
          key === 'rsiOversold' ||
          key === 'rsiSignalBars' ||
          key === 'rsiPollSec' ||
          key === 'rsiStopPct' ||
          key === 'rsiTakePct' ||
          key === 'rsiTakePartialPct'
        ) {
          if (node.type !== 'checkbox') val = Number(val)
        }
        var patch = {}
        patch[key] = val
        self.bus.emit('telegram:patch', patch)
      }
      node.onchange = apply
      if (node.tagName === 'SELECT') node.onchange = apply
    })
  }

  global.Scalp.RsiBollUiAgent = RsiBollUiAgent
})(typeof window !== 'undefined' ? window : globalThis)
