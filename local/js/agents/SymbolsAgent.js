/* SymbolsAgent — полный список тикеров с биржи + tickSize */
(function (global) {
  'use strict'

  function SymbolsAgent(bus) {
    this.bus = bus
    /** @type {Record<string, {id:string,label:string,tickSize:number,base:string,quote:string,status:string}[]>} */
    this.cache = {}
    this.status = {}
    this.quoteFilter = localStorage.getItem('scalp-quote-filter') || 'USDT'
    this.search = { spot: '', futures: '' }
    this._bind()
  }

  SymbolsAgent.prototype._bind = function () {
    var self = this
    this.bus.on('symbols:load', function (payload) {
      if (payload && payload.force) self.forceLoad(payload.exchange, payload.restBaseUrl)
      else self.load(payload.exchange, payload.restBaseUrl)
    })
    this.bus.on('symbols:set-quote', function (quote) {
      self.quoteFilter = String(quote || '').toUpperCase()
      localStorage.setItem('scalp-quote-filter', self.quoteFilter)
      self.bus.emit('symbols:changed', self.snapshot())
    })
    this.bus.on('symbols:search', function (payload) {
      self.search[payload.pane || 'spot'] = String(payload.q || '')
      self.bus.emit('symbols:changed', self.snapshot())
    })
    this.bus.on('tickers:changed', function (state) {
      ;['spot', 'futures'].forEach(function (pane) {
        var p = state[pane]
        if (p) self.load(p.exchange, p.restBaseUrl)
      })
    })
  }

  SymbolsAgent.prototype.snapshot = function () {
    return {
      cache: this.cache,
      status: this.status,
      quoteFilter: this.quoteFilter,
      search: Object.assign({}, this.search),
    }
  }

  SymbolsAgent.prototype.getList = function (exchange, opts) {
    opts = opts || {}
    var list = this.cache[exchange] || []
    var quote = (opts.quote != null ? opts.quote : this.quoteFilter).toUpperCase()
    var q = String(opts.search || '').toLowerCase().trim()
    return list.filter(function (s) {
      if (quote && quote !== 'ALL' && s.quote !== quote) return false
      if (q && s.id.indexOf(q) === -1 && s.label.toLowerCase().indexOf(q) === -1) return false
      return s.status === 'TRADING' || s.status === 'Trading' || !s.status
    })
  }

  SymbolsAgent.prototype.find = function (exchange, symbolId) {
    var list = this.cache[exchange] || []
    var id = String(symbolId || '').toLowerCase()
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i]
    }
    return {
      id: id,
      label: id.toUpperCase(),
      tickSize: 0,
      stepSize: 0,
      minQty: 0,
      base: '',
      quote: '',
    }
  }

  SymbolsAgent.prototype.load = async function (exchange, restBaseUrl) {
    if (!exchange) return
    if (this.status[exchange] === 'loading') return
    // reuse cache briefly
    if (
      this.cache[exchange] &&
      this.cache[exchange].length &&
      this.status[exchange] === 'ok'
    ) {
      this.bus.emit('symbols:changed', this.snapshot())
      return
    }
    this.status[exchange] = 'loading'
    this.bus.emit('symbols:changed', this.snapshot())
    try {
      var list = await fetchSymbols(exchange, restBaseUrl)
      this.cache[exchange] = list
      this.status[exchange] = 'ok'
      try {
        sessionStorage.setItem('scalp-sym-v2-' + exchange, JSON.stringify(list))
      } catch (e) {}
      this.bus.emit('symbols:changed', this.snapshot())
      this.bus.emit('symbols:loaded', { exchange: exchange, count: list.length })
    } catch (e) {
      this.status[exchange] = 'error'
      try {
        var raw = sessionStorage.getItem('scalp-sym-v2-' + exchange)
        if (raw) this.cache[exchange] = JSON.parse(raw)
      } catch (err) {}
      if (!this.cache[exchange] || !this.cache[exchange].length) {
        this.cache[exchange] = global.Scalp.Config.SYMBOLS.slice()
      }
      this.bus.emit('symbols:changed', this.snapshot())
    }
  }

  SymbolsAgent.prototype.forceLoad = function (exchange, restBaseUrl) {
    this.status[exchange] = ''
    this.cache[exchange] = null
    return this.load(exchange, restBaseUrl)
  }

  /** Force-fetch instruments for every preset exchange (Binance/Bybit spot+futures). */
  SymbolsAgent.prototype.forceLoadAll = function () {
    var presets = global.Scalp.Config.EXCHANGE_PRESETS || {}
    var self = this
    Object.keys(presets).forEach(function (ex) {
      self.forceLoad(ex, presets[ex].rest)
    })
  }

  function trimSlash(url) {
    return String(url || '').replace(/\/+$/, '')
  }

  function tickFromFilters(filters) {
    if (!filters) return 0
    for (var i = 0; i < filters.length; i++) {
      if (filters[i].filterType === 'PRICE_FILTER' && filters[i].tickSize) {
        return Number(filters[i].tickSize)
      }
    }
    return 0
  }

  function lotFromFilters(filters) {
    var out = { stepSize: 0, minQty: 0 }
    if (!filters) return out
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i]
      if (f.filterType === 'LOT_SIZE') {
        if (f.stepSize) out.stepSize = Number(f.stepSize)
        if (f.minQty) out.minQty = Number(f.minQty)
      }
    }
    return out
  }

  async function fetchSymbols(exchange, restBaseUrl) {
    var base = trimSlash(
      restBaseUrl || global.Scalp.Config.EXCHANGE_PRESETS[exchange].rest,
    )
    var gate = global.Scalp.ExchangeGate
    async function getJson(url) {
      if (gate && gate.fetchJson) return gate.fetchJson(url)
      var res = await fetch(url)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }
    if (exchange === 'binance') {
      var data = await getJson(base + '/api/v3/exchangeInfo')
      return (data.symbols || [])
        .filter(function (s) {
          return s.status === 'TRADING' && s.isSpotTradingAllowed !== false
        })
        .map(function (s) {
          var lot = lotFromFilters(s.filters)
          return {
            id: String(s.symbol).toLowerCase(),
            label: s.symbol,
            tickSize: tickFromFilters(s.filters),
            stepSize: lot.stepSize,
            minQty: lot.minQty,
            base: s.baseAsset,
            quote: s.quoteAsset,
            status: s.status,
            listTime: 0,
          }
        })
        .sort(function (a, b) {
          return a.label.localeCompare(b.label)
        })
    }
    if (exchange === 'binance-futures') {
      data = await getJson(base + '/fapi/v1/exchangeInfo')
      return (data.symbols || [])
        .filter(function (s) {
          return s.status === 'TRADING' && (s.contractType === 'PERPETUAL' || !s.contractType)
        })
        .map(function (s) {
          var lot = lotFromFilters(s.filters)
          var onboard = Number(s.onboardDate) || 0
          return {
            id: String(s.symbol).toLowerCase(),
            label: s.symbol,
            tickSize: tickFromFilters(s.filters),
            stepSize: lot.stepSize,
            minQty: lot.minQty,
            base: s.baseAsset,
            quote: s.quoteAsset,
            status: s.status,
            listTime: onboard > 0 ? onboard : 0,
          }
        })
        .sort(function (a, b) {
          return a.label.localeCompare(b.label)
        })
    }
    if (exchange === 'bybit' || exchange === 'bybit-futures') {
      var cat = exchange === 'bybit-futures' ? 'linear' : 'spot'
      data = await getJson(base + '/v5/market/instruments-info?category=' + cat + '&limit=1000')
      var list = (data.result && data.result.list) || []
      // paginate if nextPageCursor
      var cursor = data.result && data.result.nextPageCursor
      var guard = 0
      while (cursor && guard < 20) {
        guard++
        var d2 = await getJson(
          base +
            '/v5/market/instruments-info?category=' +
            cat +
            '&limit=1000&cursor=' +
            encodeURIComponent(cursor),
        )
        list = list.concat((d2.result && d2.result.list) || [])
        cursor = d2.result && d2.result.nextPageCursor
      }
      return list
        .filter(function (s) {
          return s.status === 'Trading'
        })
        .map(function (s) {
          var tick = 0
          var step = 0
          var minQty = 0
          if (s.priceFilter && s.priceFilter.tickSize) tick = Number(s.priceFilter.tickSize)
          if (s.lotSizeFilter) {
            if (s.lotSizeFilter.qtyStep) step = Number(s.lotSizeFilter.qtyStep)
            if (s.lotSizeFilter.minOrderQty) minQty = Number(s.lotSizeFilter.minOrderQty)
          }
          var launch = Number(s.launchTime) || 0
          return {
            id: String(s.symbol).toLowerCase(),
            label: s.symbol,
            tickSize: tick,
            stepSize: step,
            minQty: minQty,
            base: s.baseCoin,
            quote: s.quoteCoin,
            status: s.status,
            listTime: launch > 0 ? launch : 0,
          }
        })
        .sort(function (a, b) {
          return a.label.localeCompare(b.label)
        })
    }
    return global.Scalp.Config.SYMBOLS.slice()
  }

  SymbolsAgent.prototype.start = function () {
    // hydrate from session
    var self = this
    ;['binance', 'binance-futures', 'bybit', 'bybit-futures'].forEach(function (ex) {
      try {
        var raw = sessionStorage.getItem('scalp-sym-v2-' + ex)
        if (raw) {
          self.cache[ex] = JSON.parse(raw)
          self.status[ex] = 'ok'
        }
      } catch (e) {}
    })
    this.bus.emit('symbols:changed', this.snapshot())
  }

  global.Scalp.SymbolsAgent = SymbolsAgent
})(typeof window !== 'undefined' ? window : globalThis)
