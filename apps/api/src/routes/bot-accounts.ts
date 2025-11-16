import { Elysia, t } from "elysia";
import { db } from "@quorum/db";
import { NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";

export const botAccountsRoutes = new Elysia({ prefix: "/bot-accounts" })
	.get(
		"/",
		async ({ query }) => {
			const where = query.organizationId
				? { organizationId: query.organizationId }
				: undefined;

			const botAccounts = await db.botAccount.findMany({
				where,
				orderBy: { createdAt: "desc" },
				select: {
					id: true,
					name: true,
					platform: true,
					username: true,
					isActive: true,
					organizationId: true,
					createdAt: true,
					updatedAt: true,
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					// Don't return credentials in list
				},
			});

			return { data: botAccounts };
		},
		{
			query: t.Object({
				organizationId: t.Optional(t.String()),
			}),
			detail: {
				tags: ["BotAccounts"],
				summary: "List bot accounts",
				description:
					"Get a list of bot accounts, optionally filtered by organization ID",
			},
		},
	)
	.get(
		"/:id",
		async ({ params: { id } }) => {
			const botAccount = await db.botAccount.findUnique({
				where: { id },
				select: {
					id: true,
					name: true,
					platform: true,
					username: true,
					isActive: true,
					organizationId: true,
					createdAt: true,
					updatedAt: true,
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					// Don't return credentials JSON for security
				},
			});

			if (!botAccount) {
				throw new NotFoundError("BotAccount", id);
			}

			return { data: botAccount };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["BotAccounts"],
				summary: "Get bot account by ID",
				description:
					"Get detailed information about a specific bot account (credentials not included)",
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

			const botAccount = await db.botAccount.create({
				data: {
					name: body.name,
					platform: body.platform,
					username: body.username,
					credentials: body.credentials,
					isActive: body.isActive ?? true,
					organizationId: body.organizationId,
				},
				select: {
					id: true,
					name: true,
					platform: true,
					username: true,
					isActive: true,
					organizationId: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			logger.info(
				`Bot account created: ${botAccount.id} (${botAccount.platform} - ${botAccount.username})`,
			);

			return { data: botAccount };
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 255 }),
				platform: t.Union([
					t.Literal("TEAMS"),
					t.Literal("SLACK"),
					t.Literal("YOUTUBE"),
				]),
				username: t.String({ minLength: 1, maxLength: 255 }),
				credentials: t.Any(), // JSON object
				isActive: t.Optional(t.Boolean()),
				organizationId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["BotAccounts"],
				summary: "Create bot account",
				description:
					"Create a new bot account with encrypted credentials. Credentials should be a JSON object containing platform-specific authentication data.",
			},
		},
	)
	.patch(
		"/:id",
		async ({ params: { id }, body }) => {
			// Check if bot account exists
			const existing = await db.botAccount.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("BotAccount", id);
			}

			const botAccount = await db.botAccount.update({
				where: { id },
				data: {
					...(body.name && { name: body.name }),
					...(body.platform && { platform: body.platform }),
					...(body.username && { username: body.username }),
					...(body.credentials && { credentials: body.credentials }),
					...(typeof body.isActive === "boolean" && { isActive: body.isActive }),
				},
				select: {
					id: true,
					name: true,
					platform: true,
					username: true,
					isActive: true,
					organizationId: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			logger.info(`Bot account updated: ${botAccount.id}`);

			return { data: botAccount };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			body: t.Object({
				name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
				platform: t.Optional(
					t.Union([
						t.Literal("TEAMS"),
						t.Literal("SLACK"),
						t.Literal("YOUTUBE"),
					]),
				),
				username: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
				credentials: t.Optional(t.Any()),
				isActive: t.Optional(t.Boolean()),
			}),
			detail: {
				tags: ["BotAccounts"],
				summary: "Update bot account",
				description: "Update bot account details and credentials",
			},
		},
	)
	.delete(
		"/:id",
		async ({ params: { id } }) => {
			// Check if bot account exists
			const existing = await db.botAccount.findUnique({
				where: { id },
				include: {
					_count: {
						select: {
							meetings: true,
						},
					},
				},
			});

			if (!existing) {
				throw new NotFoundError("BotAccount", id);
			}

			// Warn if deleting bot account with meetings
			if (existing._count.meetings > 0) {
				logger.warn(
					`Deleting bot account ${id} with ${existing._count.meetings} associated meetings`,
				);
			}

			await db.botAccount.delete({
				where: { id },
			});

			logger.info(`Bot account deleted: ${id}`);

			return { success: true };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["BotAccounts"],
				summary: "Delete bot account",
				description:
					"Delete a bot account. Associated meetings will be updated. This action is irreversible.",
			},
		},
	);
