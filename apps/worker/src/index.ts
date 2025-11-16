import { createRecordingWorker, createEncodingWorker } from "../../api/src/services/queue";
import { processRecordingJob } from "./processors/recording-processor";
import { processEncodingJob } from "./processors/encoding-processor";
import { logger } from "./utils/logger";

const env = {
	REDIS_HOST: process.env.REDIS_HOST || "localhost",
	REDIS_PORT: Number.parseInt(process.env.REDIS_PORT || "6379", 10),
	REDIS_PASSWORD: process.env.REDIS_PASSWORD,
} as any;

logger.info("Starting Quorum worker...");

// Create workers
const recordingWorker = createRecordingWorker(env, processRecordingJob);
const encodingWorker = createEncodingWorker(env, processEncodingJob);

logger.info("✅ Recording worker started");
logger.info("✅ Encoding worker started");

// Graceful shutdown
process.on("SIGTERM", async () => {
	logger.info("SIGTERM received, shutting down gracefully...");

	await recordingWorker.close();
	await encodingWorker.close();

	logger.info("Workers closed");
	process.exit(0);
});

process.on("SIGINT", async () => {
	logger.info("SIGINT received, shutting down gracefully...");

	await recordingWorker.close();
	await encodingWorker.close();

	logger.info("Workers closed");
	process.exit(0);
});
