import { db } from "@quorum/db";
import { logger } from "../utils/logger";

export interface AuditLogData {
	action: string;
	userId?: string;
	organizationId: string;
	metadata?: Record<string, any>;
}

export class AuditService {
	static async log(data: AuditLogData): Promise<void> {
		try {
			await db.auditLog.create({
				data: {
					action: data.action,
					userId: data.userId,
					organizationId: data.organizationId,
					metadata: data.metadata || {},
				},
			});

			logger.info("Audit log created", {
				action: data.action,
				userId: data.userId,
				organizationId: data.organizationId,
			});
		} catch (error) {
			logger.error("Failed to create audit log", error);
		}
	}

	static async getLogsForOrganization(
		organizationId: string,
		options: {
			limit?: number;
			offset?: number;
			userId?: string;
			action?: string;
		} = {},
	) {
		const where: any = { organizationId };

		if (options.userId) {
			where.userId = options.userId;
		}

		if (options.action) {
			where.action = options.action;
		}

		return await db.auditLog.findMany({
			where,
			orderBy: { createdAt: "desc" },
			take: options.limit || 100,
			skip: options.offset || 0,
			include: {
				user: {
					select: {
						id: true,
						email: true,
						name: true,
					},
				},
			},
		});
	}
}
