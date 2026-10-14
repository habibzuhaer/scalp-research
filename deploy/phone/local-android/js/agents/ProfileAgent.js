/* ProfileAgent — профиль пользователя / layout */
(function (global) {
  'use strict'

  function ProfileAgent(bus) {
    this.bus = bus
    this.state = global.Scalp.Config.load(
      global.Scalp.Config.KEYS.profile,
      global.Scalp.Config.DEFAULT_PROFILE,
    )
    this._bind()
  }

  ProfileAgent.prototype._bind = function () {
    var self = this
    this.bus.on('profile:get', function () {
      self.bus.emit('profile:state', self.get())
    })
    this.bus.on('profile:patch', function (partial) {
      self.patch(partial)
    })
    this.bus.on('profile:reset', function () {
      self.reset()
    })
  }

  ProfileAgent.prototype.get = function () {
    return Object.assign({}, this.state)
  }

  ProfileAgent.prototype.applyUiTheme = function (themeId) {
    var themes = global.Scalp.Config.UI_THEMES || {}
    var id = themes[themeId] ? themeId : 'dark'
    this.state.uiTheme = id
    document.documentElement.setAttribute('data-ui-theme', id)
    if (document.body) document.body.setAttribute('data-ui-theme', id)
  }

  ProfileAgent.prototype.patch = function (partial) {
    this.state = Object.assign({}, this.state, partial)
    if (partial && partial.uiTheme != null) {
      this.applyUiTheme(this.state.uiTheme)
    }
    if (this.state.autosave !== false) {
      global.Scalp.Config.save(global.Scalp.Config.KEYS.profile, this.state)
    }
    this.bus.emit('profile:changed', this.get())
  }

  ProfileAgent.prototype.reset = function () {
    this.state = Object.assign({}, global.Scalp.Config.DEFAULT_PROFILE)
    global.Scalp.Config.save(global.Scalp.Config.KEYS.profile, this.state)
    this.applyUiTheme(this.state.uiTheme)
    this.bus.emit('profile:changed', this.get())
  }

  ProfileAgent.prototype.start = function () {
    this.applyUiTheme(this.state.uiTheme || 'dark')
    this.bus.emit('profile:changed', this.get())
  }

  global.Scalp.ProfileAgent = ProfileAgent
})(typeof window !== 'undefined' ? window : globalThis)
