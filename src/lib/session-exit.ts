// Esta pestaña está cerrando su propia sesión. El canal en vivo recibirá `bye` por esa misma sesión; la pestaña que
// la cerró ya muestra su salida (el portal dice "Cerraste tu sesión"), así que no se la redirige. Las demás pestañas
// del navegador sí vuelven a la pantalla de acceso. Dura lo que dura la página: al entrar de nuevo se reinicia.
let signingOut = false;

export function announceSignOut(): void {
  signingOut = true;
}

export function signOutAnnounced(): boolean {
  return signingOut;
}
