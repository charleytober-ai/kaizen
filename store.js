// Storage module. This is the only file that touches saved data.
// v1 keeps everything on this device in localStorage, as one JSON blob.
// To share history between devices later, replace this file and keep the same functions.

const KEY = 'kaizen:v1';

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Never throw away data we can't read. Keep a copy before the app starts fresh.
    try { localStorage.setItem(`${KEY}:unreadable:${Date.now()}`, raw); } catch { /* nothing more to do */ }
    return null;
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Ask the browser not to clear our data when the phone is low on space.
export async function askToKeep() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* not supported */ }
  return false;
}
