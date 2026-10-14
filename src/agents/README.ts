/**
 * React-слой зеркалит концепции local/js/agents.
 * Каноничная агентная реализация — local/ (HTML без сборки).
 * См. docs/agents.html
 */
export const AGENT_MODULES = [
  'Bus',
  'ApiAgent',
  'SettingsAgent',
  'MarketAgent',
  'DomAgent',
  'SettingsUiAgent',
] as const
