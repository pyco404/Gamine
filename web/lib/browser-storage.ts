/** Move saved browser state to the new brand without losing an active launch. */
const legacyKeys: Record<string, string[]> = {
  "gamine.session": ["agenticpad.session", "oxude.session"],
  "gamine.agent": ["agenticpad.agent", "oxude.agent"],
  "gamine.sound": ["agenticpad.sound", "agentclash.sound"],
  "gamine.night": ["agenticpad.night", "agentclash.night"],
  "gamine.pump.pending": ["agenticpad.pump.pending", "agentclash.pump.pending"],
  "gamine.launchpad.mock": ["agenticpad.launchpad.mock", "agentclash.launchpad.mock"],
  "gamine.arena.v1": ["agenticpad.arena.v1"],
  "gamine.cameraHelp": ["agenticpad.cameraHelp"],
};

export function readStoredValue(storage: Storage, key: string): string | null {
  const current = storage.getItem(key);
  if (current !== null) return current;
  for (const legacy of legacyKeys[key] ?? []) {
    const value = storage.getItem(legacy);
    if (value === null) continue;
    try { storage.setItem(key, value); storage.removeItem(legacy); }
    catch { /* A full storage must not lose the existing pending transaction. */ }
    return value;
  }
  return null;
}

export function removeStoredValue(storage: Storage, key: string): void {
  storage.removeItem(key);
  for (const legacy of legacyKeys[key] ?? []) storage.removeItem(legacy);
}
