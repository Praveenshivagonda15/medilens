import React from 'react'
import ReactDOM from 'react-dom/client'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import App from './App.jsx'
import './index.css'

function migrateLegacyStorageKeys() {
  const migrations = [
    ['agada_bookmarks', 'medilens_bookmarks'],
    ['agada_active_profile_id', 'medilens_active_profile_id'],
    ['agada_doodles', 'medilens_doodles']
  ]

  for (const [legacyKey, currentKey] of migrations) {
    try {
      const legacyValue = localStorage.getItem(legacyKey)
      if (legacyValue !== null && localStorage.getItem(currentKey) === null) {
        localStorage.setItem(currentKey, legacyValue)
      }
      localStorage.removeItem(legacyKey)
    } catch (e) {}
  }
}

migrateLegacyStorageKeys()

try {
  inject()
} catch (e) {
  console.warn('Vercel Analytics blocked or failed to load:', e)
}

try {
  injectSpeedInsights()
} catch (e) {
  console.warn('Vercel Speed Insights blocked or failed to load:', e)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
