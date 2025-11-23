import { type Job, Queue, Worker } from "bullmq";
import type { Env } from "../utils/env";
import { createChildLogger } from "../utils/logger";
import { activeJobs, jobProcessingDuration, jobsProcessedTotal } from "../utils/metrics";

const queueLogger = createChildLogger("queue");

export interface RecordingJobData {
	meetingId: string;
	organizationId: string;
	meetingUrl: string;
	platform: "TEAMS" | "SLACK" | "YOUTUBE";
	botAccountId: string;
}

export interface EncodingJobData {
	recordingId: string;
	organizationId: string;
	rawFilePath: string;
	outputFormat: string;
}

export class QueueService {
	private redisConnection: { host: string; port: number; password?: string };
	public recordingQueue: Queue<RecordingJobData>;
	public encodingQueue: Queue<EncodingJobData>;

	constructor(env: Env) {
		this.redisConnection = {
			host: env.REDIS_HOST,
			port: env.REDIS_PORT,
			password: env.REDIS_PASSWORD,
		};

		this.recordingQueue = new Queue<RecordingJobData>("recording", {
			connection: this.redisConnection,
		});

		this.encodingQueue = new Queue<EncodingJobData>("encoding", {
			connection: this.redisConnection,
		});

		queueLogger.info("Queue service initialized");
	}

	async addRecordingJob(data: RecordingJobData): Promise<Job<RecordingJobData>> {
		const job = await this.recordingQueue.add("record-meeting", data, {
			attempts: 3,
			backoff: {
				type: "exponential",
				delay: 5000,
			},
			removeOnComplete: 100, // Keep last 100 completed jobs
			removeOnFail: 200, // Keep last 200 failed jobs
		});

		queueLogger.info(`Recording job added: ${job.id} for meeting ${data.meetingId}`);

		return job;
	}

	async addEncodingJob(data: EncodingJobData): Promise<Job<EncodingJobData>> {
		const job = await this.encodingQueue.add("encode-recording", data, {
			attempts: 2,
			backoff: {
				type: "exponential",
				delay: 10000,
			},
			removeOnComplete: 100,
			removeOnFail: 200,
		});

		queueLogger.info(`Encoding job added: ${job.id} for recording ${data.recordingId}`);

		return job;
	}

	async getRecordingJobStatus(jobId: string) {
		const job = await this.recordingQueue.getJob(jobId);

		if (!job) {
			return null;
		}

		const state = await job.getState();
		const progress = job.progress;

		return {
			id: job.id,
			state,
			progress,
			data: job.data,
			failedReason: job.failedReason,
			processedOn: job.processedOn,
			finishedOn: job.finishedOn,
		};
	}

	async getEncodingJobStatus(jobId: string) {
		const job = await this.encodingQueue.getJob(jobId);

		if (!job) {
			return null;
		}

		const state = await job.getState();
		const progress = job.progress;

		return {
			id: job.id,
			state,
			progress,
			data: job.data,
			failedReason: job.failedReason,
			processedOn: job.processedOn,
			finishedOn: job.finishedOn,
		};
	}

	async getQueueStats() {
		const [recordingCounts, encodingCounts] = await Promise.all([
			this.recordingQueue.getJobCounts(),
			this.encodingQueue.getJobCounts(),
		]);

		return {
			recording: recordingCounts,
			encoding: encodingCounts,
		};
	}

	async close() {
		await Promise.all([this.recordingQueue.close(), this.encodingQueue.close()]);

		queueLogger.info("Queue service closed");
	}
}

export function createRecordingWorker(
	env: Env,
	processor: (job: Job<RecordingJobData>) => Promise<void>,
): Worker<RecordingJobData> {
	const worker = new Worker<RecordingJobData>(
		"recording",
		async (job) => {
			const startTime = Date.now();
			const logger = createChildLogger(`recording-worker-${job.id}`);

			logger.info(`Processing recording job: ${job.id}`, job.data);

			activeJobs.inc({ queue: "recording" });

			try {
				await processor(job);

				const duration = (Date.now() - startTime) / 1000;
				jobsProcessedTotal.inc({ queue: "recording", status: "completed" });
				jobProcessingDuration.observe({ queue: "recording" }, duration);

				logger.info(`Recording job completed: ${job.id} in ${duration}s`);
			} catch (error) {
				const duration = (Date.now() - startTime) / 1000;
				jobsProcessedTotal.inc({ queue: "recording", status: "failed" });
				jobProcessingDuration.observe({ queue: "recording" }, duration);

				logger.error(`Recording job failed: ${job.id}`, error);
				throw error;
			} finally {
				activeJobs.dec({ queue: "recording" });
			}
		},
		{
			connection: {
				host: env.REDIS_HOST,
				port: env.REDIS_PORT,
				password: env.REDIS_PASSWORD,
			},
			concurrency: 3, // Process up to 3 recordings simultaneously
		},
	);

	worker.on("failed", (job, error) => {
		queueLogger.error(`Recording job ${job?.id} failed:`, error);
	});

	worker.on("error", (error) => {
		queueLogger.error("Recording worker error:", error);
	});

	queueLogger.info("Recording worker created");

	return worker;
}

export function createEncodingWorker(
	env: Env,
	processor: (job: Job<EncodingJobData>) => Promise<void>,
): Worker<EncodingJobData> {
	const worker = new Worker<EncodingJobData>(
		"encoding",
		async (job) => {
			const startTime = Date.now();
			const logger = createChildLogger(`encoding-worker-${job.id}`);

			logger.info(`Processing encoding job: ${job.id}`, job.data);

			activeJobs.inc({ queue: "encoding" });

			try {
				await processor(job);

				const duration = (Date.now() - startTime) / 1000;
				jobsProcessedTotal.inc({ queue: "encoding", status: "completed" });
				jobProcessingDuration.observe({ queue: "encoding" }, duration);

				logger.info(`Encoding job completed: ${job.id} in ${duration}s`);
			} catch (error) {
				const duration = (Date.now() - startTime) / 1000;
				jobsProcessedTotal.inc({ queue: "encoding", status: "failed" });
				jobProcessingDuration.observe({ queue: "encoding" }, duration);

				logger.error(`Encoding job failed: ${job.id}`, error);
				throw error;
			} finally {
				activeJobs.dec({ queue: "encoding" });
			}
		},
		{
			connection: {
				host: env.REDIS_HOST,
				port: env.REDIS_PORT,
				password: env.REDIS_PASSWORD,
			},
			concurrency: 2, // Process up to 2 encodings simultaneously
		},
	);

	worker.on("failed", (job, error) => {
		queueLogger.error(`Encoding job ${job?.id} failed:`, error);
	});

	worker.on("error", (error) => {
		queueLogger.error("Encoding worker error:", error);
	});

	queueLogger.info("Encoding worker created");

	return worker;
}
