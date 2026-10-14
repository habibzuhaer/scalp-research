/* HistoryBarAgent — полоса истории тикеров */
(function (global) {
  'use strict'

  function HistoryBarAgent(bus, historyAgent, profileAgent, root) {
    this.bus = bus
    this.history = historyAgent
    this.profile = profileAgent
    this.root = root
    this._bind()
  }

  HistoryBarAgent.prototype._bind = function () {
    var self = this
    this.bus.on('history:changed', function () {
      self.render()
    })
    this.bus.on('profile:changed', function () {
      self.render()
    })
  }

  HistoryBarAgent.prototype.render = function () {
    var profile = this.profile.get()
    if (!profile.showHistoryBar) {
      this.root.style.display = 'none'
      return
    }
    this.root.style.display = 'flex'
    var C = global.Scalp.Config
    var items = this.history.get().slice(0, 16)
    var html =
      '<span class="hist-label">История</span>' +
      items
        .map(function (it, i) {
          var label = (C.EXCHANGE_PRESETS[it.exchange]
            ? C.EXCHANGE_PRESETS[it.exchange].label.split(' ')[0]
            : it.exchange) +
            ' · ' +
            String(it.symbol).toUpperCase()
          var cls = it.market === 'futures' ? 'hist-chip fut' : 'hist-chip spot'
          return (
            '<button type="button" class="' +
            cls +
            '" data-i="' +
            i +
            '" title="' +
            new Date(it.ts).toLocaleString() +
            '">' +
            label +
            '</button>'
          )
        })
        .join('') +
      '<button type="button" class="hist-chip ghost" data-act="settings">⋯</button>' +
      '<button type="button" class="hist-chip ghost" data-act="clear">очистить</button>'

    this.root.innerHTML = html
    var self = this
    this.root.querySelectorAll('[data-i]').forEach(function (btn) {
      btn.onclick = function () {
        var item = self.history.get()[Number(btn.getAttribute('data-i'))]
        self.bus.emit('history:open', item)
      }
    })
    var clearBtn = this.root.querySelector('[data-act="clear"]')
    if (clearBtn) {
      clearBtn.onclick = function () {
        if (self.profile.get().confirmClearHistory) {
          if (!window.confirm('Очистить историю тикеров?')) return
        }
        self.bus.emit('history:clear')
      }
    }
    var setBtn = this.root.querySelector('[data-act="settings"]')
    if (setBtn) {
      setBtn.onclick = function () {
        self.bus.emit('ui:open-settings', { tab: 'history' })
      }
    }
  }

  HistoryBarAgent.prototype.start = function () {
    this.render()
  }

  global.Scalp.HistoryBarAgent = HistoryBarAgent
})(typeof window !== 'undefined' ? window : globalThis)
