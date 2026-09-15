export type UploadStage = 'reserve' | 'storage' | 'complete';

export function shouldResetUploadIdempotencyKey(stage: UploadStage, status?: number): boolean {
  return stage === 'complete' && status === 400;
}
