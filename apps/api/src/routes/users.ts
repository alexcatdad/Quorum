import { db } from "@quorum/db";
import { Elysia, t } from "elysia";
import { ConflictError, NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";

export const usersRoutes = new Elysia({ prefix: "/users" })
	.get(
		"/",
		async ({ query }) => {
			const where = query.organizationId ? { organizationId: query.organizationId } : undefined;

			const users = await db.user.findMany({
				where,
				orderBy: { createdAt: "desc" },
				select: {
					id: true,
					email: true,
					name: true,
					role: true,
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
				},
			});

			return { data: users };
		},
		{
			query: t.Object({
				organizationId: t.Optional(t.String()),
			}),
			detail: {
				tags: ["Users"],
				summary: "List users",
				description: "Get a list of users, optionally filtered by organization ID",
			},
		},
	)
	.get(
		"/:id",
		async ({ params: { id } }) => {
			const user = await db.user.findUnique({
				where: { id },
				select: {
					id: true,
					email: true,
					name: true,
					role: true,
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
				},
			});

			if (!user) {
				throw new NotFoundError("User", id);
			}

			return { data: user };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Users"],
				summary: "Get user by ID",
				description: "Get detailed information about a specific user",
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

			// Check if email is already taken
			const existing = await db.user.findUnique({
				where: { email: body.email },
			});

			if (existing) {
				throw new ConflictError(`User with email '${body.email}' already exists`);
			}

			const user = await db.user.create({
				data: {
					email: body.email,
					name: body.name,
					role: body.role || "MEMBER",
					organizationId: body.organizationId,
				},
				select: {
					id: true,
					email: true,
					name: true,
					role: true,
					organizationId: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			logger.info(`User created: ${user.id} (${user.email})`);

			return { data: user };
		},
		{
			body: t.Object({
				email: t.String({ format: "email" }),
				name: t.String({ minLength: 1, maxLength: 255 }),
				role: t.Optional(t.Union([t.Literal("ADMIN"), t.Literal("MEMBER"), t.Literal("VIEWER")])),
				organizationId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Users"],
				summary: "Create user",
				description: "Create a new user. Role defaults to MEMBER if not specified.",
			},
		},
	)
	.patch(
		"/:id",
		async ({ params: { id }, body }) => {
			// Check if user exists
			const existing = await db.user.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("User", id);
			}

			// If email is being updated, check for conflicts
			if (body.email && body.email !== existing.email) {
				const emailTaken = await db.user.findUnique({
					where: { email: body.email },
				});

				if (emailTaken) {
					throw new ConflictError(`User with email '${body.email}' already exists`);
				}
			}

			const user = await db.user.update({
				where: { id },
				data: {
					...(body.email && { email: body.email }),
					...(body.name && { name: body.name }),
					...(body.role && { role: body.role }),
				},
				select: {
					id: true,
					email: true,
					name: true,
					role: true,
					organizationId: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			logger.info(`User updated: ${user.id}`);

			return { data: user };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			body: t.Object({
				email: t.Optional(t.String({ format: "email" })),
				name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
				role: t.Optional(t.Union([t.Literal("ADMIN"), t.Literal("MEMBER"), t.Literal("VIEWER")])),
			}),
			detail: {
				tags: ["Users"],
				summary: "Update user",
				description: "Update user details",
			},
		},
	)
	.delete(
		"/:id",
		async ({ params: { id } }) => {
			// Check if user exists
			const existing = await db.user.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("User", id);
			}

			await db.user.delete({
				where: { id },
			});

			logger.info(`User deleted: ${id}`);

			return { success: true };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Users"],
				summary: "Delete user",
				description: "Delete a user. This action is irreversible.",
			},
		},
	);
