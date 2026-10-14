import { useState } from 'react'
import { OrderBook } from './components/OrderBook'
import { useDomSettings } from './hooks/useDomSettings'
import { useApiSettings } from './hooks/useApiSettings'
import type { SymbolId } from './types'
import './App.css'

function App() {
  const [symbol, setSymbol] = useState<SymbolId>('btcusdt')
  const { settings, update, reset } = useDomSettings()
  const { api, update: updateApi, patch: patchApi, reset: resetApi } = useApiSettings()

  return (
    <div className="app-shell">
      <aside className="brand-rail">
        <div className="logo">
          <span className="logo-mark">S</span>
          <div>
            <strong>sCalp</strong>
            <em>DOM Terminal</em>
          </div>
        </div>
        <p className="brand-copy">
          React/Vite UI. Каноничные агенты и полная HTML-документация — в{' '}
          <code>local/</code> и <code>docs/</code>.
        </p>
        <ul className="feature-list">
          <li>Live depth @100ms</li>
          <li>API: Binance / Futures / Bybit</li>
          <li>Агрегация цены ±</li>
          <li>Настройки: API / Общие / Стакан / Торговля</li>
        </ul>
      </aside>

      <main className="workspace">
        <OrderBook
          symbol={symbol}
          onSymbolChange={setSymbol}
          settings={settings}
          api={api}
          onSettingsChange={update}
          onApiChange={updateApi}
          onApiPatch={patchApi}
          onSettingsReset={reset}
          onApiReset={resetApi}
        />
      </main>
    </div>
  )
}

export default App
