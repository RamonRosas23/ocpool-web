export type InboxPreferenceSurface = 'staff' | 'portal';
export type InboxPreferences = Readonly<{ sound: boolean; desktop: boolean }>;
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Spec §5.3: sonido encendido por defecto para el equipo y apagado para clientes; escritorio sólo si la persona lo activa. */
export function defaultPreferences(surface: InboxPreferenceSurface): InboxPreferences {
  return { sound: surface === 'staff', desktop: false };
}

function keyOf(surface: InboxPreferenceSurface, name: keyof InboxPreferences): string {
  return `ocpool.inbox.${surface}.${name}`;
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Hasta el bloque 5 viven en el navegador (spec §10); si el almacenamiento falla, rigen los valores por defecto. */
export function readPreferences(surface: InboxPreferenceSurface, storage: PreferenceStorage | null = browserStorage()): InboxPreferences {
  const defaults = defaultPreferences(surface);
  const read = (name: keyof InboxPreferences): boolean => {
    try {
      const value = storage?.getItem(keyOf(surface, name));
      return value === 'on' ? true : value === 'off' ? false : defaults[name];
    } catch {
      return defaults[name];
    }
  };
  return { sound: read('sound'), desktop: read('desktop') };
}

export function writePreference(surface: InboxPreferenceSurface, name: keyof InboxPreferences, value: boolean, storage: PreferenceStorage | null = browserStorage()): void {
  try {
    storage?.setItem(keyOf(surface, name), value ? 'on' : 'off');
  } catch {
    // Sin almacenamiento, la preferencia dura sólo esta visita.
  }
}
