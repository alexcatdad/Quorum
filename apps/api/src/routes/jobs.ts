import { Elysia, t } from "elysia";
import { db } from "@quorum/db";
import { NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";
import { QueueService } from "../services/queue";
import { loadEnv } from "../utils/env";

const env = loadEnv();
const queueService = new QueueService(env);

export const jobsRoutes = new Elysia({ prefix: "/jobs" })
	.post(
		"/recordings/start",
		async ({ body }) => {
			// Get meeting details
			const meeting = await db.meeting.findUnique({
				where: { id: body.meetingId },
				include: {
					botAccount: true,
				},
			});

			if (!meeting) {
				throw new NotFoundError("Meeting", body.meetingId);
			}

			// Add job to queue
			const job = await queueService.addRecordingJob({
				meetingId: meeting.id,
				organizationId: meeting.organizationId,
				meetingUrl: meeting.meetingUrl,
				platform: meeting.platform as any,
				botAccountId: meeting.botAccountId,
			});

			logger.info(`Recording job queued: ${job.id} for meeting ${meeting.id}`);

			return {
				jobId: job.id,
				meetingId: meeting.id,
				status: "queued",
			};
		},
		{
			body: t.Object({
				meetingId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Jobs"],
				summary: "Start recording job",
				description: "Queue a new recording job for a meeting",
			},
		},
	)
	.post(
		"/encodings/start",
		async ({ body }) => {
			// Get recording details
			const recording = await db.recording.findUnique({
				where: { id: body.recordingId },
			});

			if (!recording) {
				throw new NotFoundError("Recording", body.recordingId);
			}

			// Add job to queue
			const job = await queueService.addEncodingJob({
				recordingId: recording.id,
				organizationId: recording.organizationId,
				rawFilePath: recording.filePath,
				outputFormat: body.outputFormat || "webm",
			});

			logger.info(`Encoding job queued: ${job.id} for recording ${recording.id}`);

			return {
				jobId: job.id,
				recordingId: recording.id,
				status: "queued",
			};
		},
		{
			body: t.Object({
				recordingId: t.String({ minLength: 1 }),
				outputFormat: t.Optional(t.String()),
			}),
			detail: {
				tags: ["Jobs"],
				summary: "Start encoding job",
				description: "Queue a new encoding job for a recording",
			},
		},
	)
	.get(
		"/recordings/:jobId",
		async ({ params: { jobId } }) => {
			const status = await queueService.getRecordingJobStatus(jobId);

			if (!status) {
				throw new NotFoundError("Job", jobId);
			}

			return { data: status };
		},
		{
			params: t.Object({
				jobId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Jobs"],
				summary: "Get recording job status",
				description: "Get the status of a recording job",
			},
		},
	)
	.get(
		"/encodings/:jobId",
		async ({ params: { jobId } }) => {
			const status = await queueService.getEncodingJobStatus(jobId);

			if (!status) {
				throw new NotFoundError("Job", jobId);
			}

			return { data: status };
		},
		{
			params: t.Object({
				jobId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Jobs"],
				summary: "Get encoding job status",
				description: "Get the status of an encoding job",
			},
		},
	)
	.get(
		"/stats",
		async () => {
			const stats = await queueService.getQueueStats();

			return { data: stats };
		},
		{
			detail: {
				tags: ["Jobs"],
				summary: "Get queue statistics",
				description: "Get statistics for all job queues",
			},
		},
	);
