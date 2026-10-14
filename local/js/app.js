/* Bootstrap — chart + dual DOM + profile + history + layout + exchange symbols */
(function (global) {
  'use strict'

  function createPane(globalBus, tickers, settings, symbols, paneId, root) {
    var paneBus = new global.Scalp.PaneBus(globalBus, paneId)
    var api = tickers.asApi(paneId)
    var paneSettings = tickers.asSettings(paneId, settings, symbols)
    var market = new global.Scalp.MarketAgent(paneBus, api, paneSettings)
    var dom = new global.Scalp.DomAgent(
      paneBus,
      globalBus,
      root,
      api,
      paneSettings,
      paneId,
      symbols,
    )
    return { paneBus: paneBus, api: api, market: market, dom: dom }
  }

  function boot() {
    var bus = new global.Scalp.Bus()
    var tickers = new global.Scalp.TickersAgent(bus)
    var settings = new global.Scalp.SettingsAgent(bus)
    var profile = new global.Scalp.ProfileAgent(bus)
    var history = new global.Scalp.HistoryAgent(bus, tickers)
    var symbols = new global.Scalp.SymbolsAgent(bus)
    var screener = new global.Scalp.ScreenerAgent(bus, tickers, symbols)
    var top25 = new global.Scalp.Top25Agent(bus, tickers, screener)
    var atr30 = new global.Scalp.Atr30Agent(bus, tickers, screener, top25)
    var coinglass = new global.Scalp.CoinglassAgent(bus, tickers)
    var layout = new global.Scalp.LayoutAgent(bus)
    var trade = new global.Scalp.TradeAgent(bus, tickers, settings, symbols)
    var telegram = new global.Scalp.TelegramAlertAgent(bus, tickers, settings, symbols, screener)

    // sync quote filter from DOM settings
    if (settings.state.quoteFilter) {
      symbols.quoteFilter = settings.state.quoteFilter
    }

    var spot = createPane(
      bus,
      tickers,
      settings,
      symbols,
      'spot',
      document.getElementById('dom-spot'),
    )
    var futures = createPane(
      bus,
      tickers,
      settings,
      symbols,
      'futures',
      document.getElementById('dom-futures'),
    )

    var chart = new global.Scalp.ChartAgent(bus, tickers, document.getElementById('chart-root'))
    var historyBar = new global.Scalp.HistoryBarAgent(
      bus,
      history,
      profile,
      document.getElementById('history-bar'),
    )
    var layoutUi = new global.Scalp.LayoutUi(bus, document.querySelector('.app-shell'))
    var screenerUi = new global.Scalp.ScreenerUiAgent(
      bus,
      screener,
      document.getElementById('screener-root'),
    )
    var symbolTags = new global.Scalp.SymbolTagAgent(bus, symbols)
    var userMarkers = new global.Scalp.UserMarkersAgent(bus)
    var top25Ui = new global.Scalp.Top25UiAgent(
      bus,
      top25,
      document.getElementById('top25-root'),
      tickers,
      symbolTags,
      userMarkers,
      screener,
    )
    var atr30Ui = new global.Scalp.Atr30UiAgent(bus, atr30, document.getElementById('atr30-root'))
    var vizUi = new global.Scalp.VisualizerUiAgent(
      bus,
      tickers,
      screener,
      document.getElementById('viz-root'),
    )
    var workbUi = new global.Scalp.WorkbUiAgent(
      bus,
      tickers,
      screener,
      symbolTags,
      userMarkers,
      document.getElementById('workb-root'),
      symbols,
    )
    var learnUi = new global.Scalp.LearnScalpUiAgent(bus, document.getElementById('learn-root'))
    var rsiBollUi = new global.Scalp.RsiBollUiAgent(
      bus,
      telegram,
      tickers,
      document.getElementById('rsi-boll-root'),
    )
    var smcFlowUi = new global.Scalp.SmcFlowUiAgent(
      bus,
      tickers,
      document.getElementById('smc-flow-root'),
    )
    var ui = new global.Scalp.SettingsUiAgent(
      bus,
      tickers,
      settings,
      chart,
      profile,
      history,
      symbols,
      layout,
      screener,
      coinglass,
      telegram,
    )

    global.Scalp.runtime = {
      bus: bus,
      tickers: tickers,
      settings: settings,
      profile: profile,
      history: history,
      symbols: symbols,
      screener: screener,
      top25: top25,
      atr30: atr30,
      coinglass: coinglass,
      telegram: telegram,
      layout: layout,
      trade: trade,
      chart: chart,
      vizUi: vizUi,
      workbUi: workbUi,
      rsiBollUi: rsiBollUi,
      smcFlowUi: smcFlowUi,
      symbolTags: symbolTags,
      userMarkers: userMarkers,
      spot: spot,
      futures: futures,
      ui: ui,
      layoutUi: layoutUi,
    }

    bus.on('telegram:toast', function (payload) {
      if (trade && trade._toast) trade._toast(!!payload.ok, payload.message || '')
    })

    bus.on('profile:changed', function (p) {
      var nameEl = document.querySelector('[data-el="profile-name"]')
      if (nameEl) nameEl.textContent = p.name || 'Profile'
    })

    // keep profile.showChart in sync with layout (history bar uses profile)
    bus.on('layout:changed', function (L) {
      var p = profile.get()
      if (p.showChart !== L.showChart || p.showHistoryBar !== L.showHistory) {
        profile.patch({ showChart: L.showChart, showHistoryBar: L.showHistory })
      }
    })

    symbols.start()
    tickers.start()
    settings.start()
    profile.start()
    history.start()
    historyBar.start()
    layoutUi.start()
    layout.start()
    screener.start()
    screenerUi.start()
    top25.start()
    top25Ui.start()
    atr30.start()
    atr30Ui.start()
    vizUi.start()
    symbolTags.start()
    userMarkers.start()
    workbUi.start()
    learnUi.start()
    coinglass.start()
    trade.start()
    chart.start()
    try {
      telegram.start()
    } catch (e) {
      console.error('[telegram]', e)
    }
    spot.dom.start()
    futures.dom.start()
    ui.start()
    spot.market.start()
    futures.market.start()

    // pull full symbol lists for all available exchanges
    symbols.forceLoadAll()

    var nameEl = document.querySelector('[data-el="profile-name"]')
    if (nameEl) nameEl.textContent = profile.get().name || 'Profile'

    var btn = document.getElementById('btn-api')
    if (btn) {
      btn.onclick = function () {
        bus.emit('ui:open-settings', { tab: profile.get().defaultTab || 'tickers' })
      }
    }
    var btnChart = document.getElementById('btn-chart')
    if (btnChart) {
      btnChart.onclick = function () {
        bus.emit('ui:open-settings', { tab: 'chart' })
      }
    }
    var btnWin = document.getElementById('btn-windows')
    if (btnWin) {
      btnWin.onclick = function () {
        bus.emit('ui:open-settings', { tab: 'windows' })
      }
    }
    var btnScr = document.getElementById('btn-screener')
    if (btnScr) {
      btnScr.onclick = function () {
        bus.emit('ui:set-page', 'screener')
      }
    }
    var btnTop25 = document.getElementById('btn-top25')
    if (btnTop25) {
      btnTop25.onclick = function () {
        bus.emit('ui:set-page', 'top25')
      }
    }
    var btnAtr30 = document.getElementById('btn-atr30')
    if (btnAtr30) {
      btnAtr30.onclick = function () {
        bus.emit('ui:set-page', 'atr30')
      }
    }
    var btnViz = document.getElementById('btn-visualizer')
    if (btnViz) {
      btnViz.onclick = function () {
        bus.emit('ui:set-page', 'visualizer')
      }
    }
    var btnWorkb = document.getElementById('btn-workb')
    if (btnWorkb) {
      btnWorkb.onclick = function () {
        bus.emit('ui:set-page', 'workb')
      }
    }
    var btnRsiBoll = document.getElementById('btn-rsi-boll')
    if (btnRsiBoll) {
      btnRsiBoll.onclick = function () {
        bus.emit('ui:set-page', 'rsi-boll')
      }
    }
    var btnSmcFlow = document.getElementById('btn-smc-flow')
    if (btnSmcFlow) {
      btnSmcFlow.onclick = function () {
        bus.emit('ui:set-page', 'smc-flow')
      }
    }
    var btnLearn = document.getElementById('btn-learn')
    if (btnLearn) {
      btnLearn.onclick = function () {
        bus.emit('ui:set-page', 'learn')
      }
    }
    var btnHideRail = document.getElementById('btn-hide-rail')
    if (btnHideRail) {
      btnHideRail.onclick = function () {
        bus.emit('layout:patch', { showRail: false })
      }
    }
    var btnShowRail = document.getElementById('btn-show-rail')
    if (btnShowRail) {
      btnShowRail.onclick = function () {
        bus.emit('layout:patch', { showRail: true })
        bus.emit('ui:open-settings', { tab: 'windows' })
      }
      btnShowRail.oncontextmenu = function (e) {
        e.preventDefault()
        bus.emit('layout:patch', { showRail: true })
      }
    }
    var docs = document.getElementById('btn-docs')
    if (docs) docs.href = '../docs/index.html'
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})(typeof window !== 'undefined' ? window : globalThis)
