import { useMemo, useState } from 'react'
import {
  EXCHANGE_PRESETS,
  applyExchangePreset,
  type ApiSettings,
  type DomSettings,
  type ExchangeId,
} from '../types'
import { testPublicApi, testSignedApi, type ApiTestResult } from '../lib/api'

type Tab = 'api' | 'general' | 'dom' | 'trade'

interface Props {
  settings: DomSettings
  api: ApiSettings
  onChange: <K extends keyof DomSettings>(key: K, value: DomSettings[K]) => void
  onApiChange: <K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) => void
  onApiPatch: (partial: Partial<ApiSettings>) => void
  onReset: () => void
  onApiReset: () => void
  onClose: () => void
  initialTab?: Tab
}

export function SettingsPanel({
  settings,
  api,
  onChange,
  onApiChange,
  onApiPatch,
  onReset,
  onApiReset,
  onClose,
  initialTab = 'api',
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [testResult, setTestResult] = useState<ApiTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const tabs = useMemo(
    () =>
      [
        { id: 'api' as const, label: 'API' },
        { id: 'general' as const, label: 'Общие' },
        { id: 'dom' as const, label: 'Стакан' },
        { id: 'trade' as const, label: 'Торговля' },
      ] as const,
    [],
  )

  const runTest = async (signed: boolean) => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = signed ? await testSignedApi(api) : await testPublicApi(api)
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  const applyPreset = (exchange: ExchangeId) => {
    onApiPatch(applyExchangePreset(exchange, api.testnet))
    setTestResult(null)
  }

  return (
    <div className="settings-overlay" onClick={onClose} role="presentation">
      <div
        className="settings-panel settings-wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Настройки"
      >
        <header className="settings-header">
          <h2>Настройки</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        <nav className="settings-tabs tabs-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {tab === 'api' && (
            <>
              <Field label="Биржа">
                <select
                  value={api.exchange}
                  onChange={(e) => applyPreset(e.target.value as ExchangeId)}
                >
                  {(Object.keys(EXCHANGE_PRESETS) as ExchangeId[]).map((id) => (
                    <option key={id} value={id}>
                      {EXCHANGE_PRESETS[id].label}
                    </option>
                  ))}
                </select>
              </Field>

              <Toggle
                label="Testnet"
                checked={api.testnet}
                onChange={(v) => {
                  onApiPatch(applyExchangePreset(api.exchange, v))
                  setTestResult(null)
                }}
              />

              <Toggle
                label="Только просмотр (без торговли)"
                checked={api.viewOnly}
                onChange={(v) => onApiChange('viewOnly', v)}
              />

              <Field label="REST Base URL">
                <input
                  type="text"
                  className="input-wide"
                  value={api.restBaseUrl}
                  onChange={(e) => onApiChange('restBaseUrl', e.target.value.trim())}
                  placeholder="https://api.binance.com"
                />
              </Field>

              <Field label="WebSocket Base URL">
                <input
                  type="text"
                  className="input-wide"
                  value={api.wsBaseUrl}
                  onChange={(e) => onApiChange('wsBaseUrl', e.target.value.trim())}
                  placeholder="wss://stream.binance.com:9443"
                />
              </Field>

              <Field label="Свой символ (опц.)">
                <input
                  type="text"
                  value={api.customSymbol}
                  onChange={(e) => onApiChange('customSymbol', e.target.value.toUpperCase())}
                  placeholder="BTCUSDT"
                />
              </Field>

              <Field label="Depth limit">
                <select
                  value={api.depthLimit}
                  onChange={(e) => onApiChange('depthLimit', Number(e.target.value))}
                >
                  {[100, 500, 1000].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="WS speed">
                <select
                  value={api.depthSpeed}
                  onChange={(e) =>
                    onApiChange('depthSpeed', e.target.value as ApiSettings['depthSpeed'])
                  }
                >
                  <option value="100ms">100 ms</option>
                  <option value="1000ms">1000 ms</option>
                </select>
              </Field>

              <div className="settings-section-title">Ключи API</div>
              <p className="settings-note">
                Хранятся только в localStorage браузера. Для торговли включите ключи с правом
                Spot/Futures Trade; для стакана достаточно публичного доступа.
              </p>

              <Field label="API Key">
                <input
                  type="text"
                  className="input-wide"
                  autoComplete="off"
                  spellCheck={false}
                  value={api.apiKey}
                  onChange={(e) => onApiChange('apiKey', e.target.value.trim())}
                  placeholder="••••••••"
                />
              </Field>

              <Field label="API Secret">
                <div className="secret-row">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    className="input-wide"
                    autoComplete="off"
                    spellCheck={false}
                    value={api.apiSecret}
                    onChange={(e) => onApiChange('apiSecret', e.target.value.trim())}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    className="btn ghost tight"
                    onClick={() => setShowSecret((s) => !s)}
                  >
                    {showSecret ? 'Скрыть' : 'Показать'}
                  </button>
                </div>
              </Field>

              <div className="api-actions">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={testing}
                  onClick={() => void runTest(false)}
                >
                  Проверить REST
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={testing || api.viewOnly}
                  onClick={() => void runTest(true)}
                >
                  Проверить ключи
                </button>
                <button type="button" className="btn ghost" onClick={onApiReset}>
                  Сбросить API
                </button>
              </div>

              {testResult && (
                <div className={`api-test ${testResult.ok ? 'ok' : 'fail'}`}>
                  {testResult.message}
                </div>
              )}
            </>
          )}

          {tab === 'general' && (
            <>
              <Field label="Множитель шага цены">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.priceStepMultiplier}
                  onChange={(e) =>
                    onChange('priceStepMultiplier', Math.max(1, Number(e.target.value) || 1))
                  }
                />
              </Field>
              <Field label="Знаков у объёмов">
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={settings.volumeDecimals}
                  onChange={(e) =>
                    onChange(
                      'volumeDecimals',
                      Math.min(8, Math.max(0, Number(e.target.value) || 0)),
                    )
                  }
                />
              </Field>
              <Toggle
                label="Сокращать тысячи (K / M)"
                checked={settings.shortenThousands}
                onChange={(v) => onChange('shortenThousands', v)}
              />
              <Field label="Уровней с каждой стороны">
                <input
                  type="number"
                  min={8}
                  max={60}
                  value={settings.levelsPerSide}
                  onChange={(e) =>
                    onChange(
                      'levelsPerSide',
                      Math.min(60, Math.max(8, Number(e.target.value) || 8)),
                    )
                  }
                />
              </Field>
              <Field label="Высота строки, px">
                <input
                  type="number"
                  min={16}
                  max={36}
                  value={settings.rowHeight}
                  onChange={(e) =>
                    onChange('rowHeight', Math.min(36, Math.max(16, Number(e.target.value) || 16)))
                  }
                />
              </Field>
              <Field label="Размер шрифта, px">
                <input
                  type="number"
                  min={10}
                  max={18}
                  value={settings.fontSize}
                  onChange={(e) =>
                    onChange('fontSize', Math.min(18, Math.max(10, Number(e.target.value) || 10)))
                  }
                />
              </Field>
            </>
          )}

          {tab === 'dom' && (
            <>
              <Toggle
                label="Автопрокрутка к спреду"
                checked={settings.autoScroll}
                onChange={(v) => onChange('autoScroll', v)}
              />
              <Toggle
                label="Отображать линейку"
                checked={settings.showRuler}
                onChange={(v) => onChange('showRuler', v)}
              />
              <Field label="Линейка">
                <select
                  value={settings.rulerMode}
                  onChange={(e) =>
                    onChange('rulerMode', e.target.value as DomSettings['rulerMode'])
                  }
                >
                  <option value="percent">Проценты</option>
                  <option value="points">Пункты</option>
                </select>
              </Field>
              <Toggle
                label="Подсветка крупных объёмов"
                checked={settings.highlightLarge}
                onChange={(v) => onChange('highlightLarge', v)}
              />
              <Field label="Порог крупного объёма">
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={settings.largeVolumeThreshold}
                  onChange={(e) =>
                    onChange('largeVolumeThreshold', Math.max(0.1, Number(e.target.value) || 0.1))
                  }
                />
              </Field>
              <Field label="Тема">
                <select
                  value={settings.theme}
                  onChange={(e) => onChange('theme', e.target.value as DomSettings['theme'])}
                >
                  <option value="dark">Тёмная</option>
                  <option value="classic">Классика CScalp</option>
                </select>
              </Field>
            </>
          )}

          {tab === 'trade' && (
            <>
              <Field label="Дальность заброса (шаги)">
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={settings.throwDistance}
                  onChange={(e) =>
                    onChange('throwDistance', Math.max(0, Number(e.target.value) || 0))
                  }
                />
              </Field>
              <Field label="Stop-Loss (пункты, 0 = выкл)">
                <input
                  type="number"
                  min={0}
                  value={settings.stopLoss}
                  onChange={(e) => onChange('stopLoss', Math.max(0, Number(e.target.value) || 0))}
                />
              </Field>
              <Field label="Take-Profit (пункты, 0 = выкл)">
                <input
                  type="number"
                  min={0}
                  value={settings.takeProfit}
                  onChange={(e) =>
                    onChange('takeProfit', Math.max(0, Number(e.target.value) || 0))
                  }
                />
              </Field>
              <Field label="Отображение прибыли">
                <select
                  value={settings.pnlMode}
                  onChange={(e) => onChange('pnlMode', e.target.value as DomSettings['pnlMode'])}
                >
                  <option value="percent">Проценты</option>
                  <option value="usdt">USDT</option>
                </select>
              </Field>
              <Field label="Рабочие объёмы">
                <select
                  value={settings.volumeUnit}
                  onChange={(e) =>
                    onChange('volumeUnit', e.target.value as DomSettings['volumeUnit'])
                  }
                >
                  <option value="lots">Лоты</option>
                  <option value="usd">Валюта ($)</option>
                </select>
              </Field>
              <Field label="Слоты объёмов (через запятую)">
                <input
                  type="text"
                  value={settings.workVolumes.join(', ')}
                  onChange={(e) => {
                    const vols = e.target.value
                      .split(',')
                      .map((s) => Number(s.trim()))
                      .filter((n) => Number.isFinite(n) && n > 0)
                    if (vols.length) onChange('workVolumes', vols)
                  }}
                />
              </Field>
            </>
          )}
        </div>

        <footer className="settings-footer">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              onReset()
              onApiReset()
            }}
          >
            Сбросить всё
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Готово
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="settings-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
