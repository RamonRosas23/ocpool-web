// "Solicitar cambios" del portal se envía como un mensaje de la conversación con un prefijo fijo por
// versión. Reconocerlo (en vez de un modelo aparte) permite que el portal diga "pediste cambios" y que
// el constructor de ventas muestre qué pidió el cliente, sin inventar un flujo paralelo.

export function changeRequestPrefix(versionNumber: number): string {
  return `Solicitud de cambios en la propuesta V${versionNumber}:`;
}

export function changeRequestBody(versionNumber: number, message: string): string {
  return `${changeRequestPrefix(versionNumber)}\n\n${message.trim()}`;
}

/** Lo que pidió el cliente, o `null` si el mensaje no es una petición de cambios de esa versión. */
export function parseChangeRequestBody(body: string, versionNumber: number): string | null {
  const prefix = changeRequestPrefix(versionNumber);
  return body.startsWith(prefix) ? body.slice(prefix.length).trim() : null;
}
