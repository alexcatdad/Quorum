import type { Job } from "bullmq";
import { db } from "@quorum/db";
import { TeamsRecorder, SlackRecorder, YouTubeRecorder, type RecordingResult } from "@quorum/recorder";
import type { RecordingJobData } from "../../../api/src/services/queue";
import { logger } from "../utils/logger";
import { minioService } from "../services/minio";
import { webhookService } from "../../../api/src/services/webhook";
import { streamingService, type StreamChunk } from "../../../api/src/services/streaming";
import { stat, readFile, watch } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";

export async function processRecordingJob(job: Job<RecordingJobData>): Promise<void> {
	const { meetingId, organizationId, meetingUrl, platform, botAccountId } = job.data;

	const jobLogger = logger.child({
		jobId: job.id,
		meetingId,
		platform,
	});

	jobLogger.info("Starting recording job");

	// Track chunk index for streaming
	let chunkIndex = 0;
	let streamingInterval: NodeJS.Timeout | null = null;

	try {
		// Update meeting status to RECORDING
		await db.meeting.update({
			where: { id: meetingId },
			data: {
				status: "RECORDING",
				actualStart: new Date(),
			},
		});

		// Trigger webhook: meeting started
		await webhookService.triggerMeetingStarted(organizationId, meetingId, {
			platform,
			meetingUrl,
			startedAt: new Date().toISOString(),
		});

		// Notify stream start
		await streamingService.notifyStreamStart(meetingId, organizationId);

		// Get bot account credentials
		const botAccount = await db.botAccount.findUnique({
			where: { id: botAccountId },
		});

		if (!botAccount) {
			throw new Error(`Bot account not found: ${botAccountId}`);
		}

		// Prepare output path
		const timestamp = Date.now();
		const recordingsDir = `./recordings/${organizationId}`;
		await mkdir(recordingsDir, { recursive: true });
		const outputPath = `${recordingsDir}/${meetingId}-${timestamp}.webm`;
		const harPath = `${recordingsDir}/${meetingId}-${timestamp}.har`;

		// Get active stream configs to determine chunk interval
		const streamConfigs = await streamingService.getActiveConfigs(meetingId, organizationId);
		const minChunkInterval = streamConfigs.length > 0
			? Math.min(...streamConfigs.map((c) => c.chunkIntervalMs))
			: 5000;

		// Set up real-time streaming if there are active configs
		let lastStreamedSize = 0;
		if (streamConfigs.length > 0) {
			jobLogger.info(`Setting up real-time streaming with ${streamConfigs.length} configs, interval: ${minChunkInterval}ms`);

			streamingInterval = setInterval(async () => {
				try {
					// Check if file exists and has grown
					const stats = await stat(outputPath).catch(() => null);
					if (stats && stats.size > lastStreamedSize) {
						// Read new chunk
						const chunkSize = stats.size - lastStreamedSize;
						const fileHandle = await Bun.file(outputPath).slice(lastStreamedSize, stats.size).arrayBuffer();
						const chunkData = Buffer.from(fileHandle);

						const chunk: StreamChunk = {
							meetingId,
							organizationId,
							chunkIndex: chunkIndex++,
							timestamp: new Date().toISOString(),
							format: "WEBM_CHUNK",
							data: chunkData,
							metadata: {
								platform,
								totalSize: stats.size,
								chunkSize,
							},
						};

						await streamingService.streamChunk(chunk);
						lastStreamedSize = stats.size;

						// Update job progress based on estimated duration
						const progress = Math.min(90, (chunkIndex * 10));
						await job.updateProgress(progress);
					}
				} catch (error) {
					jobLogger.warn("Error streaming chunk", error);
				}
			}, minChunkInterval);
		}

		// Record based on platform
		let result: RecordingResult;

		switch (platform) {
			case "TEAMS": {
				const recorder = new TeamsRecorder();
				result = await recorder.record(botAccount.credentials as any, {
					meetingUrl,
					outputPath,
				});
				break;
			}

			case "SLACK": {
				const recorder = new SlackRecorder();
				result = await recorder.record(botAccount.credentials as any, {
					meetingUrl,
					outputPath,
				});
				break;
			}

			case "YOUTUBE": {
				const recorder = new YouTubeRecorder();
				result = await recorder.record(botAccount.credentials as any, {
					meetingUrl,
					outputPath,
				});
				break;
			}

			default:
				throw new Error(`Unsupported platform: ${platform}`);
		}

		// Stop streaming interval
		if (streamingInterval) {
			clearInterval(streamingInterval);
			streamingInterval = null;
		}

		if (!result.success) {
			throw new Error(result.error || "Recording failed");
		}

		// Stream final chunk if there's remaining data
		if (streamConfigs.length > 0) {
			try {
				const stats = await stat(outputPath).catch(() => null);
				if (stats && stats.size > lastStreamedSize) {
					const fileHandle = await Bun.file(outputPath).slice(lastStreamedSize, stats.size).arrayBuffer();
					const chunkData = Buffer.from(fileHandle);

					const chunk: StreamChunk = {
						meetingId,
						organizationId,
						chunkIndex: chunkIndex++,
						timestamp: new Date().toISOString(),
						format: "WEBM_CHUNK",
						data: chunkData,
						metadata: {
							platform,
							totalSize: stats.size,
							chunkSize: stats.size - lastStreamedSize,
							isFinal: true,
						},
					};

					await streamingService.streamChunk(chunk);
				}
			} catch (error) {
				jobLogger.warn("Error streaming final chunk", error);
			}
		}

		// Notify stream end
		await streamingService.notifyStreamEnd(meetingId, organizationId);

		jobLogger.info("Recording completed, uploading to MinIO");

		// Upload to MinIO
		const videoFilePath = result.filePath || outputPath;
		const videoFile = await readFile(videoFilePath);
		const videoStats = await stat(videoFilePath);

		const minioKey = `recordings/${organizationId}/${meetingId}-${timestamp}.webm`;
		await minioService.uploadFile(minioKey, videoFile, "video/webm");

		// Upload HAR file if exists
		let harMinioKey: string | undefined;
		if (result.harPath) {
			try {
				const harFile = await readFile(result.harPath);
				harMinioKey = `har/${organizationId}/${meetingId}-${timestamp}.har`;
				await minioService.uploadFile(harMinioKey, harFile, "application/json");
			} catch (error) {
				jobLogger.warn("Failed to upload HAR file", error);
			}
		}

		jobLogger.info("Upload completed, creating recording record");

		// Create recording record
		const recording = await db.recording.create({
			data: {
				filePath: minioKey,
				fileSize: videoStats.size,
				duration: result.duration,
				status: "RAW",
				format: "webm",
				harFilePath: harMinioKey,
				metadata: {
					platform,
					recordedAt: new Date().toISOString(),
				},
				organizationId,
				meetingId,
			},
		});

		// Update meeting status to COMPLETED
		await db.meeting.update({
			where: { id: meetingId },
			data: {
				status: "COMPLETED",
				actualEnd: new Date(),
			},
		});

		jobLogger.info(`Recording job completed successfully. Recording ID: ${recording.id}`);

		// Trigger webhook: meeting completed
		await webhookService.triggerMeetingCompleted(organizationId, meetingId, recording.id, {
			platform,
			meetingUrl,
			duration: result.duration,
			fileSize: videoStats.size,
			completedAt: new Date().toISOString(),
		});

		// Trigger webhook: recording ready
		await webhookService.triggerRecordingReady(organizationId, recording.id, minioKey, {
			meetingId,
			platform,
			format: "webm",
			fileSize: videoStats.size,
			duration: result.duration,
		});

		// Report progress
		await job.updateProgress(100);
	} catch (error) {
		jobLogger.error("Recording job failed", error);

		// Clean up streaming interval if still running
		if (streamingInterval) {
			clearInterval(streamingInterval);
		}

		// Notify stream end on failure
		await streamingService.notifyStreamEnd(meetingId, organizationId).catch(() => {});

		// Update meeting status to FAILED
		await db.meeting.update({
			where: { id: meetingId },
			data: {
				status: "FAILED",
				actualEnd: new Date(),
				error: error instanceof Error ? error.message : String(error),
			},
		});

		// Trigger webhook: meeting failed
		await webhookService.triggerMeetingFailed(
			organizationId,
			meetingId,
			error instanceof Error ? error.message : String(error),
			{
				platform,
				meetingUrl,
				failedAt: new Date().toISOString(),
			},
		).catch(() => {});

		throw error;
	}
}
