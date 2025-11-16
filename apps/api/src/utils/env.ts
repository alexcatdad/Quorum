import { logger } from "./logger";

export interface Env {
	// Server
	PORT: number;
	NODE_ENV: string;
	CORS_ORIGIN: string;

	// Database
	DATABASE_URL: string;

	// Redis
	REDIS_HOST: string;
	REDIS_PORT: number;
	REDIS_PASSWORD?: string;

	// MinIO / S3
	MINIO_ENDPOINT: string;
	MINIO_PORT: number;
	MINIO_ACCESS_KEY: string;
	MINIO_SECRET_KEY: string;
	MINIO_USE_SSL: boolean;
	MINIO_BUCKET_NAME: string;

	// JWT
	JWT_SECRET: string;
	JWT_ISSUER: string;
	JWT_AUDIENCE: string;

	// Sentry
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT: string;

	// Features
	ENABLE_SWAGGER: boolean;
	ENABLE_METRICS: boolean;
}

function parseBoolean(value: string | undefined, defaultValue = false): boolean {
	if (!value) return defaultValue;
	return value.toLowerCase() === "true" || value === "1";
}

function parseNumber(value: string | undefined, defaultValue: number): number {
	if (!value) return defaultValue;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? defaultValue : parsed;
}

function requireEnv(key: string): string {
	const value = process.env[key];
	if (!value) {
		logger.error(`Missing required environment variable: ${key}`);
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
}

export function loadEnv(): Env {
	return {
		// Server
		PORT: parseNumber(process.env.PORT, 3000),
		NODE_ENV: process.env.NODE_ENV || "development",
		CORS_ORIGIN: process.env.CORS_ORIGIN || "*",

		// Database
		DATABASE_URL: requireEnv("DATABASE_URL"),

		// Redis
		REDIS_HOST: process.env.REDIS_HOST || "localhost",
		REDIS_PORT: parseNumber(process.env.REDIS_PORT, 6379),
		REDIS_PASSWORD: process.env.REDIS_PASSWORD,

		// MinIO / S3
		MINIO_ENDPOINT: process.env.MINIO_ENDPOINT || "localhost",
		MINIO_PORT: parseNumber(process.env.MINIO_PORT, 9000),
		MINIO_ACCESS_KEY: requireEnv("MINIO_ACCESS_KEY"),
		MINIO_SECRET_KEY: requireEnv("MINIO_SECRET_KEY"),
		MINIO_USE_SSL: parseBoolean(process.env.MINIO_USE_SSL, false),
		MINIO_BUCKET_NAME: process.env.MINIO_BUCKET_NAME || "quorum-recordings",

		// JWT
		JWT_SECRET: requireEnv("JWT_SECRET"),
		JWT_ISSUER: process.env.JWT_ISSUER || "quorum",
		JWT_AUDIENCE: process.env.JWT_AUDIENCE || "quorum-api",

		// Sentry
		SENTRY_DSN: process.env.SENTRY_DSN,
		SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || "development",

		// Features
		ENABLE_SWAGGER: parseBoolean(process.env.ENABLE_SWAGGER, true),
		ENABLE_METRICS: parseBoolean(process.env.ENABLE_METRICS, true),
	};
}
