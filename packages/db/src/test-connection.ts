/**
 * Database Connection Test Script
 *
 * Tests the database connection and performs basic CRUD operations
 * to verify that the schema is working correctly.
 */

import { prisma } from "./index";

async function testConnection() {
	try {
		await prisma.$queryRaw`SELECT 1`;
		const org = await prisma.organization.create({
			data: {
				name: "Test Organization",
				slug: `test-org-${Date.now()}`,
			},
		});
		const user = await prisma.user.create({
			data: {
				email: `test-${Date.now()}@example.com`,
				name: "Test User",
				organizationId: org.id,
				role: "ADMIN",
			},
		});
		const meeting = await prisma.meeting.create({
			data: {
				organizationId: org.id,
				platform: "TEAMS",
				url: "https://teams.microsoft.com/l/meetup-join/test",
				scheduledStart: new Date(),
				status: "PENDING",
			},
		});
		const _orgWithRelations = await prisma.organization.findUnique({
			where: { id: org.id },
			include: {
				users: true,
				meetings: true,
			},
		});
		await prisma.meeting.delete({ where: { id: meeting.id } });
		await prisma.user.delete({ where: { id: user.id } });
		await prisma.organization.delete({ where: { id: org.id } });
	} finally {
		await prisma.$disconnect();
	}
}

// Run the test
testConnection()
	.then(() => {
		process.exit(0);
	})
	.catch((_error) => {
		process.exit(1);
	});
