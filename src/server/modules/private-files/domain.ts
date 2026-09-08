export const FILE_CATEGORIES = [
  'REFERENCE_IMAGE',
  'TECHNICAL_DOCUMENT',
  'CLIENT_DOCUMENT',
  'INTERNAL_DOCUMENT',
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const FILE_VISIBILITIES = ['CUSTOMER', 'INTERNAL'] as const;
export type FileVisibility = (typeof FILE_VISIBILITIES)[number];

export const FILE_STATUSES = ['PENDING_SCAN', 'AVAILABLE', 'REJECTED', 'DELETED'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const FILE_MAX_BYTES = 25 * 1024 * 1024;
export const FILE_MAX_NAME_LENGTH = 180;

export const ALLOWED_FILE_TYPES = [
  { extension: 'pdf', contentType: 'application/pdf' },
  { extension: 'jpg', contentType: 'image/jpeg' },
  { extension: 'jpeg', contentType: 'image/jpeg' },
  { extension: 'png', contentType: 'image/png' },
  { extension: 'webp', contentType: 'image/webp' },
] as const;

const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/gu;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type UploadMetadata = Readonly<{
  originalFileName: string;
  contentType: string;
  byteSize: number;
  category: FileCategory;
  visibility: FileVisibility;
}>;

function invalidFile(message = 'Invalid private file.'): never {
  throw new Error(message);
}

export function normalizeOriginalFileName(value: string): string {
  if (typeof value !== 'string') return invalidFile();
  const withoutControls = value.normalize('NFC').replace(DISALLOWED_CONTROL_CHARACTERS, '');
  const basename = withoutControls.replaceAll('\\', '/').split('/').pop()?.trim() ?? '';
  if (!basename || basename === '.' || basename === '..' || basename.length > FILE_MAX_NAME_LENGTH) return invalidFile();
  return basename;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0 || index === fileName.length - 1) return '';
  return fileName.slice(index + 1).toLowerCase();
}

function isFileCategory(value: string): value is FileCategory {
  return (FILE_CATEGORIES as readonly string[]).includes(value);
}

function isFileVisibility(value: string): value is FileVisibility {
  return (FILE_VISIBILITIES as readonly string[]).includes(value);
}

export function assertUploadMetadata(input: UploadMetadata): UploadMetadata {
  const originalFileName = normalizeOriginalFileName(input.originalFileName);
  const contentType = input.contentType.trim().toLowerCase();
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > FILE_MAX_BYTES) return invalidFile('Invalid private file size.');
  if (!isFileCategory(input.category) || !isFileVisibility(input.visibility)) return invalidFile('Invalid private file classification.');
  if (input.category === 'INTERNAL_DOCUMENT' && input.visibility !== 'INTERNAL') return invalidFile('Internal documents cannot be customer-visible.');
  const extension = extensionOf(originalFileName);
  const allowed = ALLOWED_FILE_TYPES.find((candidate) => candidate.extension === extension && candidate.contentType === contentType);
  if (!allowed) return invalidFile('File type is not allowed.');
  return { originalFileName, contentType: allowed.contentType, byteSize: input.byteSize, category: input.category, visibility: input.visibility };
}

const FILE_STATUS_TRANSITIONS: Record<FileStatus, readonly FileStatus[]> = {
  PENDING_SCAN: ['AVAILABLE', 'REJECTED', 'DELETED'],
  AVAILABLE: ['DELETED'],
  REJECTED: ['DELETED'],
  DELETED: [],
};

export function canTransitionFileStatus(from: FileStatus, to: FileStatus): boolean {
  return FILE_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isFileDeliverable(status: FileStatus): boolean {
  return status === 'AVAILABLE';
}

export function buildStorageKey(attachmentId: string): string {
  if (!UUID_PATTERN.test(attachmentId)) return invalidFile('Invalid private file identifier.');
  return `private-files/${attachmentId}`;
}
