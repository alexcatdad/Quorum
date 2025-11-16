import type { Job } from "bullmq";
import { db } from "@quorum/db";
import { TeamsRecorder, SlackRecorder, YouTubeRecorder, type RecordingResult } from "@quorum/recorder";
import type { RecordingJobData } from "../../../api/src/services/queue";
import { logger } from "../utils/logger";
import { minioService } from "../services/minio";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";

export async function processRecordingJob(job: Job<RecordingJobData>): Promise<void> {
	const { meetingId, organizationId, meetingUrl, platform, botAccountId } = job.data;

	const jobLogger = logger.child({
		jobId: job.id,
		meetingId,
		platform,
	});

	jobLogger.info("Starting recording job");

	try {
		// Update meeting status to RECORDING
		await db.meeting.update({
			where: { id: meetingId },
			data: {
				status: "RECORDING",
				actualStart: new Date(),
			},
		});

		// Get bot account credentials
		const botAccount = await db.botAccount.findUnique({
			where: { id: botAccountId },
		});

		if (!botAccount) {
			throw new Error(`Bot account not found: ${botAccountId}`);
		}

		// Prepare output path
		const timestamp = Date.now();
		const outputPath = `./recordings/${organizationId}/${meetingId}-${timestamp}.webm`;
		const harPath = `./recordings/${organizationId}/${meetingId}-${timestamp}.har`;

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

		if (!result.success) {
			throw new Error(result.error || "Recording failed");
		}

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

		// Report progress
		await job.updateProgress(100);
	} catch (error) {
		jobLogger.error("Recording job failed", error);

		// Update meeting status to FAILED
		await db.meeting.update({
			where: { id: meetingId },
			data: {
				status: "FAILED",
				actualEnd: new Date(),
				error: error instanceof Error ? error.message : String(error),
			},
		});

		throw error;
	}
}
