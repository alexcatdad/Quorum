import { Elysia, t } from "elysia";
import { db } from "@quorum/db";
import { NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";

export const meetingsRoutes = new Elysia({ prefix: "/meetings" })
	.get(
		"/",
		async ({ query }) => {
			const where: any = {};

			if (query.organizationId) {
				where.organizationId = query.organizationId;
			}

			if (query.status) {
				where.status = query.status;
			}

			if (query.platform) {
				where.platform = query.platform;
			}

			const meetings = await db.meeting.findMany({
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
					botAccount: {
						select: {
							id: true,
							name: true,
							username: true,
							platform: true,
						},
					},
					recordings: {
						select: {
							id: true,
							status: true,
							filePath: true,
							fileSize: true,
							duration: true,
						},
					},
				},
			});

			return { data: meetings };
		},
		{
			query: t.Object({
				organizationId: t.Optional(t.String()),
				status: t.Optional(
					t.Union([
						t.Literal("PENDING"),
						t.Literal("RECORDING"),
						t.Literal("COMPLETED"),
						t.Literal("FAILED"),
					]),
				),
				platform: t.Optional(
					t.Union([
						t.Literal("TEAMS"),
						t.Literal("SLACK"),
						t.Literal("YOUTUBE"),
					]),
				),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ["Meetings"],
				summary: "List meetings",
				description:
					"Get a list of meetings with filtering and pagination options",
			},
		},
	)
	.get(
		"/:id",
		async ({ params: { id } }) => {
			const meeting = await db.meeting.findUnique({
				where: { id },
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					botAccount: {
						select: {
							id: true,
							name: true,
							username: true,
							platform: true,
						},
					},
					recordings: true,
				},
			});

			if (!meeting) {
				throw new NotFoundError("Meeting", id);
			}

			return { data: meeting };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Meetings"],
				summary: "Get meeting by ID",
				description:
					"Get detailed information about a specific meeting including recordings",
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

			// Check if bot account exists
			const botAccount = await db.botAccount.findUnique({
				where: { id: body.botAccountId },
			});

			if (!botAccount) {
				throw new NotFoundError("BotAccount", body.botAccountId);
			}

			const meeting = await db.meeting.create({
				data: {
					meetingUrl: body.meetingUrl,
					platform: body.platform,
					status: body.status || "PENDING",
					scheduledStart: body.scheduledStart
						? new Date(body.scheduledStart)
						: undefined,
					scheduledEnd: body.scheduledEnd
						? new Date(body.scheduledEnd)
						: undefined,
					metadata: body.metadata || {},
					organizationId: body.organizationId,
					botAccountId: body.botAccountId,
				},
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					botAccount: {
						select: {
							id: true,
							name: true,
							username: true,
							platform: true,
						},
					},
				},
			});

			logger.info(`Meeting created: ${meeting.id} (${meeting.platform})`);

			return { data: meeting };
		},
		{
			body: t.Object({
				meetingUrl: t.String({ format: "uri" }),
				platform: t.Union([
					t.Literal("TEAMS"),
					t.Literal("SLACK"),
					t.Literal("YOUTUBE"),
				]),
				status: t.Optional(
					t.Union([
						t.Literal("PENDING"),
						t.Literal("RECORDING"),
						t.Literal("COMPLETED"),
						t.Literal("FAILED"),
					]),
				),
				scheduledStart: t.Optional(t.String({ format: "date-time" })),
				scheduledEnd: t.Optional(t.String({ format: "date-time" })),
				metadata: t.Optional(t.Any()),
				organizationId: t.String({ minLength: 1 }),
				botAccountId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Meetings"],
				summary: "Create meeting",
				description:
					"Create a new meeting recording session. Status defaults to PENDING.",
			},
		},
	)
	.patch(
		"/:id",
		async ({ params: { id }, body }) => {
			// Check if meeting exists
			const existing = await db.meeting.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Meeting", id);
			}

			const meeting = await db.meeting.update({
				where: { id },
				data: {
					...(body.meetingUrl && { meetingUrl: body.meetingUrl }),
					...(body.status && { status: body.status }),
					...(body.actualStart && { actualStart: new Date(body.actualStart) }),
					...(body.actualEnd && { actualEnd: new Date(body.actualEnd) }),
					...(body.scheduledStart && {
						scheduledStart: new Date(body.scheduledStart),
					}),
					...(body.scheduledEnd && {
						scheduledEnd: new Date(body.scheduledEnd),
					}),
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
					botAccount: {
						select: {
							id: true,
							name: true,
							username: true,
							platform: true,
						},
					},
					recordings: {
						select: {
							id: true,
							status: true,
							filePath: true,
							fileSize: true,
							duration: true,
						},
					},
				},
			});

			logger.info(`Meeting updated: ${meeting.id} - status: ${meeting.status}`);

			return { data: meeting };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			body: t.Object({
				meetingUrl: t.Optional(t.String({ format: "uri" })),
				status: t.Optional(
					t.Union([
						t.Literal("PENDING"),
						t.Literal("RECORDING"),
						t.Literal("COMPLETED"),
						t.Literal("FAILED"),
					]),
				),
				actualStart: t.Optional(t.String({ format: "date-time" })),
				actualEnd: t.Optional(t.String({ format: "date-time" })),
				scheduledStart: t.Optional(t.String({ format: "date-time" })),
				scheduledEnd: t.Optional(t.String({ format: "date-time" })),
				error: t.Optional(t.String()),
				metadata: t.Optional(t.Any()),
			}),
			detail: {
				tags: ["Meetings"],
				summary: "Update meeting",
				description:
					"Update meeting details, status, timestamps, or metadata",
			},
		},
	)
	.delete(
		"/:id",
		async ({ params: { id } }) => {
			// Check if meeting exists
			const existing = await db.meeting.findUnique({
				where: { id },
				include: {
					_count: {
						select: {
							recordings: true,
						},
					},
				},
			});

			if (!existing) {
				throw new NotFoundError("Meeting", id);
			}

			// Warn if deleting meeting with recordings
			if (existing._count.recordings > 0) {
				logger.warn(
					`Deleting meeting ${id} with ${existing._count.recordings} recordings`,
				);
			}

			await db.meeting.delete({
				where: { id },
			});

			logger.info(`Meeting deleted: ${id}`);

			return { success: true };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Meetings"],
				summary: "Delete meeting",
				description:
					"Delete a meeting and all associated recordings. This action is irreversible.",
			},
		},
	);
