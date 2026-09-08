import 'dotenv/config';
import { readServerEnv } from '../src/server/env';
import { assertProductionPolicy, type ProductionPolicyCode } from '../src/server/security/production-policy';

const policy = assertProductionPolicy(process.env);
const blockingCodes = [...policy.blockingCodes] as Array<ProductionPolicyCode | 'ENV_SCHEMA_INVALID'>;

try {
  readServerEnv();
} catch {
  blockingCodes.push('ENV_SCHEMA_INVALID');
}

const uniqueBlockingCodes = [...new Set(blockingCodes)];
const report = {
  status: uniqueBlockingCodes.length === 0 ? 'PASS' : 'BLOCKED',
  blockingCodes: uniqueBlockingCodes,
  warnings: policy.warnings,
};

console.log(JSON.stringify(report));
process.exitCode = report.status === 'PASS' ? 0 : 1;
