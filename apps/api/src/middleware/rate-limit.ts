import type { Elysia } from "elysia";
import { RateLimitError } from "../types/errors";

interface RateLimitStore {
	[key: string]: {
		count: number;
		resetTime: number;
	};
}

const rateLimitStore: RateLimitStore = {};

// Cleanup old entries every minute
setInterval(() => {
	const now = Date.now();
	for (const key in rateLimitStore) {
		if (rateLimitStore[key].resetTime < now) {
			delete rateLimitStore[key];
		}
	}
}, 60000);

export interface RateLimitOptions {
	windowMs?: number; // Time window in milliseconds
	maxRequests?: number; // Max requests per window
	keyGenerator?: (request: Request) => string; // Custom key generator
}

export function rateLimit(options: RateLimitOptions = {}) {
	const {
		windowMs = 15 * 60 * 1000, // 15 minutes default
		maxRequests = 100, // 100 requests default
		keyGenerator = (request: Request) => {
			// Default: use IP address
			const forwarded = request.headers.get("x-forwarded-for");
			const ip = forwarded ? forwarded.split(",")[0] : "unknown";
			return ip;
		},
	} = options;

	return (app: Elysia) => {
		return app.onBeforeHandle(({ request, set }) => {
			const key = keyGenerator(request);
			const now = Date.now();

			if (!rateLimitStore[key] || rateLimitStore[key].resetTime < now) {
				// Initialize or reset
				rateLimitStore[key] = {
					count: 1,
					resetTime: now + windowMs,
				};
			} else {
				// Increment count
				rateLimitStore[key].count++;

				if (rateLimitStore[key].count > maxRequests) {
					const resetIn = Math.ceil((rateLimitStore[key].resetTime - now) / 1000);

					// Set rate limit headers
					set.headers["X-RateLimit-Limit"] = maxRequests.toString();
					set.headers["X-RateLimit-Remaining"] = "0";
					set.headers["X-RateLimit-Reset"] = rateLimitStore[key].resetTime.toString();
					set.headers["Retry-After"] = resetIn.toString();

					throw new RateLimitError(`Rate limit exceeded. Try again in ${resetIn} seconds.`);
				}
			}

			// Set rate limit headers
			const remaining = maxRequests - rateLimitStore[key].count;
			set.headers["X-RateLimit-Limit"] = maxRequests.toString();
			set.headers["X-RateLimit-Remaining"] = remaining.toString();
			set.headers["X-RateLimit-Reset"] = rateLimitStore[key].resetTime.toString();
		});
	};
}

// Per-user rate limiting (requires auth)
export function perUserRateLimit(options: RateLimitOptions = {}) {
	return rateLimit({
		...options,
		keyGenerator: (request: Request) => {
			const authHeader = request.headers.get("authorization");
			if (!authHeader) return "anonymous";

			// Extract user ID from JWT (simplified)
			const token = authHeader.replace("Bearer ", "");
			// In production, decode JWT to get user ID
			return `user:${token.substring(0, 10)}`;
		},
	});
}

// Per-organization rate limiting
export function perOrgRateLimit(options: RateLimitOptions = {}) {
	return rateLimit({
		...options,
		keyGenerator: (request: Request) => {
			// Extract organization ID from request (from auth context)
			// This is a simplified version
			const authHeader = request.headers.get("authorization");
			if (!authHeader) return "anonymous";

			return `org:${authHeader.substring(0, 10)}`;
		},
	});
}
