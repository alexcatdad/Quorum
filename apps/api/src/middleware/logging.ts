import type { Elysia } from "elysia";
import { logger } from "../utils/logger";
import { httpRequestsTotal, httpRequestDuration } from "../utils/metrics";

export function loggingMiddleware(app: Elysia) {
	return app
		.onRequest(({ request, store }) => {
			const startTime = Date.now();
			(store as any).startTime = startTime;
			(store as any).requestId = request.headers.get("x-request-id") || crypto.randomUUID();
		})
		.onAfterResponse(({ request, set, store }) => {
			const startTime = (store as any).startTime;
			const requestId = (store as any).requestId;
			const duration = (Date.now() - startTime) / 1000;

			const method = request.method;
			const path = new URL(request.url).pathname;
			const status = set.status || 200;

			// Log request
			logger.info({
				requestId,
				method,
				path,
				status,
				duration: `${duration.toFixed(3)}s`,
			});

			// Update metrics
			httpRequestsTotal.inc({
				method,
				route: path,
				status: status.toString(),
			});

			httpRequestDuration.observe(
				{
					method,
					route: path,
					status: status.toString(),
				},
				duration,
			);
		});
}
