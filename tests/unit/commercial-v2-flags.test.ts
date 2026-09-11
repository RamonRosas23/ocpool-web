import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_V2_FLAG_KEYS,
  DEFAULT_COMMERCIAL_V2_FLAGS,
  commercialV2EnvironmentKey,
  readCommercialV2Flags,
} from '@/server/flags/commercial-v2';

describe('commercial V2 rollout flags', () => {
  it('fails closed with every flag disabled by default', () => {
    expect(readCommercialV2Flags({})).toEqual(DEFAULT_COMMERCIAL_V2_FLAGS);
    expect(Object.values(readCommercialV2Flags({})).every((value) => value === false)).toBe(true);
  });

  it('does not allow a per-flag value to bypass the approval guard', () => {
    expect(readCommercialV2Flags({ OCPOOL_V2_FLAG_COMMERCIAL_WORKSPACE_V2: 'true' }).commercialWorkspaceV2).toBe(false);
    expect(readCommercialV2Flags({
      OCPOOL_V2_FLAGS_APPROVED: 'false',
      OCPOOL_V2_FLAG_COMMERCIAL_WORKSPACE_V2: 'true',
    }).commercialWorkspaceV2).toBe(false);
  });

  it('enables only explicitly approved flags and ignores non-canonical values', () => {
    const flags = readCommercialV2Flags({
      OCPOOL_V2_FLAGS_APPROVED: 'true',
      OCPOOL_V2_FLAG_COMMERCIAL_WORKSPACE_V2: 'true',
      OCPOOL_V2_FLAG_REQUEST_WORKSPACE_V2: '1',
      OCPOOL_V2_FLAG_QUOTE_BUILDER_V2: 'TRUE',
      OCPOOL_V2_FLAG_QUOTE_APPROVAL_V1: 'true',
      OCPOOL_V2_FLAG_QUOTE_PUBLICATION_V2: 'true',
      OCPOOL_V2_FLAG_PORTAL_TIMELINE_V2: 'false',
      OCPOOL_V2_FLAG_PROJECT_HANDOFF_V1: 'true',
      OCPOOL_V2_FLAG_COMMERCIAL_TELEMETRY: 'true',
    });

    expect(flags).toEqual({
      commercialWorkspaceV2: true,
      requestWorkspaceV2: false,
      quoteBuilderV2: false,
      quoteApprovalV1: true,
      quotePublicationV2: true,
      portalTimelineV2: false,
      projectHandoffV1: true,
      commercialTelemetry: true,
    });
  });

  it('keeps the environment contract explicit and stable', () => {
    expect(COMMERCIAL_V2_FLAG_KEYS.map(commercialV2EnvironmentKey)).toEqual([
      'OCPOOL_V2_FLAG_COMMERCIAL_WORKSPACE_V2',
      'OCPOOL_V2_FLAG_REQUEST_WORKSPACE_V2',
      'OCPOOL_V2_FLAG_QUOTE_BUILDER_V2',
      'OCPOOL_V2_FLAG_QUOTE_APPROVAL_V1',
      'OCPOOL_V2_FLAG_QUOTE_PUBLICATION_V2',
      'OCPOOL_V2_FLAG_PORTAL_TIMELINE_V2',
      'OCPOOL_V2_FLAG_PROJECT_HANDOFF_V1',
      'OCPOOL_V2_FLAG_COMMERCIAL_TELEMETRY',
    ]);
  });
});
