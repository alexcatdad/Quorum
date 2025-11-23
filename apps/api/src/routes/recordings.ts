import { db } from "@quorum/db";
import { Elysia, t } from "elysia";
import { NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";

export const recordingsRoutes = new Elysia({ prefix: "/recordings" })
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

			if (query.status) {
				where.status = query.status;
			}

			if (query.includeDeleted !== true) {
				where.deletedAt = null;
			}

			const recordings = await db.recording.findMany({
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
							meetingUrl: true,
							platform: true,
							status: true,
						},
					},
				},
			});

			return { data: recordings };
		},
		{
			query: t.Object({
				organizationId: t.Optional(t.String()),
				meetingId: t.Optional(t.String()),
				status: t.Optional(
					t.Union([
						t.Literal("RAW"),
						t.Literal("ENCODING"),
						t.Literal("ENCODED"),
						t.Literal("FAILED"),
					]),
				),
				includeDeleted: t.Optional(t.Boolean()),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ["Recordings"],
				summary: "List recordings",
				description:
					"Get a list of recordings with filtering and pagination options. By default, deleted recordings are excluded.",
			},
		},
	)
	.get(
		"/:id",
		async ({ params: { id } }) => {
			const recording = await db.recording.findUnique({
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
							meetingUrl: true,
							platform: true,
							status: true,
							actualStart: true,
							actualEnd: true,
						},
					},
				},
			});

			if (!recording) {
				throw new NotFoundError("Recording", id);
			}

			return { data: recording };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Recordings"],
				summary: "Get recording by ID",
				description:
					"Get detailed information about a specific recording including meeting details",
			},
		},
	)
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

			// Check if meeting exists
			const meeting = await db.meeting.findUnique({
				where: { id: body.meetingId },
			});

			if (!meeting) {
				throw new NotFoundError("Meeting", body.meetingId);
			}

			const recording = await db.recording.create({
				data: {
					filePath: body.filePath,
					fileSize: body.fileSize,
					duration: body.duration,
					status: body.status || "RAW",
					format: body.format || "webm",
					harFilePath: body.harFilePath,
					metadata: body.metadata || {},
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
							meetingUrl: true,
							platform: true,
							status: true,
						},
					},
				},
			});

			logger.info(
				`Recording created: ${recording.id} - ${recording.filePath} (${recording.fileSize} bytes)`,
			);

			return { data: recording };
		},
		{
			body: t.Object({
				filePath: t.String({ minLength: 1 }),
				fileSize: t.Number({ minimum: 0 }),
				duration: t.Optional(t.Number({ minimum: 0 })),
				status: t.Optional(
					t.Union([
						t.Literal("RAW"),
						t.Literal("ENCODING"),
						t.Literal("ENCODED"),
						t.Literal("FAILED"),
					]),
				),
				format: t.Optional(t.String()),
				harFilePath: t.Optional(t.String()),
				metadata: t.Optional(t.Any()),
				organizationId: t.String({ minLength: 1 }),
				meetingId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Recordings"],
				summary: "Create recording",
				description:
					"Create a new recording entry. Status defaults to RAW, format defaults to webm.",
			},
		},
	)
	.patch(
		"/:id",
		async ({ params: { id }, body }) => {
			// Check if recording exists
			const existing = await db.recording.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Recording", id);
			}

			const recording = await db.recording.update({
				where: { id },
				data: {
					...(body.filePath && { filePath: body.filePath }),
					...(body.fileSize !== undefined && { fileSize: body.fileSize }),
					...(body.duration !== undefined && { duration: body.duration }),
					...(body.status && { status: body.status }),
					...(body.format && { format: body.format }),
					...(body.encodedFilePath && { encodedFilePath: body.encodedFilePath }),
					...(body.encodedFileSize !== undefined && {
						encodedFileSize: body.encodedFileSize,
					}),
					...(body.harFilePath && { harFilePath: body.harFilePath }),
					...(body.error && { error: body.error }),
					...(body.metadata && { metadata: body.metadata }),
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
							meetingUrl: true,
							platform: true,
							status: true,
						},
					},
				},
			});

			logger.info(`Recording updated: ${recording.id} - status: ${recording.status}`);

			return { data: recording };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			body: t.Object({
				filePath: t.Optional(t.String({ minLength: 1 })),
				fileSize: t.Optional(t.Number({ minimum: 0 })),
				duration: t.Optional(t.Number({ minimum: 0 })),
				status: t.Optional(
					t.Union([
						t.Literal("RAW"),
						t.Literal("ENCODING"),
						t.Literal("ENCODED"),
						t.Literal("FAILED"),
					]),
				),
				format: t.Optional(t.String()),
				encodedFilePath: t.Optional(t.String()),
				encodedFileSize: t.Optional(t.Number({ minimum: 0 })),
				harFilePath: t.Optional(t.String()),
				error: t.Optional(t.String()),
				metadata: t.Optional(t.Any()),
			}),
			detail: {
				tags: ["Recordings"],
				summary: "Update recording",
				description: "Update recording details, status, file paths, or metadata",
			},
		},
	)
	.delete(
		"/:id",
		async ({ params: { id }, query }) => {
			// Check if recording exists
			const existing = await db.recording.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Recording", id);
			}

			if (query.hard === true) {
				// Hard delete - permanently remove from database
				await db.recording.delete({
					where: { id },
				});

				logger.info(`Recording hard deleted: ${id}`);

				return { success: true, deleted: "permanent" };
			}

			// Soft delete - mark as deleted
			await db.recording.update({
				where: { id },
				data: {
					deletedAt: new Date(),
				},
			});

			logger.info(`Recording soft deleted: ${id}`);

			return { success: true, deleted: "soft" };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			query: t.Object({
				hard: t.Optional(t.Boolean()),
			}),
			detail: {
				tags: ["Recordings"],
				summary: "Delete recording",
				description:
					"Delete a recording. By default performs a soft delete (sets deletedAt timestamp). Use ?hard=true for permanent deletion.",
			},
		},
	)
	.post(
		"/:id/restore",
		async ({ params: { id } }) => {
			// Check if recording exists and is deleted
			const existing = await db.recording.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Recording", id);
			}

			if (!existing.deletedAt) {
				return { success: true, message: "Recording was not deleted" };
			}

			const recording = await db.recording.update({
				where: { id },
				data: {
					deletedAt: null,
				},
			});

			logger.info(`Recording restored: ${id}`);

			return { success: true, data: recording };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Recordings"],
				summary: "Restore deleted recording",
				description: "Restore a soft-deleted recording",
			},
		},
	);
