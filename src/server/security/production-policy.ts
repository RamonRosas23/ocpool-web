const DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const DEVELOPMENT_VALUES = new Set([
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
  'ocpool_minio',
  'ocpool_minio_dev',
]);

export type ProductionPolicyStatus = 'PASS' | 'BLOCKED';

export type ProductionPolicyCode =
  | 'APP_URL_INVALID'
  | 'APP_URL_NOT_HTTPS'
  | 'APP_URL_DEVELOPMENT_HOST'
  | 'EXAMPLE_ENCRYPTION_KEY'
  | 'SMTP_DEVELOPMENT_ENDPOINT'
  | 'SMTP_NOT_SECURE'
  | 'SMTP_DEVELOPMENT_SENDER'
  | 'STORAGE_DEVELOPMENT_ENDPOINT'
  | 'STORAGE_DEVELOPMENT_CREDENTIALS'
  | 'STORAGE_CONFIGURATION_MISSING';

export type ProductionPolicyResult = {
  status: ProductionPolicyStatus;
  blockingCodes: ProductionPolicyCode[];
  warnings: string[];
};

export type ProductionEnvironment = Readonly<Record<string, string | undefined>>;

function addCode(codes: ProductionPolicyCode[], code: ProductionPolicyCode): void {
  if (!codes.includes(code)) codes.push(code);
}

function isDevelopmentHost(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return DEVELOPMENT_HOSTS.has(new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function hasExampleValue(value: string | undefined): boolean {
  return value !== undefined && DEVELOPMENT_VALUES.has(value);
}

export function assertProductionPolicy(env: ProductionEnvironment): ProductionPolicyResult {
  const blockingCodes: ProductionPolicyCode[] = [];
  const warnings: string[] = [];

  let appUrl: URL | null = null;
  try {
    appUrl = new URL(env.APP_URL ?? '');
  } catch {
    addCode(blockingCodes, 'APP_URL_INVALID');
  }
  if (appUrl && appUrl.protocol !== 'https:') addCode(blockingCodes, 'APP_URL_NOT_HTTPS');
  if (appUrl && DEVELOPMENT_HOSTS.has(appUrl.hostname.toLowerCase())) addCode(blockingCodes, 'APP_URL_DEVELOPMENT_HOST');

  for (const key of ['MFA_ENCRYPTION_KEY', 'AUTH_DELIVERY_ENCRYPTION_KEY', 'NOTIFICATION_RECIPIENT_ENCRYPTION_KEY']) {
    if (hasExampleValue(env[key])) addCode(blockingCodes, 'EXAMPLE_ENCRYPTION_KEY');
  }

  const smtpHost = env.SMTP_HOST?.trim().toLowerCase();
  if (smtpHost && DEVELOPMENT_HOSTS.has(smtpHost)) addCode(blockingCodes, 'SMTP_DEVELOPMENT_ENDPOINT');
  if (env.SMTP_SECURE !== 'true') addCode(blockingCodes, 'SMTP_NOT_SECURE');
  if (env.SMTP_FROM_EMAIL?.trim().toLowerCase().endsWith('.local')) addCode(blockingCodes, 'SMTP_DEVELOPMENT_SENDER');

  const storageEndpoint = env.STORAGE_S3_ENDPOINT?.trim();
  if (!storageEndpoint || !env.STORAGE_S3_ACCESS_KEY || !env.STORAGE_S3_SECRET_KEY) {
    addCode(blockingCodes, 'STORAGE_CONFIGURATION_MISSING');
  }
  if (storageEndpoint && (isDevelopmentHost(storageEndpoint) || storageEndpoint.startsWith('http://'))) {
    addCode(blockingCodes, 'STORAGE_DEVELOPMENT_ENDPOINT');
  }
  if (hasExampleValue(env.STORAGE_S3_ACCESS_KEY) || hasExampleValue(env.STORAGE_S3_SECRET_KEY)) {
    addCode(blockingCodes, 'STORAGE_DEVELOPMENT_CREDENTIALS');
  }
  if (env.TRUST_PROXY_HEADERS !== 'true') warnings.push('TRUST_PROXY_REVIEW_REQUIRED');

  return {
    status: blockingCodes.length === 0 ? 'PASS' : 'BLOCKED',
    blockingCodes,
    warnings,
  };
}
