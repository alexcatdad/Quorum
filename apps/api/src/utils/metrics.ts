import { Counter, Gauge, Histogram, register } from "prom-client";

// HTTP Metrics
export const httpRequestsTotal = new Counter({
	name: "http_requests_total",
	help: "Total number of HTTP requests",
	labelNames: ["method", "route", "status"],
});

export const httpRequestDuration = new Histogram({
	name: "http_request_duration_seconds",
	help: "HTTP request duration in seconds",
	labelNames: ["method", "route", "status"],
	buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
});

// Job Queue Metrics
export const jobsProcessedTotal = new Counter({
	name: "jobs_processed_total",
	help: "Total number of jobs processed",
	labelNames: ["queue", "status"],
});

export const jobProcessingDuration = new Histogram({
	name: "job_processing_duration_seconds",
	help: "Job processing duration in seconds",
	labelNames: ["queue"],
	buckets: [1, 5, 10, 30, 60, 300, 600, 1800, 3600],
});

export const activeJobs = new Gauge({
	name: "active_jobs",
	help: "Number of currently active jobs",
	labelNames: ["queue"],
});

// Recording Metrics
export const recordingsActive = new Gauge({
	name: "recordings_active",
	help: "Number of currently active recordings",
	labelNames: ["platform"],
});

export const recordingsTotal = new Counter({
	name: "recordings_total",
	help: "Total number of recordings",
	labelNames: ["platform", "status"],
});

// Encoding Metrics
export const encodingsActive = new Gauge({
	name: "encodings_active",
	help: "Number of currently active encodings",
});

export const encodingsTotal = new Counter({
	name: "encodings_total",
	help: "Total number of encodings",
	labelNames: ["status"],
});

// Storage Metrics
export const storageUsageBytes = new Gauge({
	name: "storage_usage_bytes",
	help: "Total storage usage in bytes",
	labelNames: ["type"],
});

export { register };
