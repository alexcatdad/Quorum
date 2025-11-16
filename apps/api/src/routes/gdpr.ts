import { Elysia, t } from "elysia";
import { db } from "@quorum/db";
import { NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";
import { minioService } from "../services/minio-instance";

export const gdprRoutes = new Elysia({ prefix: "/gdpr" })
	.post(
		"/export/:organizationId",
		async ({ params: { organizationId } }) => {
			logger.info(`GDPR data export requested for organization: ${organizationId}`);

			// Get organization
			const organization = await db.organization.findUnique({
				where: { id: organizationId },
				include: {
					users: true,
					botAccounts: {
						select: {
							id: true,
							name: true,
							platform: true,
							username: true,
							isActive: true,
							createdAt: true,
							updatedAt: true,
							// Exclude credentials
						},
					},
					meetings: {
						include: {
							recordings: true,
						},
					},
					auditLogs: true,
				},
			});

			if (!organization) {
				throw new NotFoundError("Organization", organizationId);
			}

			// Create export data
			const exportData = {
				exportedAt: new Date().toISOString(),
				organization: {
					id: organization.id,
					name: organization.name,
					slug: organization.slug,
					createdAt: organization.createdAt,
				},
				users: organization.users.map((u) => ({
					id: u.id,
					email: u.email,
					name: u.name,
					role: u.role,
					createdAt: u.createdAt,
				})),
				botAccounts: organization.botAccounts,
				meetings: organization.meetings.map((m) => ({
					id: m.id,
					meetingUrl: m.meetingUrl,
					platform: m.platform,
					status: m.status,
					scheduledStart: m.scheduledStart,
					scheduledEnd: m.scheduledEnd,
					actualStart: m.actualStart,
					actualEnd: m.actualEnd,
					recordings: m.recordings.map((r) => ({
						id: r.id,
						filePath: r.filePath,
						fileSize: r.fileSize,
						duration: r.duration,
						status: r.status,
						format: r.format,
						createdAt: r.createdAt,
					})),
				})),
				auditLogs: organization.auditLogs.map((a) => ({
					id: a.id,
					action: a.action,
					userId: a.userId,
					metadata: a.metadata,
					createdAt: a.createdAt,
				})),
			};

			logger.info(`GDPR data export completed for organization: ${organizationId}`);

			return {
				data: exportData,
				totalUsers: organization.users.length,
				totalMeetings: organization.meetings.length,
				totalRecordings: organization.meetings.reduce(
					(acc, m) => acc + m.recordings.length,
					0,
				),
			};
		},
		{
			params: t.Object({
				organizationId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["GDPR"],
				summary: "Export organization data",
				description:
					"Export all data associated with an organization for GDPR compliance",
			},
		},
	)
	.delete(
		"/delete/:organizationId",
		async ({ params: { organizationId }, query }) => {
			logger.warn(
				`GDPR data deletion requested for organization: ${organizationId}`,
			);

			// Get organization with recordings
			const organization = await db.organization.findUnique({
				where: { id: organizationId },
				include: {
					meetings: {
						include: {
							recordings: true,
						},
					},
				},
			});

			if (!organization) {
				throw new NotFoundError("Organization", organizationId);
			}

			// Delete all recordings from MinIO
			if (query.deleteFiles) {
				for (const meeting of organization.meetings) {
					for (const recording of meeting.recordings) {
						try {
							await minioService.deleteFile(recording.filePath);
							if (recording.encodedFilePath) {
								await minioService.deleteFile(recording.encodedFilePath);
							}
							if (recording.harFilePath) {
								await minioService.deleteFile(recording.harFilePath);
							}
						} catch (error) {
							logger.error(
								`Failed to delete file from MinIO: ${recording.filePath}`,
								error,
							);
						}
					}
				}
			}

			// Delete organization (cascade will handle related data)
			await db.organization.delete({
				where: { id: organizationId },
			});

			// Create audit log for deletion
			logger.warn(`Organization deleted for GDPR compliance: ${organizationId}`);

			return {
				success: true,
				deletedAt: new Date().toISOString(),
				organizationId,
			};
		},
		{
			params: t.Object({
				organizationId: t.String({ minLength: 1 }),
			}),
			query: t.Object({
				deleteFiles: t.Optional(t.Boolean()),
			}),
			detail: {
				tags: ["GDPR"],
				summary: "Delete organization data",
				description:
					"Permanently delete all data associated with an organization (GDPR right to be forgotten)",
			},
		},
	);
