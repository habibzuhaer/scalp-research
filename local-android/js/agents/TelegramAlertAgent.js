/* TelegramAlertAgent — стенки / крупные сделки / RSI + история алертов */
(function (global) {
  'use strict'

  var PROXY = '/ex/forward'
  var HISTORY_KEY = 'scalp-alert-history-v1'
  var EPISODE_KEY = 'scalp-rsi-episodes-v1'
  var HISTORY_MAX = 60
  var CANDLES_KEEP = 80

  /** 15m RSI+Boll −1.2% — тикеры из прогона (PEPE в приоритете) */
  var RSI_BOLL_15M_SYMBOLS = [
    '1000pepeusdt',
    'dogeusdt',
    'ongusdt',
    'bmtusdt',
    'agiusdt',
    'avaxusdt',
    'arbusdt',
    'btrusdt',
    'solusdt',
    'wifusdt',
    'opusdt',
    'btwusdt',
    'tutusdt',
    'portalusdt',
    'beatusdt',
    'hanausdt',
    'nesausdt',
    'velvetusdt',
    'tacusdt',
    'cashcatusdt',
  ]

  var DEFAULTS = {
    enabled: true,
    botToken: '',
    chatId: '',
    minWallUsd: 150000,
    minTradeUsd: 75000,
    alertWalls: false,
    alertTrades: false,
    alertRsi: true,
    rsiOversold: 27,
    rsiSignalBars: 5,
    rsiInterval: '15m',
    rsiPollSec: 90,
    rsiFavsOnly: false,
    rsiBollRequired: true,
    rsiBollNearPct: 15,
    rsiStopPct: 1.2,
    rsiTakePct: 1.6,
    rsiTakePartialPct: 50,
    rsiStrategyWatch: true,
    watchTopN: 25,
    cooldownSec: 1800,
    market: 'both', // spot | futures | both
  }

  function loadEpisodes() {
    try {
      var raw = localStorage.getItem(EPISODE_KEY)
      var o = raw ? JSON.parse(raw) : {}
      return o && typeof o === 'object' ? o : {}
    } catch (e) {
      return {}
    }
  }

  function TelegramAlertAgent(bus, tickers, settings, symbols, screener) {
    this.bus = bus
    this.tickers = tickers
    this.settings = settings
    this.symbols = symbols || null
    this.screener = screener || null
    this.state = global.Scalp.Config.load(global.Scalp.Config.KEYS.telegram, DEFAULTS)
    if (this.state.alertRsi == null) this.state.alertRsi = true
    if (this.state.rsiOversold == null) this.state.rsiOversold = 27
    if (this.state.rsiSignalBars == null) this.state.rsiSignalBars = 5
    if (!this.state.rsiInterval) this.state.rsiInterval = '15m'
    if (this.state.rsiPollSec == null) this.state.rsiPollSec = 90
    if (this.state.rsiFavsOnly == null) this.state.rsiFavsOnly = false
    if (this.state.rsiBollRequired == null) this.state.rsiBollRequired = true
    if (this.state.rsiBollNearPct == null) this.state.rsiBollNearPct = 15
    if (this.state.rsiStopPct == null) this.state.rsiStopPct = 1.2
    if (this.state.rsiTakePct == null) this.state.rsiTakePct = 1.6
    if (this.state.rsiTakePartialPct == null) this.state.rsiTakePartialPct = 50
    if (this.state.rsiStrategyWatch == null) this.state.rsiStrategyWatch = true
    // Только RSI: стенки/сделки всегда выкл (токен/chat не трогаем).
    this.state.alertWalls = false
    this.state.alertTrades = false
    this.state.alertRsi = true
    this.state.enabled = true
    this._hardMute = false
    try {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.telegram, this.state)
    } catch (e) {}
    this._wallsSeen = Object.create(null)
    this._tradeCd = Object.create(null)
    this._wallCd = Object.create(null)
    this._rsiCd = Object.create(null)
    this._rsiPrevStreak = Object.create(null)
    this._rsiWarm = Object.create(null)
    this._rsiEpisodes = loadEpisodes()
    this._ws = null
    this._watch = []
    this._poll = 0
    this._rsiTimer = 0
    this._rsiCursor = 0
    this._rsiBusy = false
    this.alertHistory = loadHistory()
    this._bind()
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY)
      var arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? arr : []
    } catch (e) {
      return []
    }
  }

  function trimCandles(candles) {
    if (!candles || !candles.length) return []
    var slice = candles.slice(-CANDLES_KEEP)
    return slice.map(function (c) {
      return {
        time: Number(c.time) || Number(c.t) || 0,
        open: Number(c.open != null ? c.open : c.o),
        high: Number(c.high != null ? c.high : c.h),
        low: Number(c.low != null ? c.low : c.l),
        close: Number(c.close != null ? c.close : c.c),
      }
    })
  }

  TelegramAlertAgent.prototype._bind = function () {
    var self = this
    this.bus.on('telegram:get', function () {
      self.bus.emit('telegram:state', self.get())
    })
    this.bus.on('telegram:patch', function (partial) {
      self.patch(partial)
    })
    this.bus.on('telegram:test', function () {
      self.test()
    })
    this.bus.on('telegram:alerts-get', function () {
      self.bus.emit('telegram:alerts', self.getAlerts())
    })
    this.bus.on('telegram:alerts-clear', function () {
      self.clearAlerts()
    })
    this.bus.on('alert:rsi', function (payload) {
      self._handleRsiAlert(payload || {})
    })
    this.bus.on('spot:market:book', function (book) {
      self._onBook('spot', book)
    })
    this.bus.on('futures:market:book', function (book) {
      self._onBook('futures', book)
    })
    this.bus.on('tickers:changed', function () {
      self._refreshWatch()
    })
    this.bus.on('screener:changed', function () {
      self._refreshWatch()
    })
  }

  TelegramAlertAgent.prototype.get = function () {
    return Object.assign({}, this.state)
  }

  TelegramAlertAgent.prototype.getWatchlist = function () {
    return RSI_BOLL_15M_SYMBOLS.map(function (s) {
      return String(s).toUpperCase()
    })
  }

  TelegramAlertAgent.prototype.getAlerts = function () {
    return this.alertHistory.slice()
  }

  TelegramAlertAgent.prototype.clearAlerts = function () {
    this.alertHistory = []
    try {
      localStorage.setItem(HISTORY_KEY, '[]')
    } catch (e) {}
    this.bus.emit('telegram:alerts', this.getAlerts())
  }

  TelegramAlertAgent.prototype._saveAlerts = function () {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.alertHistory))
    } catch (e) {
      // drop oldest candles if quota
      try {
        this.alertHistory = this.alertHistory.map(function (a, i) {
          if (i > 15) return Object.assign({}, a, { candles: (a.candles || []).slice(-30) })
          return a
        })
        localStorage.setItem(HISTORY_KEY, JSON.stringify(this.alertHistory))
      } catch (err) {}
    }
    this.bus.emit('telegram:alerts', this.getAlerts())
  }

  TelegramAlertAgent.prototype.pushAlert = function (entry) {
    if (!entry || !entry.symbol) return null
    var item = {
      id: entry.id || 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      kind: entry.kind || 'rsi',
      symbol: String(entry.symbol).toLowerCase(),
      label: String(entry.label || entry.symbol).toUpperCase(),
      interval: entry.interval || this.state.rsiInterval || '5m',
      source: entry.source || 'poll',
      oversold: entry.oversold != null ? entry.oversold : Number(this.state.rsiOversold) || 28,
      bars: Number(entry.bars) || 0,
      rsi: entry.rsi != null ? Number(entry.rsi) : null,
      price: entry.price != null ? Number(entry.price) : null,
      ts: entry.ts || Date.now(),
      candles: trimCandles(entry.candles),
    }
    this.alertHistory.unshift(item)
    if (this.alertHistory.length > HISTORY_MAX) this.alertHistory = this.alertHistory.slice(0, HISTORY_MAX)
    this._saveAlerts()
    return item
  }

  TelegramAlertAgent.prototype.patch = function (partial) {
    this.state = Object.assign({}, this.state, partial || {})
    // режим «только RSI» — стены/сделки нельзя включить через UI
    this.state.alertWalls = false
    this.state.alertTrades = false
    if (partial && partial.enabled === true) {
      this._hardMute = false
      if (partial.alertRsi !== false) this.state.alertRsi = true
    }
    if (partial && partial.enabled === false) {
      this._hardMute = true
      this._stopAll()
    }
    global.Scalp.Config.save(global.Scalp.Config.KEYS.telegram, this.state)
    this.bus.emit('telegram:changed', this.get())
    this._refreshWatch()
    this._armRsiPoll()
  }

  TelegramAlertAgent.prototype._stopAll = function () {
    this._closeWs()
    if (this._rsiTimer) {
      clearInterval(this._rsiTimer)
      this._rsiTimer = 0
    }
    if (this._poll) {
      clearInterval(this._poll)
      this._poll = 0
    }
  }

  TelegramAlertAgent.prototype._usd = function (n) {
    if (!(n > 0)) return '$0'
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
    return '$' + Math.round(n)
  }

  TelegramAlertAgent.prototype._canSend = function (key, map) {
    var cd = Math.max(15, Number(this.state.cooldownSec) || 90) * 1000
    var now = Date.now()
    if (map[key] && now - map[key] < cd) return false
    map[key] = now
    return true
  }

  TelegramAlertAgent.prototype._send = async function (text, opts) {
    opts = opts || {}
    if ((this._hardMute || !this.state.enabled) && !opts.forceTest) {
      return { ok: false, muted: true }
    }
    var token = String(this.state.botToken || '').trim()
    var chat = String(this.state.chatId || '').trim()
    if (!token || !chat) throw new Error('Укажите Bot Token и Chat ID')
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage'
    var body = JSON.stringify({
      chat_id: chat,
      text: text,
      disable_web_page_preview: true,
    })
    var res = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      }),
    })
    var data = await res.json().catch(function () {
      return {}
    })
    if (!res.ok || data.ok === false) {
      throw new Error((data && data.description) || data.msg || 'Telegram HTTP ' + res.status)
    }
    return data
  }

  TelegramAlertAgent.prototype.test = async function () {
    try {
      await this._send('sCalp · тест алерта ✅', { forceTest: true })
      this.bus.emit('telegram:toast', { ok: true, message: 'Telegram: тест отправлен' })
    } catch (e) {
      this.bus.emit('telegram:toast', { ok: false, message: e.message || 'Ошибка Telegram' })
    }
  }

  TelegramAlertAgent.prototype._onBook = function (pane, book) {
    if (!this.state.enabled || !this.state.alertWalls) return
    var cfg = this.tickers.getPane(pane)
    var sym = String(cfg.symbol || '').toUpperCase()
    var minUsd = Number(this.state.minWallUsd) || 150000
    var sides = [
      { name: 'BID', levels: book.bids || [] },
      { name: 'ASK', levels: book.asks || [] },
    ]
    var self = this
    sides.forEach(function (side) {
      for (var i = 0; i < Math.min(40, side.levels.length); i++) {
        var lv = side.levels[i]
        var usd = Number(lv.price) * Number(lv.qty)
        if (!(usd >= minUsd)) continue
        var key = pane + '|' + sym + '|' + side.name + '|' + Number(lv.price).toFixed(8)
        var prev = self._wallsSeen[key] || 0
        if (prev > 0 && usd < prev * 1.25) continue
        self._wallsSeen[key] = usd
        if (!self._canSend(key, self._wallCd)) continue
        var emoji = side.name === 'BID' ? '🟢' : '🔴'
        self
          ._send(
            emoji +
              ' WALL ' +
              pane.toUpperCase() +
              ' ' +
              sym +
              '\n' +
              side.name +
              ' @ ' +
              lv.price +
              '\n' +
              'Size ' +
              self._usd(usd) +
              ' · qty ' +
              lv.qty,
          )
          .catch(function () {})
      }
    })
  }

  TelegramAlertAgent.prototype._episodeKey = function (sym, interval) {
    return String(sym).toLowerCase() + '|' + (interval || '5m')
  }

  TelegramAlertAgent.prototype._saveEpisodes = function () {
    try {
      localStorage.setItem(EPISODE_KEY, JSON.stringify(this._rsiEpisodes))
    } catch (e) {}
  }

  TelegramAlertAgent.prototype._handleRsiAlert = function (payload) {
    if (!this.state.enabled || this.state.alertRsi === false) return
    var sym = String(payload.symbol || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (!sym) return
    var interval = payload.interval || this.state.rsiInterval || '5m'
    var tgOs = Number(this.state.rsiOversold) || 28
    var need = Math.max(1, Number(this.state.rsiSignalBars) || 5)
    var bars = Number(payload.bars) || 0
    if (bars < need && payload.force !== true) return
    if (payload.rsi != null && isFinite(Number(payload.rsi)) && Number(payload.rsi) > tgOs) return

    // только избранное (если включено)
    if (this.state.rsiFavsOnly !== false && payload.force !== true) {
      var isFav = false
      try {
        isFav =
          (this.screener && this.screener.isFav && this.screener.isFav(sym)) ||
          (this.screener && this.screener.getMark && this.screener.getMark(sym))
      } catch (e) {}
      if (!isFav) return
    }

    var ep = this._episodeKey(sym, interval)
    // один алерт на заход в OS; повтор только после выхода (streak сброшен снаружи)
    if (this._rsiEpisodes[ep] && payload.force !== true) return

    var key = 'rsi|' + sym + '|' + interval
    if (!this._canSend(key, this._rsiCd)) return

    this._rsiEpisodes[ep] = { ts: Date.now(), bars: bars }
    this._saveEpisodes()

    var oversold = tgOs
    var item = this.pushAlert({
      kind: this.state.rsiBollRequired !== false ? 'rsi_boll' : 'rsi',
      symbol: sym,
      label: payload.label || sym.toUpperCase(),
      interval: interval,
      source: payload.source || 'workb',
      oversold: oversold,
      bars: bars,
      rsi: payload.rsi,
      price: payload.price,
      candles: payload.candles,
      ts: payload.ts || Date.now(),
    })

    var text
    if (this.state.rsiBollRequired !== false) {
      text = this._buildRsiBollMessage(
        Object.assign({}, payload, {
          oversold: oversold,
          bars: bars,
          interval: interval,
        }),
      )
    } else {
      text =
        '📉 RSI ≤' +
        oversold +
        ' · ' +
        bars +
        '+ баров\n' +
        String(sym).toUpperCase() +
        ' · ' +
        interval +
        (payload.rsi != null ? '\nRSI ' + Number(payload.rsi).toFixed(1) : '') +
        (payload.price != null ? ' · px ' + payload.price : '') +
        '\nИсточник: ' +
        (payload.source === 'workb' ? 'Workb' : '★ watch')
    }

    this._send(text).catch(function () {})
    this.bus.emit('telegram:toast', {
      ok: true,
      message: 'RSI алерт: ' + String(sym).toUpperCase(),
    })
    return item
  }

  TelegramAlertAgent.prototype._clearEpisodeIfRecovered = function (sym, interval, streak) {
    var ep = this._episodeKey(sym, interval)
    if (streak <= 0 && this._rsiEpisodes[ep]) {
      delete this._rsiEpisodes[ep]
      this._saveEpisodes()
    }
  }

  TelegramAlertAgent.prototype._rsiWatchSymbols = function () {
    var watch = []
    var seen = Object.create(null)
    function add(s) {
      s = String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      if (!s || seen[s]) return
      seen[s] = 1
      watch.push(s)
    }
    // ★ только (антиспам)
    try {
      var favs = (this.screener && this.screener.favs) || {}
      Object.keys(favs).forEach(function (k) {
        if (favs[k]) add(k.split(':').slice(1).join(':'))
      })
      var marks = (this.screener && this.screener.marks) || {}
      Object.keys(marks).forEach(function (k) {
        if (marks[k]) add(k.split(':').slice(1).join(':'))
      })
    } catch (e) {}
    if (this.state.rsiFavsOnly === false) {
      try {
        var t = this.tickers.get()
        if (t.spot) add(t.spot.symbol)
        if (t.futures) add(t.futures.symbol)
      } catch (e) {}
      var topN = Math.max(5, Math.min(40, Number(this.state.watchTopN) || 25))
      this._watch.forEach(add)
      try {
        var snap = this.screener && this.screener.snapshot && this.screener.snapshot()
        var rows = (snap && snap.rows) || []
        rows
          .slice()
          .sort(function (a, b) {
            return (Number(b.quoteVolume) || 0) - (Number(a.quoteVolume) || 0)
          })
          .slice(0, topN)
          .forEach(function (r) {
            add(r.symbol)
          })
      } catch (e) {}
    }
    if (this.state.rsiStrategyWatch !== false) {
      RSI_BOLL_15M_SYMBOLS.forEach(add)
    }
    return watch.slice(0, 40)
  }

  TelegramAlertAgent.prototype._fetchKlines = async function (symbol, interval) {
    var sym = String(symbol).toUpperCase()
    var iv = interval || '5m'
    var limit = this.state.rsiBollRequired !== false ? 160 : 120
    var url =
      'https://api.binance.com/api/v3/klines?symbol=' + sym + '&interval=' + iv + '&limit=' + limit
    var gate = global.Scalp.ExchangeGate
    var data
    if (gate && gate.fetchJson) data = await gate.fetchJson(url)
    else {
      var res = await fetch(url)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      data = await res.json()
    }
    if (!Array.isArray(data)) throw new Error('bad klines')
    return data.map(function (k) {
      return {
        time: Math.floor(Number(k[0]) / 1000),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
      }
    })
  }

  TelegramAlertAgent.prototype._nearLowerBoll = function (candle, lower, upper, nearPct) {
    if (lower == null || upper == null || !isFinite(lower) || !isFinite(upper)) return false
    var width = upper - lower
    if (!(width > 0)) return false
    var frac = Math.max(0.05, Math.min(0.35, Number(nearPct) || 15)) / 100
    var thr = lower + frac * width
    return Number(candle.low) <= thr || Number(candle.close) <= thr
  }

  TelegramAlertAgent.prototype._evalRsiStreak = function (candles, oversold, opts) {
    opts = opts || {}
    var closes = candles.map(function (c) {
      return c.close
    })
    var series = global.Scalp.Indicators.rsi(closes, 14)
    var bb = global.Scalp.Indicators.bollinger(closes, 20, 2)
    var os = Number(oversold) || 27
    var bollReq = opts.bollRequired === true
    var nearPct = opts.nearPct != null ? opts.nearPct : 15
    var streak = 0
    var lastRsi = null
    var lastOk = false
    for (var i = 0; i < series.length; i++) {
      var v = series[i]
      if (v == null || !isFinite(v)) {
        streak = 0
        lastOk = false
        continue
      }
      lastRsi = v
      var ok = v <= os
      if (bollReq) {
        ok =
          ok &&
          this._nearLowerBoll(candles[i], bb.lower[i], bb.upper[i], nearPct)
      }
      lastOk = ok
      if (ok) streak++
      else streak = 0
    }
    return { streak: streak, rsi: lastRsi, series: series, bollOk: lastOk }
  }

  TelegramAlertAgent.prototype._fmtPx = function (px) {
    if (!(px > 0)) return '—'
    if (px >= 1000) return px.toFixed(2)
    if (px >= 1) return px.toFixed(4)
    if (px >= 0.01) return px.toFixed(5)
    return px.toFixed(8)
  }

  TelegramAlertAgent.prototype._buildRsiBollMessage = function (payload) {
    var sym = String(payload.label || payload.symbol || '').toUpperCase()
    var iv = payload.interval || this.state.rsiInterval || '15m'
    var os = Number(payload.oversold != null ? payload.oversold : this.state.rsiOversold) || 27
    var bars = Number(payload.bars) || 0
    var px = Number(payload.price)
    var stopPct = Number(this.state.rsiStopPct) || 1.2
    var takePct = Number(this.state.rsiTakePct) || 1.6
    var part = Number(this.state.rsiTakePartialPct) || 50
    var entry = px
    var stop = entry > 0 ? entry * (1 - stopPct / 100) : null
    var take = entry > 0 ? entry * (1 + takePct / 100) : null
    var lines = [
      '🟢 BUY · RSI + Boll (lower)',
      sym + ' · ' + iv,
      'RSI ≤' + os + ' × ' + bars + ' баров · у нижней BB (вблизи)',
      payload.rsi != null ? 'RSI сейчас ' + Number(payload.rsi).toFixed(1) : '',
      entry > 0 ? 'Вход: open следующей (~' + this._fmtPx(entry) + ')' : 'Вход: open следующей свечи',
      stop != null ? 'Стоп −' + stopPct + '%: ' + this._fmtPx(stop) : '',
      take != null
        ? 'Тейк1 +' + takePct + '% (' + part + '%): ' + this._fmtPx(take)
        : '',
      'Остаток: тайм / стоп (выход RSI≥82×5 редко)',
      'Источник: ★ watch 15m',
    ]
    return lines.filter(Boolean).join('\n')
  }

  TelegramAlertAgent.prototype._pollRsiOnce = async function () {
    if (!this.state.enabled || this.state.alertRsi === false || this._rsiBusy) return
    this._rsiBusy = true
    try {
      var list = this._rsiWatchSymbols()
      if (!list.length) return
      var batch = 3
      var start = this._rsiCursor % list.length
      this._rsiCursor = start + batch
      var slice = []
      for (var i = 0; i < batch && i < list.length; i++) slice.push(list[(start + i) % list.length])
      var interval = this.state.rsiInterval || '15m'
      var oversold = Number(this.state.rsiOversold) || 27
      var need = Math.max(1, Number(this.state.rsiSignalBars) || 5)
      var bollReq = this.state.rsiBollRequired !== false
      var self = this
      for (var j = 0; j < slice.length; j++) {
        var sym = slice[j]
        try {
          var candles = await this._fetchKlines(sym, interval)
          var ev = this._evalRsiStreak(candles, oversold, {
            bollRequired: bollReq,
            nearPct: this.state.rsiBollNearPct,
          })
          self._clearEpisodeIfRecovered(sym, interval, ev.streak)

          // прогрев: первый замер только запоминаем (не шлём — иначе спам уже «лежащих» в OS)
          if (!self._rsiWarm[sym]) {
            self._rsiWarm[sym] = 1
            self._rsiPrevStreak[sym] = ev.streak
            if (ev.streak >= need) {
              self._rsiEpisodes[self._episodeKey(sym, interval)] = { ts: Date.now(), seeded: 1 }
              self._saveEpisodes()
            }
            continue
          }

          var prev = self._rsiPrevStreak[sym] || 0
          self._rsiPrevStreak[sym] = ev.streak
          // 5 баров RSI+Boll: сигнал когда streak впервые достиг need (не 6-й)
          var fire =
            bollReq && ev.streak === need && prev === need - 1
              ? true
              : !bollReq && ev.streak === need + 1 && prev === need
          if (fire) {
            self._handleRsiAlert({
              symbol: sym,
              interval: interval,
              oversold: oversold,
              bars: bollReq ? need : ev.streak,
              rsi: ev.rsi,
              price: candles.length ? candles[candles.length - 1].close : null,
              candles: candles,
              source: 'poll',
            })
          }
        } catch (e) {}
      }
    } finally {
      this._rsiBusy = false
    }
  }

  TelegramAlertAgent.prototype._armRsiPoll = function () {
    var self = this
    if (this._rsiTimer) {
      clearInterval(this._rsiTimer)
      this._rsiTimer = 0
    }
    if (!this.state.enabled || this.state.alertRsi === false) return
    var sec = Math.max(45, Number(this.state.rsiPollSec) || 90)
    this._rsiTimer = setInterval(function () {
      self._pollRsiOnce()
    }, sec * 1000)
    // без мгновенного опроса при старте — сначала прогрев через интервал
    setTimeout(function () {
      self._pollRsiOnce()
    }, 15000)
  }

  TelegramAlertAgent.prototype._refreshWatch = function () {
    if (!this.state.enabled || !this.state.alertTrades) {
      this._closeWs()
      // still keep symbol list for RSI
    }
    var watch = []
    var t = this.tickers.get()
    if (t.spot && t.spot.symbol) watch.push(String(t.spot.symbol).toLowerCase())
    if (t.futures && t.futures.symbol) watch.push(String(t.futures.symbol).toLowerCase())

    var topN = Math.max(5, Math.min(40, Number(this.state.watchTopN) || 25))
    try {
      var snap = this.screener && this.screener.snapshot && this.screener.snapshot()
      var rows = (snap && snap.rows) || []
      rows
        .slice()
        .sort(function (a, b) {
          return (Number(b.quoteVolume) || 0) - (Number(a.quoteVolume) || 0)
        })
        .slice(0, topN)
        .forEach(function (r) {
          var id = String(r.symbol || '').toLowerCase()
          if (id) watch.push(id)
        })
    } catch (e) {}

    if (watch.length < 8 && this.symbols && this.symbols.getList) {
      this.symbols
        .getList('binance', { quote: 'USDT' })
        .slice(0, topN)
        .forEach(function (s) {
          watch.push(s.id)
        })
    }

    var uniq = []
    var seen = Object.create(null)
    watch.forEach(function (s) {
      s = String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!s || seen[s]) return
      seen[s] = 1
      uniq.push(s)
    })
    this._watch = uniq.slice(0, topN)
    if (this.state.enabled && this.state.alertTrades) this._openTradeWs()
    else this._closeWs()
  }

  TelegramAlertAgent.prototype._closeWs = function () {
    if (this._ws) {
      try {
        this._ws.onclose = null
        this._ws.close()
      } catch (e) {}
      this._ws = null
    }
  }

  TelegramAlertAgent.prototype._openTradeWs = function () {
    var self = this
    this._closeWs()
    if (!this._watch.length) return
    var streams = this._watch.map(function (sym) {
      return sym + '@aggTrade'
    })
    var url =
      'wss://stream.binance.com:9443/stream?streams=' + streams.slice(0, 40).join('/')
    try {
      this._ws = new WebSocket(url)
    } catch (e) {
      return
    }
    this._ws.onmessage = function (ev) {
      if (!self.state.enabled || !self.state.alertTrades) return
      try {
        var msg = JSON.parse(ev.data)
        var d = msg.data || msg
        if (!d || d.e !== 'aggTrade') return
        var price = Number(d.p)
        var qty = Number(d.q)
        var usd = price * qty
        var minUsd = Number(self.state.minTradeUsd) || 75000
        if (!(usd >= minUsd)) return
        var sym = String(d.s || '').toUpperCase()
        var side = d.m ? 'SELL' : 'BUY'
        var key = 'tr|' + sym + '|' + side
        if (!self._canSend(key, self._tradeCd)) return
        var emoji = side === 'BUY' ? '🟢' : '🔴'
        self
          ._send(
            emoji +
              ' LARGE ' +
              side +
              ' ' +
              sym +
              '\n' +
              self._usd(usd) +
              ' @ ' +
              price +
              ' · qty ' +
              qty,
          )
          .catch(function () {})
      } catch (err) {}
    }
    this._ws.onclose = function () {
      if (!self.state.enabled || !self.state.alertTrades) return
      setTimeout(function () {
        if (self.state.enabled) self._openTradeWs()
      }, 4000)
    }
  }

  TelegramAlertAgent.prototype.start = function () {
    // только RSI-poll по ★; walls/trades не поднимаем
    this.state.enabled = true
    this.state.alertRsi = true
    this.state.alertWalls = false
    this.state.alertTrades = false
    this._hardMute = false
    this._closeWs()
    try {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.telegram, this.state)
    } catch (e) {}
    this._refreshWatch()
    this._armRsiPoll()
  }

  global.Scalp.TelegramAlertAgent = TelegramAlertAgent
})(typeof window !== 'undefined' ? window : globalThis)
