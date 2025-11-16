import { Elysia, t } from "elysia";
import { db } from "@quorum/db";
import { NotFoundError, ConflictError, ValidationError } from "../types/errors";
import { logger } from "../utils/logger";

export const organizationsRoutes = new Elysia({ prefix: "/organizations" })
	.get(
		"/",
		async () => {
			const organizations = await db.organization.findMany({
				orderBy: { createdAt: "desc" },
				include: {
					_count: {
						select: {
							users: true,
							botAccounts: true,
							meetings: true,
						},
					},
				},
			});

			return { data: organizations };
		},
		{
			detail: {
				tags: ["Organizations"],
				summary: "List all organizations",
				description: "Get a list of all organizations",
			},
		},
	)
	.get(
		"/:id",
		async ({ params: { id } }) => {
			const organization = await db.organization.findUnique({
				where: { id },
				include: {
					users: {
						select: {
							id: true,
							email: true,
							name: true,
							role: true,
							createdAt: true,
						},
					},
					botAccounts: true,
					_count: {
						select: {
							meetings: true,
							recordings: true,
						},
					},
				},
			});

			if (!organization) {
				throw new NotFoundError("Organization", id);
			}

			return { data: organization };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Organizations"],
				summary: "Get organization by ID",
				description: "Get detailed information about a specific organization",
			},
		},
	)
	.post(
		"/",
		async ({ body }) => {
			// Check if slug is already taken
			const existing = await db.organization.findUnique({
				where: { slug: body.slug },
			});

			if (existing) {
				throw new ConflictError(
					`Organization with slug '${body.slug}' already exists`,
				);
			}

			const organization = await db.organization.create({
				data: {
					name: body.name,
					slug: body.slug,
				},
			});

			logger.info(`Organization created: ${organization.id} (${organization.name})`);

			return { data: organization };
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 255 }),
				slug: t.String({
					minLength: 1,
					maxLength: 100,
					pattern: "^[a-z0-9-]+$",
				}),
			}),
			detail: {
				tags: ["Organizations"],
				summary: "Create organization",
				description:
					"Create a new organization. Slug must be lowercase alphanumeric with hyphens only.",
			},
		},
	)
	.patch(
		"/:id",
		async ({ params: { id }, body }) => {
			// Check if organization exists
			const existing = await db.organization.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Organization", id);
			}

			// If slug is being updated, check for conflicts
			if (body.slug && body.slug !== existing.slug) {
				const slugTaken = await db.organization.findUnique({
					where: { slug: body.slug },
				});

				if (slugTaken) {
					throw new ConflictError(
						`Organization with slug '${body.slug}' already exists`,
					);
				}
			}

			const organization = await db.organization.update({
				where: { id },
				data: {
					...(body.name && { name: body.name }),
					...(body.slug && { slug: body.slug }),
				},
			});

			logger.info(`Organization updated: ${organization.id}`);

			return { data: organization };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			body: t.Object({
				name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
				slug: t.Optional(
					t.String({
						minLength: 1,
						maxLength: 100,
						pattern: "^[a-z0-9-]+$",
					}),
				),
			}),
			detail: {
				tags: ["Organizations"],
				summary: "Update organization",
				description: "Update organization details",
			},
		},
	)
	.delete(
		"/:id",
		async ({ params: { id } }) => {
			// Check if organization exists
			const existing = await db.organization.findUnique({
				where: { id },
				include: {
					_count: {
						select: {
							users: true,
							meetings: true,
							recordings: true,
						},
					},
				},
			});

			if (!existing) {
				throw new NotFoundError("Organization", id);
			}

			// Warn if deleting organization with data
			if (
				existing._count.users > 0 ||
				existing._count.meetings > 0 ||
				existing._count.recordings > 0
			) {
				logger.warn(
					`Deleting organization ${id} with ${existing._count.users} users, ${existing._count.meetings} meetings, and ${existing._count.recordings} recordings`,
				);
			}

			await db.organization.delete({
				where: { id },
			});

			logger.info(`Organization deleted: ${id}`);

			return { success: true };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Organizations"],
				summary: "Delete organization",
				description:
					"Delete an organization and all associated data (users, meetings, recordings). This action is irreversible.",
			},
		},
	);
