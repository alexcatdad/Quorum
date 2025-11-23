/**
 * Quorum Database Client
 *
 * Exports a singleton PrismaClient instance for use across the application.
 * This ensures only one database connection pool is created.
 */

import { PrismaClient } from "@prisma/client";

// Prevent multiple instances of Prisma Client in development
declare global {
	// eslint-disable-next-line no-var
	var prisma: PrismaClient | undefined;
}

// Create singleton instance
// biome-ignore lint/suspicious/noRedeclare: Global singleton pattern for Prisma
export const prisma =
	global.prisma ||
	new PrismaClient({
		log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
	});

// In development, save the instance to prevent hot-reload issues
if (process.env.NODE_ENV !== "production") {
	global.prisma = prisma;
}

// Export Prisma types for use in other packages
export * from "@prisma/client";

// Graceful shutdown handler
async function shutdown() {
	await prisma.$disconnect();
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Alias for backward compatibility
export { prisma as db };

// Default export
export default prisma;
