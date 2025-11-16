import * as Sentry from "@sentry/bun";
import type { Env } from "../utils/env";
import { logger } from "../utils/logger";

export function initSentry(env: Env) {
	if (!env.SENTRY_DSN) {
		logger.info("Sentry DSN not configured, skipping Sentry initialization");
		return;
	}

	Sentry.init({
		dsn: env.SENTRY_DSN,
		environment: env.SENTRY_ENVIRONMENT,
		tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
		beforeSend(event) {
			// Remove sensitive data
			if (event.request?.headers) {
				delete event.request.headers.authorization;
				delete event.request.headers.cookie;
			}
			return event;
		},
	});

	logger.info(`Sentry initialized for environment: ${env.SENTRY_ENVIRONMENT}`);
}
