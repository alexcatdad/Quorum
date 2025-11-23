import { db } from "@quorum/db";
import { Elysia, t } from "elysia";
import { SignJWT } from "jose";
import { ConflictError, UnauthorizedError, ValidationError } from "../types/errors";
import { loadEnv } from "../utils/env";
import { logger } from "../utils/logger";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../utils/password";

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
			// Validate password strength if provided
			if (body.password) {
				const passwordValidation = validatePasswordStrength(body.password);
				if (!passwordValidation.valid) {
					throw new ValidationError("Password does not meet requirements", {
						errors: passwordValidation.errors,
					});
				}
			}

			// Check if email already exists
			const existingUser = await db.user.findUnique({
				where: { email: body.email },
			});

			if (existingUser) {
				throw new ConflictError("User with this email already exists");
			}

			// Hash password if provided
			const passwordHash = body.password ? await hashPassword(body.password) : undefined;

			// Check if organization exists
			const organization = body.organizationId
				? await db.organization.findUnique({
						where: { id: body.organizationId },
					})
				: null;

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
						...(passwordHash && { passwordHash }),
					},
				});

				const token = await createToken(user.id, newOrg.id, user.role, user.email);

				logger.info(`User registered with new organization: ${user.id} (${user.email})`);

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
					...(passwordHash && { passwordHash }),
				},
			});

			const token = await createToken(user.id, organization.id, user.role, user.email);

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
				password: t.Optional(t.String({ minLength: 8 })),
				organizationId: t.Optional(t.String()),
				organizationName: t.Optional(t.String()),
				organizationSlug: t.Optional(t.String()),
				role: t.Optional(t.Union([t.Literal("ADMIN"), t.Literal("MEMBER"), t.Literal("VIEWER")])),
			}),
			detail: {
				tags: ["Auth"],
				summary: "Register new user",
				description:
					"Register a new user with optional password. If organizationId is not provided, a new organization will be created. Password must be at least 8 characters with uppercase, lowercase, number, and special character.",
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

			// Verify password if provided and user has passwordHash
			if (body.password && (user as any).passwordHash) {
				const isValid = await verifyPassword(body.password, (user as any).passwordHash);
				if (!isValid) {
					logger.warn(`Failed login attempt for user: ${user.email}`);
					throw new UnauthorizedError("Invalid credentials");
				}
			} else if (body.password && !(user as any).passwordHash) {
				// User has no password set, but password was provided
				throw new UnauthorizedError("Invalid credentials");
			} else if (!body.password && (user as any).passwordHash) {
				// User has password set, but none was provided
				throw new UnauthorizedError("Password required");
			}

			const token = await createToken(user.id, user.organizationId, user.role, user.email);

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
				password: t.Optional(t.String()),
			}),
			detail: {
				tags: ["Auth"],
				summary: "Login user",
				description:
					"Authenticate user and receive JWT token. Password is optional for backwards compatibility but recommended.",
			},
		},
	)
	.post(
		"/change-password",
		async ({ body }) => {
			// Find user by email
			const user = await db.user.findUnique({
				where: { email: body.email },
			});

			if (!user) {
				throw new UnauthorizedError("Invalid credentials");
			}

			// Verify current password if user has one
			if ((user as any).passwordHash) {
				const isValid = await verifyPassword(body.currentPassword, (user as any).passwordHash);
				if (!isValid) {
					throw new UnauthorizedError("Current password is incorrect");
				}
			}

			// Validate new password strength
			const passwordValidation = validatePasswordStrength(body.newPassword);
			if (!passwordValidation.valid) {
				throw new ValidationError("New password does not meet requirements", {
					errors: passwordValidation.errors,
				});
			}

			// Hash and update password
			const newPasswordHash = await hashPassword(body.newPassword);
			await db.user.update({
				where: { id: user.id },
				data: { passwordHash: newPasswordHash },
			});

			logger.info(`Password changed for user: ${user.id} (${user.email})`);

			return {
				success: true,
				message: "Password updated successfully",
			};
		},
		{
			body: t.Object({
				email: t.String({ format: "email" }),
				currentPassword: t.String(),
				newPassword: t.String({ minLength: 8 }),
			}),
			detail: {
				tags: ["Auth"],
				summary: "Change password",
				description: "Change user password. Requires current password for verification.",
			},
		},
	);
