import { receiveStorageUpload, serveStorageDownload } from '@/server/modules/private-files/storage-gateway';

// Descargas y subidas de archivos privados por enlace firmado (ver storage-url.ts): la autorización
// es la firma del enlace, emitida por las rutas que sí validan sesión y alcance del expediente.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return serveStorageDownload(request);
}

export async function PUT(request: Request) {
  return receiveStorageUpload(request);
}
