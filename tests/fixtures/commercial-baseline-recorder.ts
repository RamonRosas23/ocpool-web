import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BaselineMeasurementRecord } from './commercial-baseline-v2';
import { validateBaselineMeasurementRecord } from './commercial-baseline-v2';

/**
 * Writes only opt-in, synthetic baseline samples. Production/runtime code must
 * never import this helper.
 */
export async function recordBaselineMeasurement(record: BaselineMeasurementRecord): Promise<string | null> {
  if (process.env.BASELINE_MEASUREMENTS_E2E !== '1') return null;
  const errors = validateBaselineMeasurementRecord(record);
  if (errors.length > 0) throw new Error(`Invalid baseline measurement: ${errors.join('; ')}`);
  const outputDirectory = path.resolve(process.env.BASELINE_OUTPUT_DIR ?? 'test-results/commercial-baseline');
  await mkdir(outputDirectory, { recursive: true });
  const fileName = `${record.metricId}-${record.scenarioId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filePath = path.join(outputDirectory, fileName);
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return filePath;
}
