import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { loadEnv } from "./utils/env";
import { logger } from "./utils/logger";
import { errorHandler } from "./middleware/error-handler";
import { loggingMiddleware } from "./middleware/logging";
import { initSentry } from "./services/sentry";
import { healthRoutes } from "./routes/health";
import { metricsRoutes } from "./routes/metrics";
import { organizationsRoutes } from "./routes/organizations";
import { usersRoutes } from "./routes/users";
import { botAccountsRoutes } from "./routes/bot-accounts";
import { meetingsRoutes } from "./routes/meetings";
import { recordingsRoutes } from "./routes/recordings";
import { authRoutes } from "./routes/auth";
import { jobsRoutes } from "./routes/jobs";
import { gdprRoutes } from "./routes/gdpr";
import { websocketService } from "./services/websocket";
import { rateLimit } from "./middleware/rate-limit";
import { initializeMinIOBuckets } from "./services/minio-init";
import "./services/retention"; // Initialize retention policy scheduler

// Load environment variables
const env = loadEnv();

// Initialize Sentry
initSentry(env);

// Initialize MinIO buckets
initializeMinIOBuckets(env).catch((error) => {
	logger.error("Failed to initialize MinIO buckets", error);
	// Continue anyway - buckets might already exist or will be created later
});

// Create Elysia app
const app = new Elysia()
	.use(
		cors({
			origin: env.CORS_ORIGIN,
			credentials: true,
		}),
	)
	.use(loggingMiddleware)
	.use(errorHandler)
	.use(
		rateLimit({
			windowMs: 15 * 60 * 1000, // 15 minutes
			maxRequests: 100,
		}),
	);

// Add Swagger documentation if enabled
if (env.ENABLE_SWAGGER) {
	app.use(
		swagger({
			documentation: {
				info: {
					title: "Quorum API",
					version: "1.0.0",
					description:
						"Distributed meeting recording system API for Microsoft Teams, Slack Huddles, and YouTube",
				},
				tags: [
					{ name: "Health", description: "Health check endpoints" },
					{ name: "Metrics", description: "Prometheus metrics" },
					{ name: "Auth", description: "Authentication endpoints" },
					{ name: "Organizations", description: "Organization management" },
					{ name: "Users", description: "User management" },
					{ name: "BotAccounts", description: "Bot account management" },
					{ name: "Meetings", description: "Meeting recording management" },
					{ name: "Recordings", description: "Recording artifact management" },
					{ name: "Jobs", description: "Job queue management" },
					{ name: "GDPR", description: "GDPR compliance endpoints" },
				],
				components: {
					securitySchemes: {
						bearerAuth: {
							type: "http",
							scheme: "bearer",
							bearerFormat: "JWT",
						},
					},
				},
			},
		}),
	);
}

// Register routes
app.use(healthRoutes);

if (env.ENABLE_METRICS) {
	app.use(metricsRoutes);
}

// API routes
app.use(authRoutes);
app.use(organizationsRoutes);
app.use(usersRoutes);
app.use(botAccountsRoutes);
app.use(meetingsRoutes);
app.use(recordingsRoutes);
app.use(jobsRoutes);
app.use(gdprRoutes);

// WebSocket endpoint
app.ws("/ws", {
	open(ws) {
		const connectionId = websocketService.handleConnection(ws as any);
		(ws as any).connectionId = connectionId;
	},
	message(ws, message) {
		websocketService.handleMessage(ws as any, message.toString());
	},
	close(ws) {
		const connectionId = (ws as any).connectionId;
		if (connectionId) {
			websocketService.handleDisconnection(connectionId);
		}
	},
});

// Start server
app.listen(env.PORT, () => {
	logger.info(`🚀 Quorum API server started on port ${env.PORT}`);
	logger.info(`📚 Environment: ${env.NODE_ENV}`);
	if (env.ENABLE_SWAGGER) {
		logger.info(`📖 Swagger docs available at http://localhost:${env.PORT}/swagger`);
	}
	if (env.ENABLE_METRICS) {
		logger.info(`📊 Metrics available at http://localhost:${env.PORT}/metrics`);
	}
});

export default app;
export type App = typeof app;
