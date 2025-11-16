import { Elysia, t } from "elysia";
import { db } from "@quorum/db";
import { logger } from "../utils/logger";

interface HealthCheck {
	status: "healthy" | "unhealthy";
	timestamp: string;
	uptime: number;
	services: {
		database: "healthy" | "unhealthy";
		redis?: "healthy" | "unhealthy";
	};
}

export const healthRoutes = new Elysia({ prefix: "/health" })
	.get(
		"/",
		async (): Promise<HealthCheck> => {
			const timestamp = new Date().toISOString();
			const uptime = process.uptime();

			// Check database connection
			let dbStatus: "healthy" | "unhealthy" = "healthy";
			try {
				await db.$queryRaw`SELECT 1`;
			} catch (error) {
				logger.error("Database health check failed", error);
				dbStatus = "unhealthy";
			}

			const allHealthy = dbStatus === "healthy";

			return {
				status: allHealthy ? "healthy" : "unhealthy",
				timestamp,
				uptime,
				services: {
					database: dbStatus,
				},
			};
		},
		{
			detail: {
				tags: ["Health"],
				summary: "Health check endpoint",
				description: "Returns the health status of the API and its dependencies",
			},
			response: {
				200: t.Object({
					status: t.Union([t.Literal("healthy"), t.Literal("unhealthy")]),
					timestamp: t.String(),
					uptime: t.Number(),
					services: t.Object({
						database: t.Union([t.Literal("healthy"), t.Literal("unhealthy")]),
						redis: t.Optional(
							t.Union([t.Literal("healthy"), t.Literal("unhealthy")]),
						),
					}),
				}),
			},
		},
	)
	.get(
		"/ready",
		async ({ set }) => {
			// Check if all critical services are ready
			try {
				await db.$queryRaw`SELECT 1`;
				return { status: "ready" };
			} catch (error) {
				logger.error("Readiness check failed", error);
				set.status = 503;
				return { status: "not ready" };
			}
		},
		{
			detail: {
				tags: ["Health"],
				summary: "Readiness check",
				description: "Returns whether the API is ready to accept traffic",
			},
		},
	)
	.get(
		"/live",
		() => {
			return { status: "alive" };
		},
		{
			detail: {
				tags: ["Health"],
				summary: "Liveness check",
				description: "Returns whether the API is alive",
			},
		},
	);
