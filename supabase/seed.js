#!/usr/bin/env node
/**
 * eYKON.ai — db:seed runner
 * Runs supabase/seed/*.sql files in order against the Supabase
 * project. Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * from the env.
 *
 * Uses the PostgREST `rpc` endpoint indirectly via the Supabase SQL
 * endpoint — or, if `psql` is available on PATH, shells out to psql.
 * The psql path is preferred; we fall back to a simple statement-by-
 * statement executor over the REST `/sql` endpoint.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const SEED_DIR = path.join(__dirname, 'seed');
const POSTGRES_URL = process.env.POSTGRES_URL;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

function run() {
  if (!fs.existsSync(SEED_DIR)) {
    console.log('No supabase/seed/ directory — nothing to seed.');
    process.exit(0);
  }

  const files = fs
    .readdirSync(SEED_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No *.sql files in supabase/seed/ — nothing to seed.');
    process.exit(0);
  }

  const dbUrl = POSTGRES_URL || SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error(
      'Missing POSTGRES_URL or SUPABASE_DB_URL. Set one of these to the Postgres connection string' +
        ' (Supabase Dashboard → Project Settings → Database → Connection string).',
    );
    process.exit(1);
  }

  // Prefer psql when available.
  try {
    execSync('command -v psql', { stdio: 'ignore' });
  } catch {
    console.error(
      'psql not found on PATH. Install the Postgres client (`brew install libpq` on macOS) and try again,' +
        ' or run the SQL files manually in the Supabase SQL editor.',
    );
    process.exit(1);
  }

  for (const f of files) {
    const abs = path.join(SEED_DIR, f);
    console.log(`→ ${f}`);
    execSync(`psql "${dbUrl}" -v ON_ERROR_STOP=1 -f "${abs}"`, { stdio: 'inherit' });
  }

  console.log('Seed complete.');
}

run();
