import { randomBytes } from "node:crypto";
import { db } from "@quorum/db";
import { Elysia, t } from "elysia";
import { webhookService } from "../services/webhook";
import { NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";

// Generate a secure random secret for webhook signatures
function generateWebhookSecret(): string {
	return randomBytes(32).toString("hex");
}

// Available webhook events
const WebhookEventEnum = t.Union([
	t.Literal("MEETING_STARTED"),
	t.Literal("MEETING_COMPLETED"),
	t.Literal("MEETING_FAILED"),
	t.Literal("RECORDING_READY"),
	t.Literal("ENCODING_STARTED"),
	t.Literal("ENCODING_COMPLETED"),
	t.Literal("ENCODING_FAILED"),
	t.Literal("STREAM_CHUNK_READY"),
]);

export const webhooksRoutes = new Elysia({ prefix: "/webhooks" })
	// List webhooks
	.get(
		"/",
		async ({ query }) => {
			const where: any = {};

			if (query.organizationId) {
				where.organizationId = query.organizationId;
			}

			if (query.isActive !== undefined) {
				where.isActive = query.isActive;
			}

			const webhooks = await db.webhook.findMany({
				where,
				orderBy: { createdAt: "desc" },
				take: query.limit || 50,
				skip: query.offset || 0,
				select: {
					id: true,
					name: true,
					url: true,
					events: true,
					isActive: true,
					retryCount: true,
					timeoutMs: true,
					createdAt: true,
					updatedAt: true,
					organizationId: true,
					// Don't include secret in list response
					_count: {
						select: {
							deliveries: true,
						},
					},
				},
			});

			return { data: webhooks };
		},
		{
			query: t.Object({
				organizationId: t.Optional(t.String()),
				isActive: t.Optional(t.Boolean()),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ["Webhooks"],
				summary: "List webhooks",
				description:
					"Get a list of webhooks with optional filtering by organization and active status",
			},
		},
	)
	// Get webhook by ID
	.get(
		"/:id",
		async ({ params: { id } }) => {
			const webhook = await db.webhook.findUnique({
				where: { id },
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
					_count: {
						select: {
							deliveries: true,
						},
					},
				},
			});

			if (!webhook) {
				throw new NotFoundError("Webhook", id);
			}

			// Include secret in single webhook response (for configuration)
			return { data: webhook };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Webhooks"],
				summary: "Get webhook by ID",
				description: "Get detailed information about a specific webhook including the secret",
			},
		},
	)
	// Create webhook
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

			// Generate secret if not provided
			const secret = body.secret || generateWebhookSecret();

			const webhook = await db.webhook.create({
				data: {
					name: body.name,
					url: body.url,
					secret,
					events: body.events,
					isActive: body.isActive ?? true,
					headers: body.headers,
					retryCount: body.retryCount ?? 3,
					timeoutMs: body.timeoutMs ?? 30000,
					organizationId: body.organizationId,
				},
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
				},
			});

			logger.info(`Webhook created: ${webhook.id} - ${webhook.name} (${webhook.url})`);

			return { data: webhook };
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 255 }),
				url: t.String({ format: "uri" }),
				secret: t.Optional(t.String({ minLength: 16 })),
				events: t.Array(WebhookEventEnum, { minItems: 1 }),
				isActive: t.Optional(t.Boolean()),
				headers: t.Optional(t.Record(t.String(), t.String())),
				retryCount: t.Optional(t.Number({ minimum: 0, maximum: 10 })),
				timeoutMs: t.Optional(t.Number({ minimum: 1000, maximum: 60000 })),
				organizationId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Webhooks"],
				summary: "Create webhook",
				description:
					"Create a new webhook subscription. A secret will be auto-generated if not provided.",
			},
		},
	)
	// Update webhook
	.patch(
		"/:id",
		async ({ params: { id }, body }) => {
			const existing = await db.webhook.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Webhook", id);
			}

			const webhook = await db.webhook.update({
				where: { id },
				data: {
					...(body.name && { name: body.name }),
					...(body.url && { url: body.url }),
					...(body.events && { events: body.events }),
					...(body.isActive !== undefined && { isActive: body.isActive }),
					...(body.headers !== undefined && { headers: body.headers }),
					...(body.retryCount !== undefined && { retryCount: body.retryCount }),
					...(body.timeoutMs !== undefined && { timeoutMs: body.timeoutMs }),
				},
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
				},
			});

			logger.info(`Webhook updated: ${webhook.id} - ${webhook.name}`);

			return { data: webhook };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			body: t.Object({
				name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
				url: t.Optional(t.String({ format: "uri" })),
				events: t.Optional(t.Array(WebhookEventEnum, { minItems: 1 })),
				isActive: t.Optional(t.Boolean()),
				headers: t.Optional(t.Record(t.String(), t.String())),
				retryCount: t.Optional(t.Number({ minimum: 0, maximum: 10 })),
				timeoutMs: t.Optional(t.Number({ minimum: 1000, maximum: 60000 })),
			}),
			detail: {
				tags: ["Webhooks"],
				summary: "Update webhook",
				description:
					"Update webhook configuration. Secret cannot be updated - delete and recreate instead.",
			},
		},
	)
	// Regenerate webhook secret
	.post(
		"/:id/regenerate-secret",
		async ({ params: { id } }) => {
			const existing = await db.webhook.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Webhook", id);
			}

			const newSecret = generateWebhookSecret();

			const webhook = await db.webhook.update({
				where: { id },
				data: {
					secret: newSecret,
				},
			});

			logger.info(`Webhook secret regenerated: ${webhook.id}`);

			return {
				data: {
					id: webhook.id,
					secret: webhook.secret,
					message:
						"Secret regenerated successfully. Update your webhook consumer with the new secret.",
				},
			};
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Webhooks"],
				summary: "Regenerate webhook secret",
				description: "Generate a new secret for the webhook. The old secret will no longer work.",
			},
		},
	)
	// Delete webhook
	.delete(
		"/:id",
		async ({ params: { id } }) => {
			const existing = await db.webhook.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Webhook", id);
			}

			await db.webhook.delete({
				where: { id },
			});

			logger.info(`Webhook deleted: ${id}`);

			return { success: true };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Webhooks"],
				summary: "Delete webhook",
				description: "Permanently delete a webhook and all its delivery history",
			},
		},
	)
	// Test webhook
	.post(
		"/:id/test",
		async ({ params: { id } }) => {
			const result = await webhookService.test(id);

			return {
				data: {
					success: result.success,
					deliveryId: result.deliveryId,
					statusCode: result.statusCode,
					error: result.error,
					duration: result.duration,
				},
			};
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Webhooks"],
				summary: "Test webhook",
				description: "Send a test payload to the webhook endpoint to verify configuration",
			},
		},
	)
	// Get webhook delivery history
	.get(
		"/:id/deliveries",
		async ({ params: { id }, query }) => {
			const existing = await db.webhook.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Webhook", id);
			}

			const deliveries = await webhookService.getDeliveryHistory(id, query.limit || 50);

			return { data: deliveries };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			query: t.Object({
				limit: t.Optional(t.Number({ minimum: 1, maximum: 200 })),
			}),
			detail: {
				tags: ["Webhooks"],
				summary: "Get webhook delivery history",
				description: "Get the delivery history for a webhook, ordered by most recent first",
			},
		},
	)
	// Get webhook stats for organization
	.get(
		"/stats/:organizationId",
		async ({ params: { organizationId } }) => {
			const organization = await db.organization.findUnique({
				where: { id: organizationId },
			});

			if (!organization) {
				throw new NotFoundError("Organization", organizationId);
			}

			const stats = await webhookService.getStats(organizationId);

			return { data: stats };
		},
		{
			params: t.Object({
				organizationId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Webhooks"],
				summary: "Get webhook statistics",
				description: "Get webhook delivery statistics for an organization",
			},
		},
	);
