'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

const QUIET_ZONE = 4;

/**
 * QR de la clave de verificación, dibujado aquí mismo como un solo trazo SVG: la clave nunca sale del
 * navegador hacia un servicio de imágenes. Fondo blanco fijo para que cualquier cámara lo lea.
 */
export default function TotpQrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    const segments: string[] = [];
    for (let row = 0; row < count; row += 1) {
      let column = 0;
      while (column < count) {
        if (!code.isDark(row, column)) { column += 1; continue; }
        const start = column;
        while (column < count && code.isDark(row, column)) column += 1;
        segments.push(`M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${column - start}v1h-${column - start}z`);
      }
    }
    return { size: count + QUIET_ZONE * 2, path: segments.join('') };
  }, [value]);

  return <svg className="account-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
    <rect width={size} height={size} fill="#fff" />
    <path d={path} fill="#101418" />
  </svg>;
}
