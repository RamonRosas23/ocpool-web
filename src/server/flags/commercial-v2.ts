/**
 * Server-only rollout switches for the commercial V2 initiative.
 *
 * The approval guard is deliberately separate from the individual flags. A
 * typo or a stale per-flag value cannot activate a V2 surface unless the
 * operator also enables the explicit rollout approval variable. No consumer
 * imports this module until the corresponding G0/G1 gate is approved.
 */

export const COMMERCIAL_V2_FLAG_KEYS = [
  'commercialWorkspaceV2',
  'requestWorkspaceV2',
  'quoteBuilderV2',
  'quoteApprovalV1',
  'quotePublicationV2',
  'portalTimelineV2',
  'projectHandoffV1',
  'commercialTelemetry',
] as const;

export type CommercialV2FlagKey = (typeof COMMERCIAL_V2_FLAG_KEYS)[number];
export type CommercialV2Flags = Readonly<Record<CommercialV2FlagKey, boolean>>;
export type FlagEnvironment = Readonly<Record<string, string | undefined>>;

export const DEFAULT_COMMERCIAL_V2_FLAGS: CommercialV2Flags = Object.freeze({
  commercialWorkspaceV2: false,
  requestWorkspaceV2: false,
  quoteBuilderV2: false,
  quoteApprovalV1: false,
  quotePublicationV2: false,
  portalTimelineV2: false,
  projectHandoffV1: false,
  commercialTelemetry: false,
});

const approvalEnvironmentKey = 'OCPOOL_V2_FLAGS_APPROVED';

function environmentKey(flag: CommercialV2FlagKey): string {
  return `OCPOOL_V2_FLAG_${flag.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()}`;
}

export function readCommercialV2Flags(source: FlagEnvironment = process.env): CommercialV2Flags {
  const approved = source[approvalEnvironmentKey] === 'true';
  if (!approved) return DEFAULT_COMMERCIAL_V2_FLAGS;

  return Object.freeze(Object.fromEntries(
    COMMERCIAL_V2_FLAG_KEYS.map((flag) => [flag, source[environmentKey(flag)] === 'true']),
  )) as CommercialV2Flags;
}

export function commercialV2EnvironmentKey(flag: CommercialV2FlagKey): string {
  return environmentKey(flag);
}
