import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * `true` sólo cuando React ya hidrató el componente. Los formularios de acceso lo usan para no
 * permitir un envío nativo antes de que React tome el control: sin esto, un clic temprano enviaba
 * el formulario por GET y dejaba correo y contraseña en la URL (historial, logs de servidor).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
