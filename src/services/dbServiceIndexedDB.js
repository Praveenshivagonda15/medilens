const DB_NAME = 'medilens_vault_secure';
const DB_VERSION = 3;
const STORE_NAME = 'bookmarks_store';
const CACHE_STORE_NAME = 'catalog_cache';
const PROFILES_STORE_NAME = 'profiles_store';
const RECORD_KEY = 'all_bookmarks_cipher';

const memoryFallback = {
  [STORE_NAME]: {},
  [CACHE_STORE_NAME]: {},
  [PROFILES_STORE_NAME]: {}
};

function getFallbackDB() {
  return {
    transaction: (storeName) => ({
      objectStore: () => ({
        put: (val, key) => ({
          onsuccess: null,
          onerror: null,
          sendSuccess() { if (this.onsuccess) setTimeout(() => { memoryFallback[storeName][key] = val; this.onsuccess(); }, 0); }
        }.sendSuccess()),
        get: (key) => ({
          onsuccess: null,
          onerror: null,
          sendSuccess() { if (this.onsuccess) setTimeout(() => { this.onsuccess({ target: { result: memoryFallback[storeName][key] || null } }); }, 0); }
        }.sendSuccess()),
        delete: (key) => ({
          onsuccess: null,
          onerror: null,
          sendSuccess() { if (this.onsuccess) setTimeout(() => { delete memoryFallback[storeName][key]; this.onsuccess(); }, 0); }
        }.sendSuccess()),
        getAllKeys: () => ({
          onsuccess: null,
          onerror: null,
          sendSuccess() { if (this.onsuccess) setTimeout(() => { this.onsuccess({ target: { result: Object.keys(memoryFallback[storeName]) } }); }, 0); }
        }.sendSuccess())
      })
    })
  };
}

function openDB() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        return resolve(getFallbackDB());
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) db.createObjectStore(CACHE_STORE_NAME);
        if (!db.objectStoreNames.contains(PROFILES_STORE_NAME)) db.createObjectStore(PROFILES_STORE_NAME);
      };
      
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = () => resolve(getFallbackDB());
    } catch (e) {
      resolve(getFallbackDB());
    }
  });
}

export async function saveSecureLogs(cipherText) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(cipherText, RECORD_KEY);
      if (request && typeof request.sendSuccess === 'function') request.sendSuccess();
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

export async function getSecureLogs() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(RECORD_KEY);
      if (request && typeof request.sendSuccess === 'function') request.sendSuccess();
      request.onsuccess = (e) => resolve(e.target.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}

export async function clearSecureLogs() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(RECORD_KEY);
      if (request && typeof request.sendSuccess === 'function') request.sendSuccess();
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

export async function cacheCSVDatabase(key, text) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(CACHE_STORE_NAME);
      const request = store.put(text, key);
      if (request && typeof request.sendSuccess === 'function') request.sendSuccess();
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

export async function getCachedCSVDatabase(key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
      const store = tx.objectStore(CACHE_STORE_NAME);
      const request = store.get(key);
      if (request && typeof request.sendSuccess === 'function') request.sendSuccess();
      request.onsuccess = (e) => resolve(e.target.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}

export async function saveEncryptedProfile(profileId, cipherText) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(PROFILES_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PROFILES_STORE_NAME);
      const request = store.put(cipherText, profileId);
      if (request && typeof request.sendSuccess === 'function') request.sendSuccess();
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

export async function getEncryptedProfile(profileId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(PROFILES_STORE_NAME, 'readonly');
      const store = tx.objectStore(PROFILES_STORE_NAME);
      const request = store.get(profileId);
      if (request && typeof request.sendSuccess === 'function') request.sendSuccess();
      request.onsuccess = (e) => resolve(e.target.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}

export async function listProfileIds() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(PROFILES_STORE_NAME, 'readonly');
      const store = tx.objectStore(PROFILES_STORE_NAME);
      const request = store.getAllKeys();
      if (request && typeof request.sendSuccess === 'function') request.sendSuccess();
      request.onsuccess = (e) => resolve(e.target.result || []);
      request.onerror = () => resolve([]);
    });
  } catch (e) { return []; }
}

export async function deleteProfile(profileId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(PROFILES_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PROFILES_STORE_NAME);
      const request = store.delete(profileId);
      if (request && typeof request.sendSuccess === 'function') request.sendSuccess();
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}
