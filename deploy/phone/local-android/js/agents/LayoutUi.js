/* LayoutUi — применяет layout к DOM, resize-ручки */
(function (global) {
  'use strict'

  function LayoutUi(bus, rootShell) {
    this.bus = bus
    this.shell = rootShell || document.querySelector('.app-shell')
    this._dragging = null
    this._bind()
  }

  LayoutUi.prototype._bind = function () {
    var self = this
    this.bus.on('layout:changed', function (layout) {
      self.apply(layout)
    })
  }

  LayoutUi.prototype._setVars = function (L) {
    var railW = 0
    if (L.showRail) {
      railW = L.railCompact ? Math.min(L.railWidthPx, 88) : L.railWidthPx
      if (railW < 56) railW = 56
    }
    this.shell.style.setProperty(
      '--chart-h',
      Math.max(15, Math.min(70, Number(L.chartHeightPct) || 34)) + '%',
    )
    this.shell.style.setProperty('--spot-w', L.spotWidthPct + '%')
    this.shell.style.setProperty('--fut-w', 100 - L.spotWidthPct + '%')
    this.shell.style.setProperty('--rail-w', railW + 'px')
    this.shell.style.setProperty('--chart-side-w', L.chartWidthPct + '%')
  }

  LayoutUi.prototype._applyRail = function (L) {
    var rail = this.shell.querySelector('.brand-rail')
    var fab = document.getElementById('btn-show-rail')
    if (rail) {
      rail.style.display = L.showRail ? '' : 'none'
      rail.classList.toggle('rail-compact', !!L.railCompact)
      var copy = rail.querySelector('[data-rail="copy"]')
      var agents = rail.querySelector('[data-rail="agents"]')
      var docs = rail.querySelector('[data-rail="docs"]')
      var buttons = rail.querySelector('[data-rail="buttons"]')
      var title = rail.querySelector('[data-rail="title"]')
      if (copy) {
        copy.style.display = L.showRailCopy && !L.railCompact ? '' : 'none'
        if (L.railCopy) copy.textContent = L.railCopy
      }
      if (agents) agents.style.display = L.showRailAgents && !L.railCompact ? '' : 'none'
      if (docs) docs.style.display = L.showRailDocs ? '' : 'none'
      if (buttons) buttons.style.display = L.showRailButtons ? '' : 'none'
      if (title) title.style.display = L.railCompact ? 'none' : ''
    }
    if (fab) fab.hidden = !!L.showRail
  }

  LayoutUi.prototype.apply = function (L) {
    if (!this.shell) return
    var preset = global.Scalp.LAYOUT_PRESETS[L.preset] || global.Scalp.LAYOUT_PRESETS['chart-top']
    this._setVars(L)

    // while dragging — only CSS vars + chart redraw
    if (this._dragging) {
      window.dispatchEvent(new Event('resize'))
      return
    }

    var stack = this.shell.querySelector('.trade-view') || this.shell.querySelector('.main-stack')
    var chart = this.shell.querySelector('#chart-root')
    var band = this.shell.querySelector('#doms-band')
    var hist = this.shell.querySelector('#history-bar')
    var workspace = this.shell.querySelector('.workspace')
    var spot = this.shell.querySelector('#dom-spot')
    var fut = this.shell.querySelector('#dom-futures')
    var sideHandle = this.shell.querySelector('.resize-side')
    var hHandle = this.shell.querySelector('.resize-h')
    var vHandle = this.shell.querySelector('.resize-v')

    this.shell.setAttribute('data-layout', L.preset)
    this.shell.classList.toggle('layout-side', preset.chartPos === 'left')
    this.shell.classList.toggle('layout-no-chart', !L.showChart || preset.chartPos === 'hidden')
    this.shell.classList.toggle('layout-swap', !!L.swapDoms)
    this.shell.classList.toggle('layout-no-rail', !L.showRail)
    this.shell.classList.toggle('layout-rail-compact', !!L.railCompact)
    this.shell.classList.toggle('layout-no-history', !L.showHistory)

    this._applyRail(L)
    if (chart) chart.style.display = L.showChart && preset.chartPos !== 'hidden' ? '' : 'none'
    if (hist) hist.style.display = L.showHistory ? 'flex' : 'none'
    if (spot) spot.style.display = L.showSpot ? '' : 'none'
    if (fut) fut.style.display = L.showFutures ? '' : 'none'
    if (hHandle) {
      hHandle.style.display =
        L.showChart && (preset.chartPos === 'top' || preset.chartPos === 'bottom') ? '' : 'none'
    }
    if (sideHandle) {
      sideHandle.style.display = L.showChart && preset.chartPos === 'left' ? '' : 'none'
    }
    if (vHandle) {
      vHandle.style.display = L.showSpot && L.showFutures ? '' : 'none'
    }

    // trade-view: chart + doms-band (history lives inside band, left of DOMs)
    if (stack && band && chart) {
      var topNodes =
        preset.chartPos === 'bottom' ? [band, chart] : [chart, band]
      if (!L.showChart || preset.chartPos === 'hidden') topNodes = [band]
      topNodes.forEach(function (n) {
        if (n && n.parentNode === stack) stack.appendChild(n)
      })
    }

    // history always left of workspace inside band
    if (band && hist && workspace) {
      band.appendChild(hist)
      band.appendChild(workspace)
    }

    // swap spot/futures order
    if (workspace && spot && fut) {
      if (L.swapDoms) {
        workspace.insertBefore(fut, spot)
      } else {
        workspace.insertBefore(spot, fut)
      }
    }

    // grid template for trade-view
    if (stack) {
      if (!L.showChart || preset.chartPos === 'hidden') {
        stack.style.gridTemplateRows = '1fr'
        stack.style.gridTemplateColumns = '1fr'
        if (chart) {
          chart.style.gridColumn = ''
          chart.style.gridRow = ''
        }
        if (band) {
          band.style.gridColumn = ''
          band.style.gridRow = ''
        }
      } else if (preset.chartPos === 'left') {
        stack.style.gridTemplateColumns = 'var(--chart-side-w) 1fr'
        stack.style.gridTemplateRows = '1fr'
        if (chart) {
          chart.style.gridColumn = '1'
          chart.style.gridRow = '1'
        }
        if (band) {
          band.style.gridColumn = '2'
          band.style.gridRow = '1'
        }
      } else if (preset.chartPos === 'bottom') {
        stack.style.gridTemplateColumns = '1fr'
        stack.style.gridTemplateRows = 'minmax(0, 1fr) minmax(220px, var(--chart-h))'
        if (chart) {
          chart.style.gridColumn = ''
          chart.style.gridRow = ''
        }
        if (band) {
          band.style.gridColumn = ''
          band.style.gridRow = ''
        }
      } else {
        stack.style.gridTemplateColumns = '1fr'
        stack.style.gridTemplateRows = 'minmax(220px, var(--chart-h)) minmax(0, 1fr)'
        if (chart) {
          chart.style.gridColumn = ''
          chart.style.gridRow = ''
          chart.style.minHeight = '220px'
        }
        if (band) {
          band.style.gridColumn = ''
          band.style.gridRow = ''
        }
      }
    }

    if (workspace) {
      // стаканы всегда рядом: Spot | Futures
      if (L.showSpot && L.showFutures) {
        var sw = L.swapDoms ? 'var(--fut-w) var(--spot-w)' : 'var(--spot-w) var(--fut-w)'
        workspace.style.gridTemplateColumns = sw
        workspace.style.gridTemplateRows = '1fr'
      } else {
        workspace.style.gridTemplateColumns = '1fr'
        workspace.style.gridTemplateRows = '1fr'
      }
    }

    this.shell.style.gridTemplateColumns = L.showRail ? 'var(--rail-w) 1fr' : '1fr'
    window.dispatchEvent(new Event('resize'))
  }

  LayoutUi.prototype.mountHandles = function () {
    var self = this
    var stack = this.shell.querySelector('.trade-view') || this.shell.querySelector('.main-stack')
    var workspace = this.shell.querySelector('.workspace')
    if (!stack || stack.querySelector('.resize-h')) return

    var hHandle = document.createElement('div')
    hHandle.className = 'resize-handle resize-h'
    hHandle.title = 'Высота графика'
    hHandle.dataset.resize = 'chart-h'
    stack.appendChild(hHandle)

    var sideHandle = document.createElement('div')
    sideHandle.className = 'resize-handle resize-side'
    sideHandle.title = 'Ширина графика'
    sideHandle.dataset.resize = 'chart-side'
    stack.appendChild(sideHandle)

    var vHandle = document.createElement('div')
    vHandle.className = 'resize-handle resize-v'
    vHandle.title = 'Ширина стаканов'
    vHandle.dataset.resize = 'spot-w'
    if (workspace) workspace.appendChild(vHandle)

    var onMove = function (e) {
      if (!self._dragging) return
      var L = global.Scalp.runtime && global.Scalp.runtime.layout
      if (!L) return
      var cur = L.get()
      if (self._dragging === 'chart-h') {
        var rect = stack.getBoundingClientRect()
        var y = e.clientY - rect.top
        var pct = Math.round((y / rect.height) * 100)
        if (cur.preset === 'chart-bottom') pct = 100 - pct
        L.patch({ chartHeightPct: pct })
      }
      if (self._dragging === 'spot-w') {
        var wr = workspace.getBoundingClientRect()
        var x = e.clientX - wr.left
        var wp = Math.round((x / wr.width) * 100)
        if (cur.swapDoms) wp = 100 - wp
        L.patch({ spotWidthPct: wp })
      }
      if (self._dragging === 'chart-side') {
        var sr = stack.getBoundingClientRect()
        var sx = e.clientX - sr.left
        L.patch({ chartWidthPct: Math.round((sx / sr.width) * 100) })
      }
    }
    var onUp = function () {
      if (!self._dragging) return
      self._dragging = null
      document.body.classList.remove('is-resizing')
      var L = global.Scalp.runtime && global.Scalp.runtime.layout
      if (L) self.apply(L.get())
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)

    this.shell.addEventListener('mousedown', function (e) {
      var h = e.target.closest('[data-resize]')
      if (!h) return
      e.preventDefault()
      self._dragging = h.dataset.resize
      document.body.classList.add('is-resizing')
    })
  }

  LayoutUi.prototype.start = function () {
    this.mountHandles()
  }

  global.Scalp.LayoutUi = LayoutUi
})(typeof window !== 'undefined' ? window : globalThis)
