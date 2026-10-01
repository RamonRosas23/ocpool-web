export type InboxPreferenceSurface = 'staff' | 'portal';
export type InboxPreferences = Readonly<{ sound: boolean; desktop: boolean; activityEmail: 'DIGEST' | 'OFF' }>;
export type LegacyInboxPreferences = Readonly<Partial<Pick<InboxPreferences, 'sound' | 'desktop'>>>;
type BooleanPreference = 'sound' | 'desktop';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type LegacyPreferenceStorage = Pick<Storage, 'getItem'>;

/** Spec §5.3: sonido encendido por defecto para el equipo y apagado para clientes; escritorio sólo si la persona lo activa. */
export function defaultPreferences(surface: InboxPreferenceSurface): InboxPreferences {
  return { sound: surface === 'staff', desktop: false, activityEmail: 'DIGEST' };
}

function keyOf(surface: InboxPreferenceSurface, name: BooleanPreference): string {
  return `ocpool.inbox.${surface}.${name}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Lee el formato de navegador anterior; la bandeja activa ya usa la cuenta del servidor como fuente de verdad. */
export function readPreferences(surface: InboxPreferenceSurface, storage: PreferenceStorage | null = browserStorage()): InboxPreferences {
  const defaults = defaultPreferences(surface);
  const read = (name: BooleanPreference): boolean => {
    try {
      const value = storage?.getItem(keyOf(surface, name));
      return value === 'on' ? true : value === 'off' ? false : defaults[name];
    } catch {
      return defaults[name];
    }
  };
  return { ...defaults, sound: read('sound'), desktop: read('desktop') };
}

/** Lee ajustes previos para importarlos una sola vez a la cuenta; la bandeja ya no los usa como fuente de verdad. */
export function readLegacyPreferences(surface: InboxPreferenceSurface, storage: LegacyPreferenceStorage | null = browserStorage()): LegacyInboxPreferences | null {
  try {
    if (!storage) return null;
    const legacy: Partial<Record<BooleanPreference, boolean>> = {};
    for (const name of ['sound', 'desktop'] as const) {
      const value = storage.getItem(keyOf(surface, name));
      if (value === 'on') legacy[name] = true;
      if (value === 'off') legacy[name] = false;
    }
    return Object.keys(legacy).length > 0 ? legacy : null;
  } catch {
    return null;
  }
}

export function clearLegacyPreferences(surface: InboxPreferenceSurface, storage: (LegacyPreferenceStorage & Pick<Storage, 'removeItem'>) | null = browserStorage()): void {
  try {
    storage?.removeItem(keyOf(surface, 'sound'));
    storage?.removeItem(keyOf(surface, 'desktop'));
  } catch {
    // El servidor ya guardó la preferencia; un navegador sin storage puede seguir usando la cuenta.
  }
}

export function writePreference(surface: InboxPreferenceSurface, name: BooleanPreference, value: boolean, storage: PreferenceStorage | null = browserStorage()): void {
  try {
    storage?.setItem(keyOf(surface, name), value ? 'on' : 'off');
  } catch {
    // Sin almacenamiento, la preferencia dura sólo esta visita.
  }
}
