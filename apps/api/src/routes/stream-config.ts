import { Elysia, t } from "elysia";
import { db } from "@quorum/db";
import { NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";
import { randomBytes } from "node:crypto";

// Generate a secure random secret for stream authentication
function generateStreamSecret(): string {
	return randomBytes(32).toString("hex");
}

// Stream type enum
const StreamTypeEnum = t.Union([
	t.Literal("HTTP_POST"),
	t.Literal("WEBSOCKET"),
	t.Literal("S3_MULTIPART"),
]);

// Stream format enum
const StreamFormatEnum = t.Union([
	t.Literal("WEBM_CHUNK"),
	t.Literal("AUDIO_ONLY"),
	t.Literal("METADATA"),
]);

export const streamConfigRoutes = new Elysia({ prefix: "/stream-configs" })
	// List stream configurations
	.get(
		"/",
		async ({ query }) => {
			const where: any = {};

			if (query.organizationId) {
				where.organizationId = query.organizationId;
			}

			if (query.meetingId) {
				where.meetingId = query.meetingId;
			}

			if (query.isActive !== undefined) {
				where.isActive = query.isActive;
			}

			if (query.type) {
				where.type = query.type;
			}

			const configs = await db.streamConfig.findMany({
				where,
				orderBy: { createdAt: "desc" },
				take: query.limit || 50,
				skip: query.offset || 0,
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					meeting: {
						select: {
							id: true,
							url: true,
							platform: true,
							status: true,
						},
					},
				},
			});

			return { data: configs };
		},
		{
			query: t.Object({
				organizationId: t.Optional(t.String()),
				meetingId: t.Optional(t.String()),
				isActive: t.Optional(t.Boolean()),
				type: t.Optional(StreamTypeEnum),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ["StreamConfig"],
				summary: "List stream configurations",
				description: "Get a list of stream configurations with optional filtering",
			},
		},
	)
	// Get stream config by ID
	.get(
		"/:id",
		async ({ params: { id } }) => {
			const config = await db.streamConfig.findUnique({
				where: { id },
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					meeting: {
						select: {
							id: true,
							url: true,
							platform: true,
							status: true,
						},
					},
				},
			});

			if (!config) {
				throw new NotFoundError("StreamConfig", id);
			}

			return { data: config };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["StreamConfig"],
				summary: "Get stream configuration by ID",
				description: "Get detailed information about a specific stream configuration",
			},
		},
	)
	// Create stream config
	.post(
		"/",
		async ({ body }) => {
			// Check if organization exists
			const organization = await db.organization.findUnique({
				where: { id: body.organizationId },
			});

			if (!organization) {
				throw new NotFoundError("Organization", body.organizationId);
			}

			// Check if meeting exists (if specified)
			if (body.meetingId) {
				const meeting = await db.meeting.findUnique({
					where: { id: body.meetingId },
				});

				if (!meeting) {
					throw new NotFoundError("Meeting", body.meetingId);
				}
			}

			// Generate secret if not provided
			const secret = body.secret || generateStreamSecret();

			const config = await db.streamConfig.create({
				data: {
					name: body.name,
					type: body.type,
					format: body.format,
					url: body.url,
					secret,
					headers: body.headers,
					chunkIntervalMs: body.chunkIntervalMs ?? 5000,
					isActive: body.isActive ?? true,
					organizationId: body.organizationId,
					meetingId: body.meetingId,
				},
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					meeting: {
						select: {
							id: true,
							url: true,
							platform: true,
							status: true,
						},
					},
				},
			});

			logger.info(`Stream config created: ${config.id} - ${config.name} (${config.type})`);

			return { data: config };
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 255 }),
				type: StreamTypeEnum,
				format: StreamFormatEnum,
				url: t.String({ minLength: 1 }),
				secret: t.Optional(t.String({ minLength: 16 })),
				headers: t.Optional(t.Record(t.String(), t.String())),
				chunkIntervalMs: t.Optional(t.Number({ minimum: 1000, maximum: 60000 })),
				isActive: t.Optional(t.Boolean()),
				organizationId: t.String({ minLength: 1 }),
				meetingId: t.Optional(t.String()),
			}),
			detail: {
				tags: ["StreamConfig"],
				summary: "Create stream configuration",
				description: "Create a new real-time streaming configuration. If no meetingId is specified, it applies as the organization default.",
			},
		},
	)
	// Update stream config
	.patch(
		"/:id",
		async ({ params: { id }, body }) => {
			const existing = await db.streamConfig.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("StreamConfig", id);
			}

			// Check if meeting exists (if specified)
			if (body.meetingId) {
				const meeting = await db.meeting.findUnique({
					where: { id: body.meetingId },
				});

				if (!meeting) {
					throw new NotFoundError("Meeting", body.meetingId);
				}
			}

			const config = await db.streamConfig.update({
				where: { id },
				data: {
					...(body.name && { name: body.name }),
					...(body.type && { type: body.type }),
					...(body.format && { format: body.format }),
					...(body.url && { url: body.url }),
					...(body.headers !== undefined && { headers: body.headers }),
					...(body.chunkIntervalMs !== undefined && { chunkIntervalMs: body.chunkIntervalMs }),
					...(body.isActive !== undefined && { isActive: body.isActive }),
					...(body.meetingId !== undefined && { meetingId: body.meetingId }),
				},
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					meeting: {
						select: {
							id: true,
							url: true,
							platform: true,
							status: true,
						},
					},
				},
			});

			logger.info(`Stream config updated: ${config.id} - ${config.name}`);

			return { data: config };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			body: t.Object({
				name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
				type: t.Optional(StreamTypeEnum),
				format: t.Optional(StreamFormatEnum),
				url: t.Optional(t.String({ minLength: 1 })),
				headers: t.Optional(t.Record(t.String(), t.String())),
				chunkIntervalMs: t.Optional(t.Number({ minimum: 1000, maximum: 60000 })),
				isActive: t.Optional(t.Boolean()),
				meetingId: t.Optional(t.Union([t.String(), t.Null()])),
			}),
			detail: {
				tags: ["StreamConfig"],
				summary: "Update stream configuration",
				description: "Update stream configuration settings. Set meetingId to null to make it an organization default.",
			},
		},
	)
	// Regenerate stream secret
	.post(
		"/:id/regenerate-secret",
		async ({ params: { id } }) => {
			const existing = await db.streamConfig.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("StreamConfig", id);
			}

			const newSecret = generateStreamSecret();

			const config = await db.streamConfig.update({
				where: { id },
				data: {
					secret: newSecret,
				},
			});

			logger.info(`Stream config secret regenerated: ${config.id}`);

			return {
				data: {
					id: config.id,
					secret: config.secret,
					message: "Secret regenerated successfully.",
				},
			};
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["StreamConfig"],
				summary: "Regenerate stream secret",
				description: "Generate a new authentication secret for the stream configuration",
			},
		},
	)
	// Delete stream config
	.delete(
		"/:id",
		async ({ params: { id } }) => {
			const existing = await db.streamConfig.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("StreamConfig", id);
			}

			await db.streamConfig.delete({
				where: { id },
			});

			logger.info(`Stream config deleted: ${id}`);

			return { success: true };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["StreamConfig"],
				summary: "Delete stream configuration",
				description: "Permanently delete a stream configuration",
			},
		},
	)
	// Get active configs for a meeting (includes org defaults)
	.get(
		"/meeting/:meetingId/active",
		async ({ params: { meetingId } }) => {
			const meeting = await db.meeting.findUnique({
				where: { id: meetingId },
			});

			if (!meeting) {
				throw new NotFoundError("Meeting", meetingId);
			}

			// Get meeting-specific configs and org-level defaults
			const configs = await db.streamConfig.findMany({
				where: {
					organizationId: meeting.organizationId,
					isActive: true,
					OR: [
						{ meetingId: meetingId },
						{ meetingId: null }, // Organization defaults
					],
				},
				orderBy: { createdAt: "desc" },
			});

			return { data: configs };
		},
		{
			params: t.Object({
				meetingId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["StreamConfig"],
				summary: "Get active stream configs for meeting",
				description: "Get all active streaming configurations for a meeting, including organization defaults",
			},
		},
	);
