#!/usr/bin/env node
/**
 * eYKON.ai — db:migrate runner
 * Runs supabase/migrations/*.sql in filename order against the
 * Postgres connection string in POSTGRES_URL or SUPABASE_DB_URL.
 * Idempotent — migrations use IF NOT EXISTS throughout.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const DB_URL = process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;

if (!DB_URL) {
  console.error('Missing POSTGRES_URL or SUPABASE_DB_URL.');
  process.exit(1);
}

try {
  execSync('command -v psql', { stdio: 'ignore' });
} catch {
  console.error('psql not found on PATH. Install the Postgres client.');
  process.exit(1);
}

const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
if (files.length === 0) {
  console.log('No migrations found.');
  process.exit(0);
}

for (const f of files) {
  const abs = path.join(MIGRATIONS_DIR, f);
  console.log(`→ ${f}`);
  execSync(`psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${abs}"`, { stdio: 'inherit' });
}

console.log('Migrations complete.');
