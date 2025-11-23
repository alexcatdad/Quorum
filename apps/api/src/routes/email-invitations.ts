import { Elysia, t } from "elysia";
import { db } from "@quorum/db";
import { NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";
import { emailService } from "../services/email";

// Email invitation status enum
const EmailInvitationStatusEnum = t.Union([
	t.Literal("PENDING"),
	t.Literal("PROCESSED"),
	t.Literal("INVALID"),
	t.Literal("FAILED"),
]);

export const emailInvitationsRoutes = new Elysia({ prefix: "/email-invitations" })
	// List email invitations
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

			const invitations = await db.emailInvitation.findMany({
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
							status: true,
						},
					},
				},
			});

			return { data: invitations };
		},
		{
			query: t.Object({
				organizationId: t.Optional(t.String()),
				status: t.Optional(EmailInvitationStatusEnum),
				platform: t.Optional(t.Union([
					t.Literal("TEAMS"),
					t.Literal("SLACK"),
					t.Literal("YOUTUBE"),
				])),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ["EmailInvitations"],
				summary: "List email invitations",
				description: "Get a list of email invitations with optional filtering",
			},
		},
	)
	// Get email invitation by ID
	.get(
		"/:id",
		async ({ params: { id } }) => {
			const invitation = await db.emailInvitation.findUnique({
				where: { id },
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					meeting: true,
				},
			});

			if (!invitation) {
				throw new NotFoundError("EmailInvitation", id);
			}

			return { data: invitation };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["EmailInvitations"],
				summary: "Get email invitation by ID",
				description: "Get detailed information about a specific email invitation",
			},
		},
	)
	// Process incoming email (webhook endpoint)
	.post(
		"/incoming",
		async ({ body }) => {
			const invitation = await emailService.processIncomingEmail(
				body.organizationId,
				{
					from: body.from,
					to: body.to,
					subject: body.subject,
					bodyText: body.bodyText,
					bodyHtml: body.bodyHtml,
					headers: body.headers,
					attachments: body.attachments,
				},
			);

			return { data: invitation };
		},
		{
			body: t.Object({
				organizationId: t.String({ minLength: 1 }),
				from: t.String({ minLength: 1 }),
				to: t.String({ minLength: 1 }),
				subject: t.String({ minLength: 1 }),
				bodyText: t.Optional(t.String()),
				bodyHtml: t.Optional(t.String()),
				headers: t.Optional(t.Record(t.String(), t.String())),
				attachments: t.Optional(t.Array(t.Object({
					filename: t.String(),
					contentType: t.String(),
					content: t.String(),
				}))),
			}),
			detail: {
				tags: ["EmailInvitations"],
				summary: "Process incoming email",
				description: "Webhook endpoint to process incoming email invitations. Parse meeting URLs and create invitation records.",
			},
		},
	)
	// Schedule meeting from invitation
	.post(
		"/:id/schedule",
		async ({ params: { id } }) => {
			await emailService.scheduleMeetingFromInvitation(id);

			const invitation = await db.emailInvitation.findUnique({
				where: { id },
				include: {
					meeting: true,
				},
			});

			return { data: invitation };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["EmailInvitations"],
				summary: "Schedule meeting from invitation",
				description: "Create a meeting from an email invitation",
			},
		},
	)
	// Bulk schedule all pending invitations
	.post(
		"/schedule-pending/:organizationId",
		async ({ params: { organizationId } }) => {
			const pending = await emailService.getPendingInvitations(organizationId);

			const results = {
				total: pending.length,
				scheduled: 0,
				failed: 0,
				errors: [] as string[],
			};

			for (const invitation of pending) {
				try {
					await emailService.scheduleMeetingFromInvitation(invitation.id);
					results.scheduled++;
				} catch (error) {
					results.failed++;
					results.errors.push(`${invitation.id}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}

			return { data: results };
		},
		{
			params: t.Object({
				organizationId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["EmailInvitations"],
				summary: "Schedule all pending invitations",
				description: "Create meetings from all pending email invitations for an organization",
			},
		},
	)
	// Delete email invitation
	.delete(
		"/:id",
		async ({ params: { id } }) => {
			const existing = await db.emailInvitation.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("EmailInvitation", id);
			}

			await db.emailInvitation.delete({
				where: { id },
			});

			logger.info(`Email invitation deleted: ${id}`);

			return { success: true };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["EmailInvitations"],
				summary: "Delete email invitation",
				description: "Permanently delete an email invitation",
			},
		},
	)
	// Get invitation statistics
	.get(
		"/stats/:organizationId",
		async ({ params: { organizationId } }) => {
			const stats = await emailService.getStats(organizationId);

			return { data: stats };
		},
		{
			params: t.Object({
				organizationId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["EmailInvitations"],
				summary: "Get invitation statistics",
				description: "Get email invitation statistics for an organization",
			},
		},
	);
