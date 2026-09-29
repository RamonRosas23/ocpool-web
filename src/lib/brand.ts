/**
 * Identidad de OCPOOL compartida por el sitio, los correos y los documentos: una sola fuente para el
 * contacto, el lema y la paleta, para que un cambio de teléfono no deje desactualizado un correo o un PDF.
 */
export const brandContact = {
  email: 'contacto@ocpool.com.mx',
  phone: '667 453 2567',
  phoneHref: 'tel:+526674532567',
  whatsappHref: 'https://wa.me/526674532567',
  website: 'https://ocpool.com.mx',
} as const;

export const brandIdentity = {
  name: 'OCPOOL',
  tagline: 'Diseño, obra y sistemas coordinados.',
} as const;

/**
 * Paleta del sitio público: marino, marfil y bronce. `bronzeText` es el bronce oscurecido para
 * etiquetas pequeñas (5.3:1 sobre blanco); `bronze` queda para filetes y acentos.
 */
export const brandColors = {
  navy: '#0B2736',
  ink: '#18252A',
  muted: '#5B6770',
  ivory: '#F4F1EA',
  paper: '#F9F7F2',
  line: '#E6E0D4',
  bronze: '#B88A4A',
  bronzeText: '#8A6530',
  white: '#FFFFFF',
} as const;

/** El sitio sin protocolo ("ocpool.com.mx"), como se escribe en un pie de página. */
export const brandWebsiteLabel = new URL(brandContact.website).host;
