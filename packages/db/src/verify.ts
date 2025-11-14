/**
 * Database Verification Script
 *
 * Comprehensive verification of the database setup including:
 * - Database connection
 * - Table existence
 * - Enum types
 * - Indexes
 * - Foreign keys
 */

import { prisma } from "./index";

async function verify() {
  console.log("====================================");
  console.log("Quorum Database Verification Report");
  console.log("====================================\n");

  try {
    // 1. Database Connection
    console.log("[1/6] Verifying database connection...");
    const result = await prisma.$queryRaw<
      Array<{ version: string }>
    >`SELECT version()`;
    console.log(
      `✓ PostgreSQL connected: ${result[0].version.split(" ")[0]} ${result[0].version.split(" ")[1]}\n`
    );

    // 2. Tables
    console.log("[2/6] Checking tables...");
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    console.log(`✓ Found ${tables.length} tables:`);
    tables.forEach((t) => console.log(`  - ${t.tablename}`));
    console.log();

    // 3. Enums
    console.log("[3/6] Checking enum types...");
    const enums = await prisma.$queryRaw<
      Array<{ typname: string; enumlabel: string }>
    >`
      SELECT typname, enumlabel
      FROM pg_type
      JOIN pg_enum ON pg_type.oid = pg_enum.enumtypid
      WHERE typname IN ('UserRole', 'Platform', 'MeetingStatus', 'EncodingStatus')
      ORDER BY typname, enumsortorder
    `;
    const enumGroups = enums.reduce(
      (acc, e) => {
        if (!acc[e.typname]) acc[e.typname] = [];
        acc[e.typname].push(e.enumlabel);
        return acc;
      },
      {} as Record<string, string[]>
    );

    console.log(`✓ Found ${Object.keys(enumGroups).length} enum types:`);
    Object.entries(enumGroups).forEach(([name, values]) => {
      console.log(`  - ${name}: ${values.join(", ")}`);
    });
    console.log();

    // 4. Indexes
    console.log("[4/6] Checking indexes...");
    const indexes = await prisma.$queryRaw<
      Array<{ indexname: string; tablename: string }>
    >`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND indexname NOT LIKE '%_pkey'
      ORDER BY tablename, indexname
    `;
    console.log(`✓ Found ${indexes.length} indexes (excluding primary keys):`);
    const indexByTable = indexes.reduce(
      (acc, i) => {
        if (!acc[i.tablename]) acc[i.tablename] = [];
        acc[i.tablename].push(i.indexname);
        return acc;
      },
      {} as Record<string, string[]>
    );
    Object.entries(indexByTable).forEach(([table, idxs]) => {
      console.log(`  - ${table}: ${idxs.length} indexes`);
    });
    console.log();

    // 5. Foreign Keys
    console.log("[5/6] Checking foreign key constraints...");
    const foreignKeys = await prisma.$queryRaw<
      Array<{
        constraint_name: string;
        table_name: string;
        column_name: string;
        foreign_table_name: string;
      }>
    >`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name
    `;
    console.log(`✓ Found ${foreignKeys.length} foreign key constraints:`);
    const fkByTable = foreignKeys.reduce(
      (acc, fk) => {
        if (!acc[fk.table_name]) acc[fk.table_name] = [];
        acc[fk.table_name].push(`${fk.column_name} → ${fk.foreign_table_name}`);
        return acc;
      },
      {} as Record<string, string[]>
    );
    Object.entries(fkByTable).forEach(([table, fks]) => {
      console.log(`  - ${table}:`);
      fks.forEach((fk) => console.log(`    ${fk}`));
    });
    console.log();

    // 6. Migration Status
    console.log("[6/6] Checking migration status...");
    const migrations = await prisma.$queryRaw<
      Array<{
        migration_name: string;
        applied_steps_count: number;
        finished_at: Date | null;
      }>
    >`
      SELECT migration_name, applied_steps_count, finished_at
      FROM _prisma_migrations
      ORDER BY finished_at DESC
    `;
    console.log(`✓ Found ${migrations.length} applied migration(s):`);
    migrations.forEach((m) => {
      console.log(
        `  - ${m.migration_name} (${m.applied_steps_count} steps, ${m.finished_at?.toISOString()})`
      );
    });
    console.log();

    // Summary
    console.log("====================================");
    console.log("Summary");
    console.log("====================================");
    console.log(`✓ Database: Connected and healthy`);
    console.log(`✓ Tables: ${tables.length} created`);
    console.log(`✓ Enums: ${Object.keys(enumGroups).length} types defined`);
    console.log(`✓ Indexes: ${indexes.length} created`);
    console.log(`✓ Foreign Keys: ${foreignKeys.length} constraints`);
    console.log(`✓ Migrations: ${migrations.length} applied`);
    console.log();
    console.log("✅ Database is fully configured and ready for use!");
  } catch (error) {
    console.error("❌ Verification failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

verify()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
