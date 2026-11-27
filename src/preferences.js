export function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* The game's current settings remain usable. */ }
}
