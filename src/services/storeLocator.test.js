import test from 'node:test'
import assert from 'node:assert/strict'

import { buildJanAushadhiStoreUrl, JA_STORE_URL, openJanAushadhiStore, resolveJanAushadhiStoreUrl } from './storeLocator.js'

test('returns a Google Maps link when coordinates are available', () => {
  const url = buildJanAushadhiStoreUrl(12.9716, 77.5946)
  assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=Jan%20Aushadhi%20Kendra%20near%2012.9716%2C77.5946')
})

test('falls back to the official Jan Aushadhi page without coordinates', () => {
  assert.equal(buildJanAushadhiStoreUrl(), 'https://www.google.com/maps/search/?api=1&query=Jan%20Aushadhi%20Kendra%20near%20me')
  assert.equal(JA_STORE_URL, buildJanAushadhiStoreUrl())
})

test('uses a general Maps search when geolocation is unavailable', async () => {
  assert.equal(await resolveJanAushadhiStoreUrl(), JA_STORE_URL)
})

test('redirects the click-opened tab before detaching its opener', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const operations = []
  let providePosition
  const popup = { location: {} }
  Object.defineProperty(popup.location, 'href', {
    set: (url) => operations.push(`navigate:${url}`)
  })
  Object.defineProperty(popup, 'opener', {
    set: () => operations.push('detach')
  })

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { open: (url) => { operations.push(`open:${url}`); return popup } }
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { geolocation: { getCurrentPosition: (success) => { providePosition = success } } }
  })

  try {
    openJanAushadhiStore({ preventDefault: () => operations.push('prevent') })
    assert.deepEqual(operations, ['prevent', `open:${JA_STORE_URL}`])
    providePosition({ coords: { latitude: 12.9716, longitude: 77.5946 } })
    await Promise.resolve()
    assert.deepEqual(operations, [
      'prevent',
      `open:${JA_STORE_URL}`,
      `navigate:${buildJanAushadhiStoreUrl(12.9716, 77.5946)}`,
      'detach'
    ])
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globalThis.navigator
  }
})
