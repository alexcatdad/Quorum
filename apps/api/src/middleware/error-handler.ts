import type { Elysia } from "elysia";
import { AppError } from "../types/errors";
import { logger } from "../utils/logger";
import * as Sentry from "@sentry/bun";

export interface ErrorResponse {
	error: {
		code: string;
		message: string;
		details?: unknown;
		requestId?: string;
	};
}

export function errorHandler(app: Elysia) {
	return app.onError(({ code, error, set, request }) => {
		const requestId = request.headers.get("x-request-id") || crypto.randomUUID();

		// Handle AppError instances
		if (error instanceof AppError) {
			set.status = error.statusCode;

			logger.warn({
				requestId,
				code: error.code,
				message: error.message,
				statusCode: error.statusCode,
				path: new URL(request.url).pathname,
			});

			return {
				error: {
					code: error.code,
					message: error.message,
					details: error.details,
					requestId,
				},
			} satisfies ErrorResponse;
		}

		// Handle validation errors from Elysia
		if (code === "VALIDATION") {
			set.status = 400;

			logger.warn({
				requestId,
				code: "VALIDATION_ERROR",
				message: error.message,
				path: new URL(request.url).pathname,
			});

			return {
				error: {
					code: "VALIDATION_ERROR",
					message: "Request validation failed",
					details: error,
					requestId,
				},
			} satisfies ErrorResponse;
		}

		// Handle not found
		if (code === "NOT_FOUND") {
			set.status = 404;

			return {
				error: {
					code: "NOT_FOUND",
					message: "Route not found",
					requestId,
				},
			} satisfies ErrorResponse;
		}

		// Handle all other errors as internal server errors
		set.status = 500;

		logger.error({
			requestId,
			error: error.message,
			stack: error.stack,
			path: new URL(request.url).pathname,
		});

		// Send to Sentry
		Sentry.captureException(error, {
			tags: {
				requestId,
				path: new URL(request.url).pathname,
			},
		});

		return {
			error: {
				code: "INTERNAL_ERROR",
				message: "An internal server error occurred",
				requestId,
			},
		} satisfies ErrorResponse;
	});
}
