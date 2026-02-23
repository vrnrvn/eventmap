#!/usr/bin/env node
/**
 * Run promotional_notifications fix SQL against your Supabase database.
 *
 * 1. Get your DB URL: Supabase Dashboard → Project Settings → Database → Connection string (URI)
 * 2. Add to .env: DATABASE_URL="postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres"
 * 3. Run: node scripts/run-promotions-fix.js
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const envPath = path.join(__dirname, '..', '.env');
  const envLocalPath = path.join(__dirname, '..', 'admin', '.env.local');
  let databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    for (const p of [envPath, envLocalPath]) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        const match = content.match(/DATABASE_URL=(.+)/);
        if (match) {
          databaseUrl = match[1].trim().replace(/^["']|["']$/g, '');
          break;
        }
      }
    }
  }

  if (!databaseUrl) {
    console.error(`
No DATABASE_URL found. Two options:

1) Run via CLI (add your connection string):
   DATABASE_URL="postgresql://postgres.uigkbxyvrdzokgdyuclv:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres" npm run fix:promotions

2) Run SQL manually: https://supabase.com/dashboard/project/uigkbxyvrdzokgdyuclv/sql/new
   Paste contents of: supabase/scripts/fix_promotions_manual.sql
`);
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, '..', 'supabase', 'scripts', 'fix_promotions_manual.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    const { Client } = require('pg');
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(sql);
    await client.end();
    console.log('✓ promotional_notifications table and RPC created successfully.');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.error(`
Install pg: npm install pg
Then run: node scripts/run-promotions-fix.js
`);
    } else {
      console.error('Error:', err.message);
    }
    process.exit(1);
  }
}

main();
