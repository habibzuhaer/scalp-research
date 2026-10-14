/* SettingsUiAgent — Тикеры / Скринер / График / Профиль / История / DOM */
(function (global) {
  'use strict'

  function SettingsUiAgent(
    bus,
    tickersAgent,
    settingsAgent,
    chartAgent,
    profileAgent,
    historyAgent,
    symbolsAgent,
    layoutAgent,
    screenerAgent,
    coinglassAgent,
    telegramAgent,
  ) {
    this.bus = bus
    this.tickers = tickersAgent
    this.settings = settingsAgent
    this.chart = chartAgent
    this.profile = profileAgent
    this.history = historyAgent
    this.symbols = symbolsAgent || null
    this.layout = layoutAgent || null
    this.screener = screenerAgent || null
    this.coinglass = coinglassAgent || null
    this.telegram = telegramAgent || null
    this.open = false
    this.tab = 'tickers'
    this.focusPane = 'spot'
    this.overlay = null
    this._scSearchTimer = 0
    this._bind()
  }

  SettingsUiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('ui:open-settings', function (payload) {
      self.tab = (payload && payload.tab) || self.profile.get().defaultTab || 'tickers'
      if (self.tab === 'screener') {
        self.open = false
        self.bus.emit('ui:set-page', 'screener')
        return
      }
      if (payload && payload.pane) self.focusPane = payload.pane
      self.open = true
      self.render()
    })
    this.bus.on('ui:close-settings', function () {
      self.open = false
      self.render()
    })
    ;[
      'tickers:changed',
      'settings:changed',
      'chart:changed',
      'profile:changed',
      'history:changed',
      'symbols:changed',
      'symbols:loaded',
      'layout:changed',
      'telegram:changed',
      'telegram:alerts',
    ].forEach(function (ev) {
      self.bus.on(ev, function () {
        if (self.open) self.render()
      })
    })
  }

  SettingsUiAgent.prototype.render = function () {
    if (!this.open) {
      if (this.overlay) {
        this.overlay.remove()
        this.overlay = null
      }
      return
    }
    if (!this.overlay) {
      this.overlay = document.createElement('div')
      this.overlay.className = 'settings-overlay'
      document.body.appendChild(this.overlay)
    }

    var C = global.Scalp.Config
    var t = this.tickers.get()
    var dom = this.settings.state
    var chart = this.chart.get()
    var profile = this.profile.get()
    var hist = this.history.get()
    var self = this
    var body = ''

    if (this.tab === 'tickers') {
      body = [
        '<label class="settings-toggle"><span>Связать тикеры Spot ↔ Futures</span>',
        '<input type="checkbox" data-link="1"' + (t.linkSymbols ? ' checked' : '') + '></label>',
        paneBlock('spot', 'SPOT', t.spot, C),
        paneBlock('futures', 'FUTURES', t.futures, C),
        '<div class="api-actions"><button type="button" class="btn ghost" data-act="reset-tickers">Сбросить тикеры</button></div>',
      ].join('')
    } else if (this.tab === 'chart') {
      var ind = chart.indicators || {}
      body = [
        field(
          'Источник',
          '<select data-c="source"><option value="spot">Spot стакан</option><option value="futures">Futures стакан</option></select>',
        ),
        field(
          'Таймфрейм',
          '<select data-c="interval">' +
            C.CHART_INTERVALS.map(function (x) {
              return '<option value="' + x.id + '">' + x.label + '</option>'
            }).join('') +
            '</select>',
        ),
        field('Свечей', '<input type="number" min="50" max="500" data-c="limit" value="' + chart.limit + '">'),
        field(
          'Инструмент',
          '<select data-c="tool">' +
            (C.CHART_TOOLS || [])
              .map(function (t) {
                return '<option value="' + t.id + '">' + t.label + '</option>'
              })
              .join('') +
            '<option value="none">Нет</option></select>',
        ),
        '<p class="settings-note">Секундные ТФ: Binance Spot — свечи 1с; Futures/Bybit — агрегация сделок.</p>',
        '<div class="settings-section-title">Индикаторы</div>',
        toggleC('SMA 20', 'sma20', ind.sma20),
        toggleC('SMA 50', 'sma50', ind.sma50),
        toggleC('EMA 12', 'ema12', ind.ema12),
        toggleC('EMA 26', 'ema26', ind.ema26),
        toggleC('Bollinger (20,2)', 'bb', ind.bb),
        toggleC('VWAP', 'vwap', ind.vwap),
        '<label class="settings-toggle"><span>Live WebSocket</span><input type="checkbox" data-c="liveWs"' +
          (chart.liveWs !== false ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Следить за ценой</span><input type="checkbox" data-c="followLive"' +
          (chart.followLive !== false ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Объём</span><input type="checkbox" data-c="showVolume"' +
          (chart.showVolume ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>RSI 14</span><input type="checkbox" data-c="showRsi"' +
          (chart.showRsi ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Сетка</span><input type="checkbox" data-c="showGrid"' +
          (chart.showGrid ? ' checked' : '') +
          '></label>',
        '<div class="settings-section-title">Coinglass · уровни на графике</div>',
        '<p class="settings-note">Кнопки <b>Liq</b> / <b>Liq¢</b> на графике включают слои отдельно. Ключ — coinglass.com. CORS: <code>python3 local/serve.py</code>.</p>',
        '<label class="settings-toggle"><span>Уровни ликвидаций</span><input type="checkbox" data-c="showLiqLevels"' +
          (chart.showLiqLevels !== false ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Уровни ликвидности</span><input type="checkbox" data-c="showLiquidityLevels"' +
          (chart.showLiquidityLevels !== false ? ' checked' : '') +
          '></label>',
        field(
          'CG-API-KEY',
          '<input class="input-wide" data-cg="apiKey" type="password" autocomplete="off" value="' +
            esc((this.coinglass && this.coinglass.get().apiKey) || '') +
            '" placeholder="ключ Coinglass">',
        ),
        field(
          'Диапазон Liq map',
          '<select data-cg="range"><option value="1d">1d</option><option value="7d">7d</option><option value="30d">30d</option></select>',
        ),
        field(
          'Биржа CG',
          '<select data-cg="exchange"><option value="Binance">Binance</option><option value="Bybit">Bybit</option><option value="OKX">OKX</option></select>',
        ),
        field(
          'Мин. Liq $',
          '<input type="number" data-cg="liqMinUsd" value="' +
            ((this.coinglass && this.coinglass.get().liqMinUsd) || 500000) +
            '">',
        ),
        field(
          'Мин. Liquidity $',
          '<input type="number" data-cg="liquidityMinUsd" value="' +
            ((this.coinglass && this.coinglass.get().liquidityMinUsd) || 50000) +
            '">',
        ),
        '<label class="settings-toggle"><span>Liquidity из локального стакана</span><input type="checkbox" data-cg="useLocalBook"' +
          (!(this.coinglass && this.coinglass.get().useLocalBook === false) ? ' checked' : '') +
          '></label>',
        '<button type="button" class="btn ghost" data-act="cg-reload">Обновить Coinglass</button>',
        '<div class="api-actions"><button type="button" class="btn ghost" data-act="reset-chart">Сбросить график</button></div>',
      ].join('')
    } else if (this.tab === 'windows') {
      var L = this.layout ? this.layout.get() : global.Scalp.DEFAULT_LAYOUT
      var presetOpts = Object.keys(global.Scalp.LAYOUT_PRESETS || {})
        .map(function (id) {
          return (
            '<option value="' +
            id +
            '"' +
            (L.preset === id ? ' selected' : '') +
            '>' +
            global.Scalp.LAYOUT_PRESETS[id].label +
            '</option>'
          )
        })
        .join('')
      body = [
        '<div class="settings-section-title">Положение</div>',
        field('Пресет окон', '<select data-l="preset">' + presetOpts + '</select>'),
        '<label class="settings-toggle"><span>Поменять Spot ↔ Futures</span><input type="checkbox" data-l="swapDoms"' +
          (L.swapDoms ? ' checked' : '') +
          '></label>',
        '<div class="settings-section-title">Видимость</div>',
        '<label class="settings-toggle"><span>Боковая панель</span><input type="checkbox" data-l="showRail"' +
          (L.showRail ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>График</span><input type="checkbox" data-l="showChart"' +
          (L.showChart ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>История</span><input type="checkbox" data-l="showHistory"' +
          (L.showHistory ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Стакан Spot</span><input type="checkbox" data-l="showSpot"' +
          (L.showSpot ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Стакан Futures</span><input type="checkbox" data-l="showFutures"' +
          (L.showFutures ? ' checked' : '') +
          '></label>',
        '<div class="settings-section-title">Левая панель</div>',
        '<label class="settings-toggle"><span>Компактный режим</span><input type="checkbox" data-l="railCompact"' +
          (L.railCompact ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Текст описания</span><input type="checkbox" data-l="showRailCopy"' +
          (L.showRailCopy ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Список агентов</span><input type="checkbox" data-l="showRailAgents"' +
          (L.showRailAgents ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Кнопки панели</span><input type="checkbox" data-l="showRailButtons"' +
          (L.showRailButtons ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Кнопка Docs</span><input type="checkbox" data-l="showRailDocs"' +
          (L.showRailDocs ? ' checked' : '') +
          '></label>',
        field(
          'Текст панели',
          '<textarea data-l="railCopy" rows="3">' +
            esc(L.railCopy || '') +
            '</textarea>',
        ),
        '<p class="settings-note">Текст слева скрыт по умолчанию. Кнопка « на панели прячет всю панель; вернуть — плавающая S.</p>',
        '<div class="settings-section-title">Размеры</div>',
        field(
          'Высота графика %',
          '<input type="range" min="15" max="70" data-l="chartHeightPct" value="' +
            L.chartHeightPct +
            '"><span class="range-val" data-lv="chartHeightPct">' +
            L.chartHeightPct +
            '%</span>',
        ),
        field(
          'Ширина Spot %',
          '<input type="range" min="20" max="80" data-l="spotWidthPct" value="' +
            L.spotWidthPct +
            '"><span class="range-val" data-lv="spotWidthPct">' +
            L.spotWidthPct +
            '%</span>',
        ),
        field(
          'Ширина графика (side) %',
          '<input type="range" min="25" max="75" data-l="chartWidthPct" value="' +
            L.chartWidthPct +
            '"><span class="range-val" data-lv="chartWidthPct">' +
            L.chartWidthPct +
            '%</span>',
        ),
        field(
          'Ширина панели px',
          '<input type="range" min="160" max="360" data-l="railWidthPx" value="' +
            L.railWidthPx +
            '"><span class="range-val" data-lv="railWidthPx">' +
            L.railWidthPx +
            'px</span>',
        ),
        '<p class="settings-note">Стаканы всегда рядом (Spot | Futures). Разделитель между ними меняет ширину.</p>',
        '<div class="api-actions">',
        '  <button type="button" class="btn ghost" data-act="swap-doms">Swap Spot/Futures</button>',
        '  <button type="button" class="btn ghost" data-act="reset-layout">Сбросить окна</button>',
        '</div>',
      ].join('')
    } else if (this.tab === 'profile') {
      var uiThemes = C.UI_THEMES || {}
      var uiThemeIds = Object.keys(uiThemes)
      var curUi = profile.uiTheme || 'dark'
      body = [
        field('Имя профиля', '<input data-p="name" value="' + esc(profile.name) + '">'),
        '<p class="settings-note">Тема оформления всего интерфейса (не путать с темой стакана).</p>',
        field(
          'Тема оформления',
          '<select data-p="uiTheme">' +
            uiThemeIds
              .map(function (id) {
                return (
                  '<option value="' +
                  id +
                  '"' +
                  (curUi === id ? ' selected' : '') +
                  '>' +
                  esc(uiThemes[id].label || id) +
                  '</option>'
                )
              })
              .join('') +
            '</select>',
        ),
        '<div class="ui-theme-swatches" data-el="ui-theme-swatches">' +
          uiThemeIds
            .map(function (id) {
              return (
                '<button type="button" class="ui-theme-swatch ui-theme-' +
                id +
                (curUi === id ? ' on' : '') +
                '" data-act="ui-theme" data-theme="' +
                id +
                '" title="' +
                esc(uiThemes[id].label || id) +
                '"><span>' +
                esc(uiThemes[id].label || id) +
                '</span></button>'
              )
            })
            .join('') +
          '</div>',
        '<p class="settings-note">Размер и положение окон — вкладка <strong>Окна</strong>.</p>',
        '<label class="settings-toggle"><span>Автосохранение</span><input type="checkbox" data-p="autosave"' +
          (profile.autosave ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Подтверждать очистку истории</span><input type="checkbox" data-p="confirmClearHistory"' +
          (profile.confirmClearHistory ? ' checked' : '') +
          '></label>',
        field(
          'Вкладка по умолчанию',
          '<select data-p="defaultTab"><option value="tickers">Тикеры</option><option value="windows">Окна</option><option value="chart">График</option><option value="dom">Стакан</option><option value="profile">Профиль</option><option value="history">История</option></select>',
        ),
        '<div class="api-actions"><button type="button" class="btn ghost" data-act="reset-profile">Сбросить профиль</button></div>',
      ].join('')
    } else if (this.tab === 'history') {
      body =
        '<p class="settings-note">Последние тикеры (клик — открыть). Макс. 40 записей.</p>' +
        '<div class="history-list">' +
        (hist.length
          ? hist
              .map(function (it, i) {
                return (
                  '<button type="button" class="history-row" data-hist="' +
                  i +
                  '"><span class="hr-sym">' +
                  String(it.symbol).toUpperCase() +
                  '</span><span class="hr-ex">' +
                  (C.EXCHANGE_PRESETS[it.exchange] ? C.EXCHANGE_PRESETS[it.exchange].label : it.exchange) +
                  '</span><span class="hr-ts">' +
                  new Date(it.ts).toLocaleString() +
                  '</span></button>'
                )
              })
              .join('')
          : '<div class="settings-note">История пуста</div>') +
        '</div>' +
        '<div class="api-actions"><button type="button" class="btn ghost" data-act="clear-history">Очистить историю</button></div>'
    } else if (this.tab === 'dom') {
      body = [
        '<div class="settings-section-title">UI стакана</div>',
        field(
          'Режим панели',
          '<select data-d="domChrome"><option value="full">Полный</option><option value="compact">Компакт</option><option value="minimal">Минимум</option></select>',
        ),
        toggle('Быстрая панель настроек', 'showQuickPanel', !!dom.showQuickPanel),
        '<p class="settings-note">В стакане: ▾ цикл UI · ☰ быстрые · ⚙ все настройки.</p>',
        '<div class="settings-section-title">Отображение</div>',
        toggle('Автопрокрутка', 'autoScroll', dom.autoScroll),
        toggle('Липкий центр (sticky)', 'stickyCenter', dom.stickyCenter !== false),
        toggle('Линейка', 'showRuler', dom.showRuler),
        field(
          'Линейка',
          '<select data-d="rulerMode"><option value="percent">%</option><option value="points">Пункты</option></select>',
        ),
        toggle('Строка спреда', 'showSpreadRow', dom.showSpreadRow !== false),
        toggle('Полосы объёма', 'showVolumeBars', dom.showVolumeBars !== false),
        toggle('MID + imbalance', 'showMidPrice', dom.showMidPrice !== false),
        toggle('Подсветка imbalance', 'showImbalance', dom.showImbalance !== false),
        field('Порог imbalance', num('imbalanceThreshold', dom.imbalanceThreshold || 0.65, 0.5, 0.95, 0.01)),
        toggle('Накопительный объём', 'cumVolumeMode', !!dom.cumVolumeMode),
        toggle('Лоты + $ в строке', 'volumeShowBoth', dom.volumeShowBoth !== false),
        toggle('Группировка тысяч', 'volumeGrouping', dom.volumeGrouping !== false),
        toggle('Авто-знаки объёма', 'volumeDecimalsAuto', dom.volumeDecimalsAuto !== false),
        toggle('Flash клика', 'flashUpdates', dom.flashUpdates !== false),
        toggle('Крупные объёмы', 'highlightLarge', dom.highlightLarge),
        field('Порог крупного (лоты)', num('largeVolumeThreshold', dom.largeVolumeThreshold, 0.1, 9999, 0.1)),
        field('Порог крупного ($)', num('largeNotionalUsd', dom.largeNotionalUsd != null ? dom.largeNotionalUsd : 25000, 1000, 5000000, 1000)),
        field('Мин. объём фильтра', num('filterMinQty', dom.filterMinQty || 0, 0, 99999, 0.001)),
        '<div class="settings-section-title">Цвета по объёму</div>',
        field(
          'Режим цвета',
          '<select data-d="volumeColorMode"><option value="heat">Heat (градиент)</option><option value="heat-row">Heat + строка</option><option value="solid">Solid</option></select>',
        ),
        field(
          'Шкала',
          '<select data-d="volumeHeatScale"><option value="sqrt">√ (мягкая)</option><option value="linear">Линейная</option></select>',
        ),
        toggle('Подсветка стен (wall)', 'wallHighlight', dom.wallHighlight !== false),
        toggle('Бейдж WALL / BIG', 'showWallBadge', dom.showWallBadge !== false),
        field('Порог стены 0–1', num('wallThreshold', dom.wallThreshold != null ? dom.wallThreshold : 0.65, 0.4, 0.98, 0.01)),
        field('Стена от ($)', num('wallNotionalUsd', dom.wallNotionalUsd != null ? dom.wallNotionalUsd : 100000, 5000, 10000000, 1000)),
        field('Интенсивность heat', num('heatBoost', dom.heatBoost != null ? dom.heatBoost : 1.15, 0.8, 2, 0.05)),
        field('Прозрачность баров', num('barOpacity', dom.barOpacity != null ? dom.barOpacity : 0.28, 0.05, 0.9, 0.01)),
        field('Hue Ask (0–360)', num('askBarHue', dom.askBarHue != null ? dom.askBarHue : 350, 0, 360, 1)),
        field('Hue Bid (0–360)', num('bidBarHue', dom.bidBarHue != null ? dom.bidBarHue : 150, 0, 360, 1)),
        '<div class="settings-section-title">Цветовая тема</div>',
        field(
          'Тема',
          '<select data-d="theme">' +
            Object.keys(C.DOM_THEMES || {})
              .map(function (id) {
                return (
                  '<option value="' +
                  id +
                  '"' +
                  (dom.theme === id ? ' selected' : '') +
                  '>' +
                  C.DOM_THEMES[id].label +
                  '</option>'
                )
              })
              .join('') +
            '</select>',
        ),
        '<div class="theme-swatches" data-el="theme-swatches">' +
          Object.keys(C.DOM_THEMES || {})
            .map(function (id) {
              return (
                '<button type="button" class="theme-swatch theme-swatch-' +
                id +
                (dom.theme === id ? ' on' : '') +
                '" data-act="theme" data-theme="' +
                id +
                '" title="' +
                C.DOM_THEMES[id].label +
                '"><i></i><span>' +
                C.DOM_THEMES[id].label +
                '</span></button>'
              )
            })
            .join('') +
          '</div>',
        '<div class="settings-section-title">Тикеры с биржи</div>',
        field(
          'Котировка',
          '<select data-d="quoteFilter"><option value="USDT">USDT</option><option value="USDC">USDC</option><option value="BTC">BTC</option><option value="ETH">ETH</option><option value="ALL">Все</option></select>',
        ),
        field('Макс. в списке', num('maxSymbolOptions', dom.maxSymbolOptions || 400, 50, 2000)),
        '<button type="button" class="btn ghost" data-act="reload-symbols">Обновить тикеры с биржи</button>',
      ].join('')
    } else if (this.tab === 'general') {
      body = [
        field('Множитель шага', num('priceStepMultiplier', dom.priceStepMultiplier, 1, 100)),
        field('Знаков у объёмов', num('volumeDecimals', dom.volumeDecimals, 0, 8)),
        toggle('Авто-знаки объёма', 'volumeDecimalsAuto', dom.volumeDecimalsAuto !== false),
        toggle('Сокращать тысячи (K/M)', 'shortenThousands', !!dom.shortenThousands),
        toggle('Пробелы в тысячах', 'volumeGrouping', dom.volumeGrouping !== false),
        toggle('Лоты + $ вместе', 'volumeShowBoth', dom.volumeShowBoth !== false),
        field('Уровней с стороны', num('levelsPerSide', dom.levelsPerSide, 8, 80)),
        field('Высота строки', num('rowHeight', dom.rowHeight, 16, 40)),
        field('Шрифт', num('fontSize', dom.fontSize, 10, 18)),
      ].join('')
    } else if (this.tab === 'trade') {
      body = [
        '<p class="settings-hint">Кнопки в футере стакана: BUY/SELL MKT и LMT. ЛКМ по стакану = LIMIT · Shift+ЛКМ = MARKET. SL/TP ставятся после входа (Bybit — в ордере, Binance — отдельно). Ключи и «Только просмотр» — Тикеры. Нужен <code>python3 local/serve.py</code>.</p>',
        toggle('Подтверждение ордера (двойной клик)', 'tradeConfirm', !!dom.tradeConfirm),
        toggle('Ставить SL/TP после входа', 'attachSlTp', dom.attachSlTp !== false),
        field('Дальность заброса (тики для LMT)', num('throwDistance', dom.throwDistance, 0, 500)),
        field(
          'Режим SL/TP',
          '<select data-d="pnlMode"><option value="percent">% от цены</option><option value="usdt">USDT от цены</option></select>',
        ),
        field('Stop-Loss (0 = выкл)', num('stopLoss', dom.stopLoss, 0, 99999)),
        field('Take-Profit (0 = выкл)', num('takeProfit', dom.takeProfit, 0, 99999)),
        field('Take-Profit 2 (0 = выкл, полобъёма)', num('takeProfit2', dom.takeProfit2 || 0, 0, 99999)),
        field(
          'Единицы объёма',
          '<select data-d="volumeUnit"><option value="lots">Лоты</option><option value="usd">$</option></select>',
        ),
        field(
          'Слоты объёмов',
          '<input data-d="workVolumes" value="' + esc(dom.workVolumes.join(', ')) + '">',
        ),
      ].join('')
    } else if (this.tab === 'telegram') {
      var tgConn = (this.telegram && this.telegram.get()) || {}
      body = [
        '<p class="settings-hint">Подключение бота. Стратегия RSI+Boll — вкладка <b>RSI+Boll</b>.</p>',
        '<label class="settings-toggle"><span>Включить алерты</span><input type="checkbox" data-tg="enabled"' +
          (tgConn.enabled ? ' checked' : '') +
          '></label>',
        field(
          'Bot Token',
          '<input class="input-wide" type="password" autocomplete="off" data-tg="botToken" value="' +
            esc(tgConn.botToken || '') +
            '" placeholder="123456:ABC...">',
        ),
        field(
          'Chat ID',
          '<input class="input-wide" data-tg="chatId" value="' +
            esc(tgConn.chatId || '') +
            '" placeholder="-100… или ваш id">',
        ),
        field(
          'Cooldown (сек)',
          '<input type="number" min="15" data-tg="cooldownSec" value="' +
            (tgConn.cooldownSec != null ? tgConn.cooldownSec : 1800) +
            '">',
        ),
        '<div class="api-actions">',
        '  <button type="button" class="btn ghost" data-act="tg-test">Тест в Telegram</button>',
        '</div>',
      ].join('')
    } else if (this.tab === 'rsi-boll') {
      var tg = (this.telegram && this.telegram.get()) || {}
      var watch =
        (this.telegram && this.telegram.getWatchlist && this.telegram.getWatchlist()) || []
      var alerts = (this.telegram && this.telegram.getAlerts && this.telegram.getAlerts()) || []
      var selAlert = this._alertId
        ? alerts.filter(function (a) {
            return a.id === self._alertId
          })[0]
        : alerts[0]
      if (selAlert) this._alertId = selAlert.id
      body = [
        '<p class="settings-hint">Сигнал: RSI ≤ порога × N баров <b>и</b> цена у нижней Bollinger (вблизи). Вход: open следующей. В TG: стоп / тейк1.</p>',
        '<label class="settings-toggle"><span>RSI → Telegram</span><input type="checkbox" data-tg="alertRsi"' +
          (tg.alertRsi !== false ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>RSI + нижняя Boll (вблизи)</span><input type="checkbox" data-tg="rsiBollRequired"' +
          (tg.rsiBollRequired !== false ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Watchlist стратегии</span><input type="checkbox" data-tg="rsiStrategyWatch"' +
          (tg.rsiStrategyWatch !== false ? ' checked' : '') +
          '></label>',
        '<label class="settings-toggle"><span>Только ★ избранное</span><input type="checkbox" data-tg="rsiFavsOnly"' +
          (tg.rsiFavsOnly ? ' checked' : '') +
          '></label>',
        field(
          'RSI OS (порог)',
          '<input type="number" min="1" max="50" data-tg="rsiOversold" value="' +
            (tg.rsiOversold != null ? tg.rsiOversold : 27) +
            '">',
        ),
        field(
          'Баров ниже OS (+ Boll)',
          '<input type="number" min="1" max="50" data-tg="rsiSignalBars" value="' +
            (tg.rsiSignalBars != null ? tg.rsiSignalBars : 5) +
            '">',
        ),
        field(
          'Таймфрейм',
          '<select data-tg="rsiInterval">' +
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
            '</select>',
        ),
        field(
          'Вблизи Boll % ширины',
          '<input type="number" step="1" min="5" max="35" data-tg="rsiBollNearPct" value="' +
            (tg.rsiBollNearPct != null ? tg.rsiBollNearPct : 15) +
            '">',
        ),
        field(
          'Стоп % / Тейк1 % / доля %',
          '<span class="settings-inline">' +
            '<input type="number" step="0.1" min="0.3" max="5" data-tg="rsiStopPct" value="' +
            (tg.rsiStopPct != null ? tg.rsiStopPct : 1.2) +
            '" title="стоп"> ' +
            '<input type="number" step="0.1" min="0.3" max="10" data-tg="rsiTakePct" value="' +
            (tg.rsiTakePct != null ? tg.rsiTakePct : 1.6) +
            '" title="тейк1"> ' +
            '<input type="number" step="5" min="10" max="100" data-tg="rsiTakePartialPct" value="' +
            (tg.rsiTakePartialPct != null ? tg.rsiTakePartialPct : 50) +
            '" title="% позиции">' +
            '</span>',
        ),
        field(
          'Poll (сек)',
          '<input type="number" min="45" data-tg="rsiPollSec" value="' +
            (tg.rsiPollSec != null ? tg.rsiPollSec : 90) +
            '">',
        ),
        '<h3 class="settings-subh">Watchlist · ' + watch.length + '</h3>',
        '<div class="settings-note" style="display:flex;flex-wrap:wrap;gap:6px">' +
          (watch.length
            ? watch
                .map(function (s) {
                  return '<code style="font-size:11px">' + esc(s) + '</code>'
                })
                .join(' ')
            : 'пусто') +
          '</div>',
        '<div class="api-actions">',
        '  <button type="button" class="btn ghost" data-act="tg-test">Тест в Telegram</button>',
        '  <button type="button" class="btn ghost" data-act="tg-alerts-clear">Очистить историю</button>',
        '</div>',
        '<h3 class="settings-subh">История сигналов · ' + alerts.length + '</h3>',
        '<div class="alert-hist">' +
          '<div class="alert-hist-list">' +
          (alerts.length
            ? alerts
                .map(function (a) {
                  return (
                    '<button type="button" class="alert-hist-row' +
                    (selAlert && selAlert.id === a.id ? ' active' : '') +
                    '" data-alert-id="' +
                    a.id +
                    '">' +
                    '<span class="ahr-sym">' +
                    esc(a.label || a.symbol) +
                    '</span>' +
                    '<span class="ahr-meta">' +
                    (a.kind === 'rsi_boll' ? 'RSI+Boll' : 'RSI') +
                    ' ≤' +
                    a.oversold +
                    ' · ' +
                    a.bars +
                    'бар · ' +
                    (a.interval || '') +
                    '</span>' +
                    '<span class="ahr-ts">' +
                    new Date(a.ts).toLocaleString() +
                    '</span>' +
                    '<span class="ahr-src">' +
                    (a.source === 'workb' ? 'Workb' : 'poll') +
                    '</span>' +
                    '</button>'
                  )
                })
                .join('')
            : '<div class="settings-note">Пока пусто — ждут RSI+Boll на watchlist</div>') +
          '</div>' +
          '<div class="alert-hist-view">' +
          (selAlert
            ? '<div class="alert-hist-caption">' +
              esc(selAlert.label || selAlert.symbol) +
              ' · ' +
              esc(selAlert.interval || '') +
              (selAlert.rsi != null ? ' · RSI ' + Number(selAlert.rsi).toFixed(1) : '') +
              (selAlert.price != null ? ' · ' + selAlert.price : '') +
              '</div>' +
              '<div class="alert-hist-chart" data-el="alert-chart"></div>' +
              '<div class="api-actions"><button type="button" class="btn primary" data-act="alert-open" data-alert-id="' +
              selAlert.id +
              '">Открыть тикер</button></div>'
            : '<div class="settings-note">Выберите алерт слева</div>') +
          '</div>' +
          '</div>',
      ].join('')
    }

    this.overlay.innerHTML = [
      '<div class="settings-panel settings-wide settings-xl" role="dialog">',
      '  <header class="settings-header"><h2>Настройки · ' +
        esc(profile.name) +
        '</h2>',
      '    <button type="button" class="icon-btn" data-act="close">✕</button></header>',
      '  <nav class="settings-tabs tabs-scroll">',
      tab('tickers', 'Тикеры'),
      tab('windows', 'Окна'),
      tab('chart', 'График'),
      tab('profile', 'Профиль'),
      tab('history', 'История'),
      tab('general', 'Общие'),
      tab('dom', 'Стакан'),
      tab('trade', 'Торговля'),
      tab('telegram', 'Telegram'),
      tab('rsi-boll', 'RSI+Boll'),
      '  </nav>',
      '  <div class="settings-body">' + body + '</div>',
      '  <footer class="settings-footer">',
      '    <button type="button" class="btn ghost" data-act="reset-all">Сбросить всё</button>',
      '    <button type="button" class="btn primary" data-act="close">Готово</button>',
      '  </footer>',
      '</div>',
    ].join('')

    // sync selects
    ;['rulerMode', 'theme', 'pnlMode', 'volumeUnit', 'quoteFilter', 'domChrome', 'volumeColorMode', 'volumeHeatScale'].forEach(function (k) {
      var node = self.overlay.querySelector('[data-d="' + k + '"]')
      if (node && dom[k] != null) node.value = dom[k]
    })
    ;['source', 'interval', 'tool'].forEach(function (k) {
      var node = self.overlay.querySelector('[data-c="' + k + '"]')
      if (node) node.value = chart[k]
    })
    if (self.coinglass) {
      var cg = self.coinglass.get()
      ;['range', 'exchange'].forEach(function (k) {
        var node = self.overlay.querySelector('[data-cg="' + k + '"]')
        if (node && cg[k] != null) node.value = cg[k]
      })
    }
    ;['layout', 'defaultTab', 'uiTheme'].forEach(function (k) {
      var node = self.overlay.querySelector('[data-p="' + k + '"]')
      if (node) node.value = profile[k]
    })
    ;['preset'].forEach(function (k) {
      var node = self.overlay.querySelector('[data-l="' + k + '"]')
      if (node && self.layout) node.value = self.layout.get()[k]
    })
    ;['spot', 'futures'].forEach(function (pane) {
      ;['exchange', 'symbol', 'depthSpeed', 'depthLimit'].forEach(function (key) {
        var node = self.overlay.querySelector(
          '[data-pane="' + pane + '"][data-pk="' + key + '"]',
        )
        if (node) node.value = String(t[pane][key])
      })
    })

    this.overlay.onclick = function (e) {
      if (e.target === self.overlay) self.bus.emit('ui:close-settings')
    }

    this.overlay.querySelector('.settings-panel').onclick = function (e) {
      e.stopPropagation()
      var tbtn = e.target.closest('[data-tab],[data-act],[data-hist],[data-alert-id]')
      if (!tbtn) return
      if (tbtn.getAttribute('data-tab')) {
        self.tab = tbtn.getAttribute('data-tab')
        self.render()
        return
      }
      if (tbtn.getAttribute('data-alert-id') && tbtn.classList.contains('alert-hist-row')) {
        self._alertId = tbtn.getAttribute('data-alert-id')
        self.render()
        return
      }
      if (tbtn.getAttribute('data-hist') != null) {
        var item = hist[Number(tbtn.getAttribute('data-hist'))]
        self.bus.emit('history:open', item)
        self.bus.emit('ui:close-settings')
        return
      }
      var act = tbtn.getAttribute('data-act')
      if (act === 'close') self.bus.emit('ui:close-settings')
      if (act === 'reset-tickers') self.bus.emit('tickers:reset')
      if (act === 'reset-chart') self.bus.emit('chart:reset')
      if (act === 'reset-profile') self.bus.emit('profile:reset')
      if (act === 'clear-history') self.bus.emit('history:clear')
      if (act === 'reload-symbols') {
        var st = self.tickers.get()
        ;['spot', 'futures'].forEach(function (pane) {
          if (self.symbols) {
            self.symbols.forceLoad(st[pane].exchange, st[pane].restBaseUrl)
          }
        })
      }
      if (act === 'theme') {
        var tid = tbtn.getAttribute('data-theme')
        if (tid) self.bus.emit('settings:patch', { theme: tid })
      }
      if (act === 'ui-theme') {
        var uid = tbtn.getAttribute('data-theme')
        if (uid) self.bus.emit('profile:patch', { uiTheme: uid })
      }
      if (act === 'reset-layout') self.bus.emit('layout:reset')
      if (act === 'swap-doms') self.bus.emit('layout:swap-doms')
      if (act === 'cg-reload') self.bus.emit('coinglass:reload')
      if (act === 'tg-test') self.bus.emit('telegram:test')
      if (act === 'tg-alerts-clear') self.bus.emit('telegram:alerts-clear')
      if (act === 'alert-open') {
        var aid = tbtn.getAttribute('data-alert-id')
        var list = (self.telegram && self.telegram.getAlerts && self.telegram.getAlerts()) || []
        var found = list.filter(function (a) {
          return a.id === aid
        })[0]
        if (found) {
          self.bus.emit('tickers:set-symbol', { pane: 'spot', symbol: found.symbol })
          self.bus.emit('tickers:set-symbol', { pane: 'futures', symbol: found.symbol })
          self.bus.emit('ui:set-page', 'workb')
          self.open = false
          self.render()
        }
      }
      if (act === 'test-keys') {
        self.bus.emit('trade:test-keys', { pane: tbtn.getAttribute('data-test-pane') || 'spot' })
      }
      if (act === 'reset-all') {
        self.bus.emit('tickers:reset')
        self.bus.emit('settings:reset')
        self.bus.emit('chart:reset')
        self.bus.emit('profile:reset')
        self.bus.emit('history:clear')
        self.bus.emit('layout:reset')
      }
    }

    var link = this.overlay.querySelector('[data-link]')
    if (link) {
      link.onchange = function () {
        self.bus.emit('tickers:set-link', link.checked)
      }
    }

    this.overlay.querySelectorAll('[data-pane][data-pk]').forEach(function (node) {
      var pane = node.getAttribute('data-pane')
      var key = node.getAttribute('data-pk')
      var apply = function () {
        var val = node.type === 'checkbox' ? node.checked : node.value
        if (key === 'exchange') {
          self.bus.emit('tickers:set-exchange', { pane: pane, exchange: val })
          return
        }
        if (key === 'symbol') {
          self.bus.emit('tickers:set-symbol', { pane: pane, symbol: val })
          return
        }
        if (key === 'testnet') {
          self.bus.emit('tickers:set-exchange', {
            pane: pane,
            exchange: t[pane].exchange,
            testnet: val,
          })
          return
        }
        if (key === 'depthLimit' || key === 'aggSteps') val = Number(val)
        var patch = {}
        patch[key] = val
        self.bus.emit('tickers:patch-pane', { pane: pane, patch: patch })
      }
      node.onchange = apply
      if (node.tagName === 'INPUT' && node.type !== 'checkbox') node.onblur = apply
    })

    this.overlay.querySelectorAll('[data-d]').forEach(function (node) {
      wirePatch(node, 'data-d', function (key, val) {
        if (key === 'workVolumes') {
          val = String(val)
            .split(',')
            .map(function (s) {
              return Number(s.trim())
            })
            .filter(function (n) {
              return n > 0
            })
          if (!val.length) return
        } else if (node.type === 'number') val = Number(val)
        var patch = {}
        patch[key] = val
        self.bus.emit('settings:patch', patch)
        if (key === 'quoteFilter') {
          self.bus.emit('symbols:set-quote', val)
        }
      })
    })

    this.overlay.querySelectorAll('[data-c]').forEach(function (node) {
      wirePatch(node, 'data-c', function (key, val) {
        if (node.type === 'checkbox') val = node.checked
        else if (key === 'limit') val = Number(val)
        if (key.indexOf('ind:') === 0) {
          var ik = key.slice(4)
          var indicators = {}
          indicators[ik] = !!val
          self.bus.emit('chart:patch', { indicators: indicators })
          return
        }
        var patch = {}
        patch[key] = val
        self.bus.emit('chart:patch', patch)
      })
    })

    this.overlay.querySelectorAll('[data-cg]').forEach(function (node) {
      wirePatch(node, 'data-cg', function (key, val) {
        if (node.type === 'checkbox') val = node.checked
        else if (key === 'liqMinUsd' || key === 'liquidityMinUsd' || key === 'liqTopN' || key === 'liquidityTopN') {
          val = Number(val)
        }
        var patch = {}
        patch[key] = val
        self.bus.emit('coinglass:patch', patch)
      })
    })

    this.overlay.querySelectorAll('[data-tg]').forEach(function (node) {
      wirePatch(node, 'data-tg', function (key, val) {
        if (node.type === 'checkbox') val = node.checked
        else if (
          key === 'minWallUsd' ||
          key === 'minTradeUsd' ||
          key === 'watchTopN' ||
          key === 'cooldownSec' ||
          key === 'rsiOversold' ||
          key === 'rsiSignalBars' ||
          key === 'rsiPollSec' ||
          key === 'rsiStopPct' ||
          key === 'rsiTakePct' ||
          key === 'rsiTakePartialPct' ||
          key === 'rsiBollNearPct'
        ) {
          val = Number(val)
        }
        var patch = {}
        patch[key] = val
        self.bus.emit('telegram:patch', patch)
      })
    })

    if (self.tab === 'telegram' || self.tab === 'rsi-boll') {
      requestAnimationFrame(function () {
        self._mountAlertChart()
      })
    }

    this.overlay.querySelectorAll('[data-p]').forEach(function (node) {
      wirePatch(node, 'data-p', function (key, val) {
        if (node.type === 'checkbox') val = node.checked
        var patch = {}
        patch[key] = val
        self.bus.emit('profile:patch', patch)
      })
    })

    this.overlay.querySelectorAll('[data-l]').forEach(function (node) {
      var apply = function () {
        var key = node.getAttribute('data-l')
        var val = node.type === 'checkbox' ? node.checked : node.value
        if (node.type === 'range') val = Number(val)
        if (key === 'preset') {
          self.bus.emit('layout:preset', val)
          return
        }
        var patch = {}
        patch[key] = val
        self.bus.emit('layout:patch', patch)
        var label = self.overlay.querySelector('[data-lv="' + key + '"]')
        if (label) {
          label.textContent = key === 'railWidthPx' ? val + 'px' : val + '%'
        }
      }
      node.oninput = node.type === 'range' || node.tagName === 'TEXTAREA' ? apply : null
      node.onchange = apply
    })

    this.overlay.querySelectorAll('[data-sym-search]').forEach(function (node) {
      var pane = node.getAttribute('data-sym-search')
      var timer = 0
      node.oninput = function () {
        clearTimeout(timer)
        timer = setTimeout(function () {
          var q = node.value
          var cfg = self.tickers.getPane(pane)
          var quote = self.settings.state.quoteFilter || 'USDT'
          var list = self.symbols
            ? self.symbols.getList(cfg.exchange, { quote: quote, search: q }).slice(
                0,
                self.settings.state.maxSymbolOptions || 400,
              )
            : []
          var sel = self.overlay.querySelector('[data-pane="' + pane + '"][data-pk="symbol"]')
          if (!sel) return
          sel.innerHTML = list
            .map(function (s) {
              return '<option value="' + s.id + '">' + s.label + '</option>'
            })
            .join('')
        }, 120)
      }
    })

    function wirePatch(node, attr, fn) {
      var key = node.getAttribute(attr)
      var apply = function () {
        var val = node.type === 'checkbox' ? node.checked : node.value
        fn(key, val)
      }
      node.onchange = apply
      if (node.tagName === 'INPUT' && node.type !== 'checkbox') node.onblur = apply
    }

    function tab(id, label) {
      return (
        '<button type="button" class="' +
        (self.tab === id ? 'active' : '') +
        '" data-tab="' +
        id +
        '">' +
        label +
        '</button>'
      )
    }
    function field(label, control) {
      return '<label class="settings-field"><span>' + label + '</span>' + control + '</label>'
    }
    function toggle(label, key, checked) {
      return (
        '<label class="settings-toggle"><span>' +
        label +
        '</span><input type="checkbox" data-d="' +
        key +
        '"' +
        (checked ? ' checked' : '') +
        '></label>'
      )
    }
    function toggleC(label, key, checked) {
      return (
        '<label class="settings-toggle"><span>' +
        label +
        '</span><input type="checkbox" data-c="ind:' +
        key +
        '"' +
        (checked ? ' checked' : '') +
        '></label>'
      )
    }
    function num(key, value, min, max, step) {
      return (
        '<input type="number" data-d="' +
        key +
        '" value="' +
        value +
        '"' +
        (min != null ? ' min="' + min + '"' : '') +
        (max != null ? ' max="' + max + '"' : '') +
        (step != null ? ' step="' + step + '"' : '') +
        '>'
      )
    }
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
    }
    function paneBlock(pane, title, cfg, Conf) {
      var market = pane === 'futures' ? 'futures' : 'spot'
      var exOpts = Conf.exchangesForMarket(market)
        .map(function (id) {
          return (
            '<option value="' +
            id +
            '">' +
            Conf.EXCHANGE_PRESETS[id].label +
            '</option>'
          )
        })
        .join('')
      var quote = self.settings.state.quoteFilter || 'USDT'
      var symList = self.symbols
        ? self.symbols.getList(cfg.exchange, { quote: quote, search: '' }).slice(0, self.settings.state.maxSymbolOptions || 400)
        : Conf.SYMBOLS
      var hasCur = symList.some(function (s) {
        return s.id === cfg.symbol
      })
      if (!hasCur && cfg.symbol) {
        var curMeta = self.symbols
          ? self.symbols.find(cfg.exchange, cfg.symbol)
          : { id: cfg.symbol, label: String(cfg.symbol).toUpperCase() }
        symList = [curMeta].concat(symList)
      }
      var symStatus = self.symbols ? self.symbols.status[cfg.exchange] : ''
      var symTotal = self.symbols && self.symbols.cache[cfg.exchange]
        ? self.symbols.cache[cfg.exchange].length
        : symList.length
      var symOpts = symList
        .map(function (s) {
          return '<option value="' + s.id + '">' + s.label + '</option>'
        })
        .join('')
      return [
        '<div class="pane-card' + (self.focusPane === pane ? ' focus' : '') + '">',
        '  <div class="settings-section-title">' +
          title +
          ' <span class="sym-count">' +
          (symStatus === 'loading' ? 'загрузка…' : symList.length + '/' + symTotal) +
          '</span></div>',
        field('Биржа', '<select data-pane="' + pane + '" data-pk="exchange">' + exOpts + '</select>'),
        field(
          'Поиск тикера',
          '<input class="input-wide" data-sym-search="' +
            pane +
            '" placeholder="btc, eth, pepe…" value="">',
        ),
        field('Тикер', '<select data-pane="' + pane + '" data-pk="symbol">' + symOpts + '</select>'),
        '<label class="settings-toggle"><span>Testnet</span><input type="checkbox" data-pane="' +
          pane +
          '" data-pk="testnet"' +
          (cfg.testnet ? ' checked' : '') +
          '></label>',
        field(
          'REST URL',
          '<input class="input-wide" data-pane="' +
            pane +
            '" data-pk="restBaseUrl" value="' +
            esc(cfg.restBaseUrl) +
            '">',
        ),
        field(
          'WS URL',
          '<input class="input-wide" data-pane="' +
            pane +
            '" data-pk="wsBaseUrl" value="' +
            esc(cfg.wsBaseUrl) +
            '">',
        ),
        field(
          'Depth',
          '<select data-pane="' +
            pane +
            '" data-pk="depthLimit"><option value="100">100</option><option value="500">500</option><option value="1000">1000</option></select>',
        ),
        field(
          'WS speed',
          '<select data-pane="' +
            pane +
            '" data-pk="depthSpeed"><option value="100ms">100 ms</option><option value="1000ms">1000 ms</option></select>',
        ),
        field(
          'Сжатие',
          '<input type="number" min="1" data-pane="' +
            pane +
            '" data-pk="aggSteps" value="' +
            (cfg.aggSteps || 1) +
            '">',
        ),
        '<div class="settings-section-title">API · торговля</div>',
        '<label class="settings-toggle"><span>Только просмотр (без ордеров)</span><input type="checkbox" data-pane="' +
          pane +
          '" data-pk="viewOnly"' +
          (cfg.viewOnly !== false ? ' checked' : '') +
          '></label>',
        field(
          'API Key',
          '<input class="input-wide" type="password" autocomplete="off" data-pane="' +
            pane +
            '" data-pk="apiKey" value="' +
            esc(cfg.apiKey || '') +
            '" placeholder="ключ биржи">',
        ),
        field(
          'API Secret',
          '<input class="input-wide" type="password" autocomplete="off" data-pane="' +
            pane +
            '" data-pk="apiSecret" value="' +
            esc(cfg.apiSecret || '') +
            '" placeholder="секрет">',
        ),
        '<div class="api-actions"><button type="button" class="btn ghost" data-act="test-keys" data-test-pane="' +
          pane +
          '">Проверить ключи</button></div>',
        '</div>',
      ].join('')
    }
  }

  SettingsUiAgent.prototype._mountAlertChart = function () {
    var host = this.overlay && this.overlay.querySelector('[data-el="alert-chart"]')
    if (!host) return
    var alerts = (this.telegram && this.telegram.getAlerts && this.telegram.getAlerts()) || []
    var alert =
      alerts.filter(
        function (a) {
          return a.id === this._alertId
        }.bind(this),
      )[0] || alerts[0]
    if (!alert || !alert.candles || !alert.candles.length) {
      host.innerHTML = '<div class="settings-note">Нет свечей в снимке</div>'
      return
    }
    if (this._alertChart) {
      try {
        this._alertChart.remove()
      } catch (e) {}
      this._alertChart = null
    }
    host.innerHTML = ''
    var LW = global.LightweightCharts
    if (!LW || !LW.createChart) {
      host.innerHTML = '<div class="settings-note">Lightweight Charts не загружен</div>'
      return
    }
    var chart = LW.createChart(host, {
      layout: {
        background: { color: 'transparent' },
        textColor: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#8b9bb0',
      },
      grid: {
        vertLines: { color: 'rgba(42,53,68,0.35)' },
        horzLines: { color: 'rgba(42,53,68,0.35)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      width: host.clientWidth || 420,
      height: 220,
    })
    var series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    var data = alert.candles
      .map(function (c) {
        var t = Number(c.time)
        if (t > 1e12) t = Math.floor(t / 1000)
        return {
          time: t,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }
      })
      .filter(function (c) {
        return c.time > 0 && isFinite(c.close)
      })
    series.setData(data)
    try {
      var last = data[data.length - 1]
      if (last) {
        series.setMarkers([
          {
            time: last.time,
            position: 'belowBar',
            color: '#26a69a',
            shape: 'arrowUp',
            text: 'RSI≤' + (alert.oversold != null ? alert.oversold : 28),
          },
        ])
      }
    } catch (e) {}
    chart.timeScale().fitContent()
    this._alertChart = chart
  }

  SettingsUiAgent.prototype.start = function () {}

  global.Scalp.SettingsUiAgent = SettingsUiAgent
})(typeof window !== 'undefined' ? window : globalThis)
