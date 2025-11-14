/**
 * Database Connection Test Script
 *
 * Tests the database connection and performs basic CRUD operations
 * to verify that the schema is working correctly.
 */

import { prisma } from "./index";

async function testConnection() {
  console.log("Testing database connection...\n");

  try {
    // Test 1: Check database connection
    console.log("[1/5] Testing database connection...");
    await prisma.$queryRaw`SELECT 1`;
    console.log("✓ Database connection successful\n");

    // Test 2: Create test organization
    console.log("[2/5] Creating test organization...");
    const org = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: "test-org-" + Date.now(),
      },
    });
    console.log(`✓ Organization created: ${org.name} (${org.id})\n`);

    // Test 3: Create test user
    console.log("[3/5] Creating test user...");
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: "Test User",
        organizationId: org.id,
        role: "ADMIN",
      },
    });
    console.log(`✓ User created: ${user.name} (${user.email})\n`);

    // Test 4: Create test meeting
    console.log("[4/5] Creating test meeting...");
    const meeting = await prisma.meeting.create({
      data: {
        organizationId: org.id,
        platform: "TEAMS",
        url: "https://teams.microsoft.com/l/meetup-join/test",
        scheduledStart: new Date(),
        status: "PENDING",
      },
    });
    console.log(`✓ Meeting created: ${meeting.id} (${meeting.platform})\n`);

    // Test 5: Query with relations
    console.log("[5/5] Testing queries with relations...");
    const orgWithRelations = await prisma.organization.findUnique({
      where: { id: org.id },
      include: {
        users: true,
        meetings: true,
      },
    });
    console.log(
      `✓ Organization with ${orgWithRelations?.users.length} users and ${orgWithRelations?.meetings.length} meetings\n`
    );

    // Cleanup
    console.log("Cleaning up test data...");
    await prisma.meeting.delete({ where: { id: meeting.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    console.log("✓ Test data cleaned up\n");

    console.log("✅ All tests passed! Database is ready to use.\n");
    console.log("Schema Summary:");
    console.log("  - Organizations: Multi-tenant root entity");
    console.log("  - Users: Authenticated individuals with roles");
    console.log("  - BotAccounts: Platform credentials for recording");
    console.log("  - Meetings: Recording sessions");
    console.log("  - Recordings: Completed artifacts");
    console.log("  - AuditLogs: Operation tracking");
  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testConnection()
  .then(() => {
    console.log("\n✅ Database test completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Database test failed:", error);
    process.exit(1);
  });
