import { useEffect, useState } from 'react'
import { DEFAULT_API, type ApiSettings } from '../types'
import { loadApiSettings, saveApiSettings } from '../lib/format'

export function useApiSettings() {
  const [api, setApi] = useState<ApiSettings>(() => {
    const saved = loadApiSettings()
    return saved ? { ...DEFAULT_API, ...saved } : DEFAULT_API
  })

  useEffect(() => {
    saveApiSettings(api)
  }, [api])

  const update = <K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) => {
    setApi((s) => ({ ...s, [key]: value }))
  }

  const patch = (partial: Partial<ApiSettings>) => {
    setApi((s) => ({ ...s, ...partial }))
  }

  const reset = () => setApi(DEFAULT_API)

  return { api, setApi, update, patch, reset }
}
