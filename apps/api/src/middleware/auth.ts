import type { Elysia } from "elysia";
import { jwtVerify, type JWTPayload } from "jose";
import { UnauthorizedError, ForbiddenError } from "../types/errors";
import type { AuthContext } from "../types/context";
import { logger } from "../utils/logger";

interface JWTCustomPayload extends JWTPayload {
	userId: string;
	organizationId: string;
	role: "ADMIN" | "MEMBER" | "VIEWER";
	email: string;
}

export function createAuthMiddleware(jwtSecret: string, issuer: string, audience: string) {
	const secret = new TextEncoder().encode(jwtSecret);

	return async (request: Request): Promise<AuthContext | undefined> => {
		const authHeader = request.headers.get("authorization");

		if (!authHeader) {
			return undefined;
		}

		if (!authHeader.startsWith("Bearer ")) {
			throw new UnauthorizedError("Invalid authorization header format");
		}

		const token = authHeader.substring(7);

		try {
			const { payload } = await jwtVerify<JWTCustomPayload>(token, secret, {
				issuer,
				audience,
			});

			if (
				!payload.userId ||
				!payload.organizationId ||
				!payload.role ||
				!payload.email
			) {
				throw new UnauthorizedError("Invalid token payload");
			}

			return {
				userId: payload.userId,
				organizationId: payload.organizationId,
				role: payload.role,
				email: payload.email,
			};
		} catch (error) {
			logger.warn("JWT verification failed", { error });
			throw new UnauthorizedError("Invalid or expired token");
		}
	};
}

export function requireAuth(app: Elysia, jwtSecret: string, issuer: string, audience: string) {
	const authMiddleware = createAuthMiddleware(jwtSecret, issuer, audience);

	return app.derive(async ({ request, store }) => {
		const auth = await authMiddleware(request);

		if (!auth) {
			throw new UnauthorizedError("Authentication required");
		}

		(store as any).auth = auth;
		return { auth };
	});
}

export function requireRole(
	app: Elysia,
	roles: Array<"ADMIN" | "MEMBER" | "VIEWER">,
) {
	return app.derive(({ store }) => {
		const auth = (store as any).auth as AuthContext | undefined;

		if (!auth) {
			throw new UnauthorizedError("Authentication required");
		}

		if (!roles.includes(auth.role)) {
			throw new ForbiddenError(
				`This action requires one of the following roles: ${roles.join(", ")}`,
			);
		}

		return {};
	});
}
