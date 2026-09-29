export const JA_STORE_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Jan Aushadhi Kendra near me')}`

export function buildJanAushadhiStoreUrl(lat, lng) {
  if (typeof lat === 'number' && typeof lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Jan Aushadhi Kendra near ${lat},${lng}`)}`
  }
  return JA_STORE_URL
}

export function resolveJanAushadhiStoreUrl() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(JA_STORE_URL)
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve(buildJanAushadhiStoreUrl(coords.latitude, coords.longitude)),
      () => resolve(JA_STORE_URL),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    )
  })
}

export function openJanAushadhiStore(event) {
  if (event) event.preventDefault()
  const storeWindow = window.open(JA_STORE_URL, '_blank')

  resolveJanAushadhiStoreUrl().then((targetUrl) => {
    if (storeWindow) {
      storeWindow.location.href = targetUrl
      storeWindow.opener = null
    } else {
      window.location.href = targetUrl
    }
  })
}
