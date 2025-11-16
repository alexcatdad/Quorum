import { Elysia, t } from "elysia";
import { SignJWT } from "jose";
import { db } from "@quorum/db";
import { ConflictError, UnauthorizedError } from "../types/errors";
import { logger } from "../utils/logger";
import { loadEnv } from "../utils/env";

const env = loadEnv();
const secret = new TextEncoder().encode(env.JWT_SECRET);

async function createToken(
	userId: string,
	organizationId: string,
	role: string,
	email: string,
): Promise<string> {
	return await new SignJWT({
		userId,
		organizationId,
		role,
		email,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setIssuer(env.JWT_ISSUER)
		.setAudience(env.JWT_AUDIENCE)
		.setExpirationTime("7d")
		.sign(secret);
}

export const authRoutes = new Elysia({ prefix: "/auth" })
	.post(
		"/register",
		async ({ body }) => {
			// Check if email already exists
			const existingUser = await db.user.findUnique({
				where: { email: body.email },
			});

			if (existingUser) {
				throw new ConflictError("User with this email already exists");
			}

			// Check if organization exists
			const organization = await db.organization.findUnique({
				where: { id: body.organizationId },
			});

			if (!organization) {
				// Create organization if it doesn't exist (for first user)
				const newOrg = await db.organization.create({
					data: {
						name: body.organizationName || "Default Organization",
						slug: body.organizationSlug || `org-${Date.now()}`,
					},
				});

				const user = await db.user.create({
					data: {
						email: body.email,
						name: body.name,
						role: "ADMIN", // First user is admin
						organizationId: newOrg.id,
					},
				});

				const token = await createToken(user.id, newOrg.id, user.role, user.email);

				logger.info(
					`User registered with new organization: ${user.id} (${user.email})`,
				);

				return {
					token,
					user: {
						id: user.id,
						email: user.email,
						name: user.name,
						role: user.role,
						organizationId: user.organizationId,
					},
				};
			}

			// Create user in existing organization
			const user = await db.user.create({
				data: {
					email: body.email,
					name: body.name,
					role: body.role || "MEMBER",
					organizationId: organization.id,
				},
			});

			const token = await createToken(
				user.id,
				organization.id,
				user.role,
				user.email,
			);

			logger.info(`User registered: ${user.id} (${user.email})`);

			return {
				token,
				user: {
					id: user.id,
					email: user.email,
					name: user.name,
					role: user.role,
					organizationId: user.organizationId,
				},
			};
		},
		{
			body: t.Object({
				email: t.String({ format: "email" }),
				name: t.String({ minLength: 1 }),
				organizationId: t.Optional(t.String()),
				organizationName: t.Optional(t.String()),
				organizationSlug: t.Optional(t.String()),
				role: t.Optional(
					t.Union([t.Literal("ADMIN"), t.Literal("MEMBER"), t.Literal("VIEWER")]),
				),
			}),
			detail: {
				tags: ["Auth"],
				summary: "Register new user",
				description:
					"Register a new user. If organizationId is not provided, a new organization will be created.",
			},
		},
	)
	.post(
		"/login",
		async ({ body }) => {
			// Find user by email
			const user = await db.user.findUnique({
				where: { email: body.email },
				include: {
					organization: true,
				},
			});

			if (!user) {
				throw new UnauthorizedError("Invalid credentials");
			}

			// In a real implementation, you would verify password here
			// For now, we'll just issue a token (password auth not implemented)

			const token = await createToken(
				user.id,
				user.organizationId,
				user.role,
				user.email,
			);

			logger.info(`User logged in: ${user.id} (${user.email})`);

			return {
				token,
				user: {
					id: user.id,
					email: user.email,
					name: user.name,
					role: user.role,
					organizationId: user.organizationId,
					organization: {
						id: user.organization.id,
						name: user.organization.name,
						slug: user.organization.slug,
					},
				},
			};
		},
		{
			body: t.Object({
				email: t.String({ format: "email" }),
				// password: t.String() // Add when implementing password auth
			}),
			detail: {
				tags: ["Auth"],
				summary: "Login user",
				description:
					"Authenticate user and receive JWT token. Note: Password authentication not yet implemented.",
			},
		},
	);
