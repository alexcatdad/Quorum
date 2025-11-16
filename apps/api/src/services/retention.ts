import { db } from "@quorum/db";
import { logger } from "../utils/logger";
import { minioService } from "./minio-instance";

export class RetentionService {
	/**
	 * Delete recordings older than the specified number of days
	 */
	static async deleteOldRecordings(daysToRetain: number = 30): Promise<number> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.setDate() - daysToRetain);

		logger.info(`Starting retention policy cleanup for recordings older than ${daysToRetain} days`);

		// Find recordings to delete
		const recordingsToDelete = await db.recording.findMany({
			where: {
				createdAt: {
					lt: cutoffDate,
				},
				deletedAt: null, // Only delete active recordings
			},
		});

		logger.info(`Found ${recordingsToDelete.length} recordings to delete`);

		let deletedCount = 0;

		for (const recording of recordingsToDelete) {
			try {
				// Delete from MinIO
				try {
					await minioService.deleteFile(recording.filePath);
					if (recording.encodedFilePath) {
						await minioService.deleteFile(recording.encodedFilePath);
					}
					if (recording.harFilePath) {
						await minioService.deleteFile(recording.harFilePath);
					}
				} catch (error) {
					logger.error(`Failed to delete files from MinIO for recording ${recording.id}`, error);
				}

				// Soft delete in database
				await db.recording.update({
					where: { id: recording.id },
					data: { deletedAt: new Date() },
				});

				deletedCount++;

				logger.info(`Deleted recording ${recording.id} as part of retention policy`);
			} catch (error) {
				logger.error(`Failed to delete recording ${recording.id}`, error);
			}
		}

		logger.info(`Retention policy cleanup completed. Deleted ${deletedCount} recordings.`);

		return deletedCount;
	}

	/**
	 * Permanently delete soft-deleted recordings older than specified days
	 */
	static async permanentlyDeleteSoftDeleted(daysToRetain: number = 7): Promise<number> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - daysToRetain);

		logger.info(`Starting permanent deletion of soft-deleted recordings older than ${daysToRetain} days`);

		const recordingsToDelete = await db.recording.findMany({
			where: {
				deletedAt: {
					not: null,
					lt: cutoffDate,
				},
			},
		});

		logger.info(`Found ${recordingsToDelete.length} soft-deleted recordings to permanently delete`);

		let deletedCount = 0;

		for (const recording of recordingsToDelete) {
			try {
				await db.recording.delete({
					where: { id: recording.id },
				});

				deletedCount++;

				logger.info(`Permanently deleted recording ${recording.id}`);
			} catch (error) {
				logger.error(`Failed to permanently delete recording ${recording.id}`, error);
			}
		}

		logger.info(`Permanent deletion completed. Deleted ${deletedCount} recordings.`);

		return deletedCount;
	}

	/**
	 * Run retention policy (should be called by a cron job or scheduler)
	 */
	static async runRetentionPolicy(): Promise<{
		deletedRecordings: number;
		permanentlyDeleted: number;
	}> {
		logger.info("Running retention policy...");

		const deletedRecordings = await this.deleteOldRecordings(30); // 30 days retention
		const permanentlyDeleted = await this.permanentlyDeleteSoftDeleted(7); // 7 days grace period

		logger.info("Retention policy completed", {
			deletedRecordings,
			permanentlyDeleted,
		});

		return {
			deletedRecordings,
			permanentlyDeleted,
		};
	}
}

// Run retention policy every day at 2 AM
if (process.env.NODE_ENV === "production") {
	const RETENTION_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

	setInterval(async () => {
		const now = new Date();
		if (now.getHours() === 2) {
			// Run at 2 AM
			await RetentionService.runRetentionPolicy();
		}
	}, RETENTION_CHECK_INTERVAL);

	logger.info("Retention policy scheduler initialized");
}
