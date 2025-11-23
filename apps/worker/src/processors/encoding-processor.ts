import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { db } from "@quorum/db";
import { VP9Encoder } from "@quorum/encoder";
import type { Job } from "bullmq";
import type { EncodingJobData } from "../../../api/src/services/queue";
import { webhookService } from "../../../api/src/services/webhook";
import { minioService } from "../services/minio";
import { logger } from "../utils/logger";

export async function processEncodingJob(job: Job<EncodingJobData>): Promise<void> {
	const { recordingId, organizationId, rawFilePath, outputFormat } = job.data;

	const jobLogger = logger.child({
		jobId: job.id,
		recordingId,
	});

	jobLogger.info("Starting encoding job");

	try {
		// Update recording status to ENCODING
		await db.recording.update({
			where: { id: recordingId },
			data: {
				status: "ENCODING",
			},
		});

		// Trigger webhook: encoding started
		await webhookService.triggerEncodingStarted(organizationId, recordingId, {
			rawFilePath,
			outputFormat,
			startedAt: new Date().toISOString(),
		});

		// Download raw file from MinIO
		const timestamp = Date.now();
		await mkdir("./temp", { recursive: true });
		const localRawPath = `./temp/${recordingId}-${timestamp}-raw.webm`;
		const localEncodedPath = `./temp/${recordingId}-${timestamp}-encoded.${outputFormat}`;

		jobLogger.info("Downloading raw file from MinIO");

		const rawStream = await minioService.getFile(rawFilePath);
		if (!rawStream) {
			throw new Error("Failed to download raw file from MinIO");
		}

		// Save to local file
		const writeStream = createWriteStream(localRawPath);
		await pipeline(Readable.fromWeb(rawStream as any), writeStream);

		jobLogger.info("Raw file downloaded, starting encoding");

		// Encode with VP9
		const encoder = new VP9Encoder();
		const result = await encoder.encode({
			inputPath: localRawPath,
			outputPath: localEncodedPath,
			codec: "vp9",
			quality: 30,
			preset: "medium",
			audioBitrate: "128k",
			onProgress: async (progress) => {
				// Update job progress
				const percent = Math.min(99, Math.floor(progress.frame / 100)); // Rough estimate
				await job.updateProgress(percent);

				jobLogger.info(`Encoding progress: ${progress.time} at ${progress.speed}`);
			},
		});

		if (!result.success) {
			throw new Error(result.error || "Encoding failed");
		}

		jobLogger.info("Encoding completed, uploading to MinIO");

		// Upload encoded file to MinIO
		const encodedFile = await Bun.file(localEncodedPath).arrayBuffer();
		const encodedStats = await stat(localEncodedPath);

		const encodedMinioKey = `encoded/${organizationId}/${recordingId}-${timestamp}.${outputFormat}`;
		await minioService.uploadFile(
			encodedMinioKey,
			new Uint8Array(encodedFile),
			`video/${outputFormat}`,
		);

		jobLogger.info("Upload completed, updating recording record");

		// Update recording record
		await db.recording.update({
			where: { id: recordingId },
			data: {
				status: "ENCODED",
				encodedFilePath: encodedMinioKey,
				encodedFileSize: encodedStats.size,
				metadata: {
					encodedAt: new Date().toISOString(),
					codec: "vp9",
					format: outputFormat,
				},
			},
		});

		// Clean up local files
		try {
			await unlink(localRawPath);
			await unlink(localEncodedPath);
		} catch (error) {
			jobLogger.warn("Failed to clean up local files", error);
		}

		jobLogger.info("Encoding job completed successfully");

		// Trigger webhook: encoding completed
		await webhookService.triggerEncodingCompleted(organizationId, recordingId, encodedMinioKey, {
			outputFormat,
			fileSize: encodedStats.size,
			codec: "vp9",
			completedAt: new Date().toISOString(),
		});

		await job.updateProgress(100);
	} catch (error) {
		jobLogger.error("Encoding job failed", error);

		// Update recording status to FAILED
		await db.recording.update({
			where: { id: recordingId },
			data: {
				status: "FAILED",
				error: error instanceof Error ? error.message : String(error),
			},
		});

		// Trigger webhook: encoding failed
		await webhookService
			.triggerEncodingFailed(
				organizationId,
				recordingId,
				error instanceof Error ? error.message : String(error),
				{
					outputFormat,
					failedAt: new Date().toISOString(),
				},
			)
			.catch(() => {});

		throw error;
	}
}
