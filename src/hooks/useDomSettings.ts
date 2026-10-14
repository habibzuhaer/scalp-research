import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type DomSettings } from '../types'
import { loadSettings, saveSettings } from '../lib/format'

export function useDomSettings() {
  const [settings, setSettings] = useState<DomSettings>(() => {
    const saved = loadSettings()
    return saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS
  })

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const update = <K extends keyof DomSettings>(key: K, value: DomSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  const reset = () => setSettings(DEFAULT_SETTINGS)

  return { settings, setSettings, update, reset }
}
