import 'dotenv/config';

const required = process.argv.slice(2);
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error('Missing required environment variables: ' + missing.join(', '));
  process.exit(1);
}
