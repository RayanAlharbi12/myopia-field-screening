// Concatenates supabase/migrations/*.sql (in order) into supabase/setup.sql.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const head = `-- =====================================================================
-- Myopia Field Screening — Phase 2 — consolidated database setup
-- Generated from supabase/migrations (${files.join(', ')}).
-- Run once in the Supabase SQL Editor of a NEW, dedicated project.
-- Safe to re-run: objects are created idempotently.
-- Creates no users, no schools, no participants (no demo data).
-- =====================================================================
`;
const body = files.map((f) => `\n-- >>>>> ${f}\n` + readFileSync(join(dir, f), 'utf8')).join('\n');
writeFileSync(join(root, 'supabase', 'setup.sql'), head + body);
console.log('supabase/setup.sql written from', files.length, 'migrations');
