

const STORAGE_KEY = 'medilens_logs'
const MAX_ENTRIES = 100

export function logAIResponse({ phase, prompt, rawResponse, parsed, salt, brand, durationMs }) {
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    const entry = {
      id:          Date.now(),
      ts:          new Date().toISOString(),
      phase,
      salt:        salt || null,
      brand:       brand || null,
      durationMs:  durationMs || null,
      prompt:      prompt || null,
      rawResponse: rawResponse || null,
      parsed:      parsed || null,
      ok:          !!parsed,
    }
    existing.push(entry)

    const trimmed = existing.slice(-MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch (e) {
    console.warn('[MediLens] Log write failed:', e)
  }
}

export function getLogs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}

export function clearLogs() {
  localStorage.removeItem(STORAGE_KEY)
  console.log('[MediLens] Logs cleared.')
}

export function exportLogsJSON() {
  const logs = getLogs()
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url
  a.download = `medilens_logs_${new Date().toISOString().slice(0,10)}.json`
  a.click(); URL.revokeObjectURL(url)
}

if (typeof window !== 'undefined') {
  window.__medilensLogs   = getLogs
  window.__medilensClear  = clearLogs
  window.__medilensExport = exportLogsJSON
}
