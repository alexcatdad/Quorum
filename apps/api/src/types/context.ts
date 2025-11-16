import type { PrismaClient } from "@quorum/db";

export interface AuthContext {
	userId: string;
	organizationId: string;
	role: "ADMIN" | "MEMBER" | "VIEWER";
	email: string;
}

export interface RequestContext {
	db: PrismaClient;
	auth?: AuthContext;
}
