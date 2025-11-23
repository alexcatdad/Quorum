import { db } from "@quorum/db";
import type { WebhookEvent, Webhook, WebhookDelivery } from "@prisma/client";
import { createHmac } from "node:crypto";
import { logger, createChildLogger } from "../utils/logger";

const webhookLogger = createChildLogger("webhook");

export interface WebhookPayload {
	event: WebhookEvent;
	timestamp: string;
	data: Record<string, unknown>;
}

export interface WebhookDeliveryResult {
	success: boolean;
	webhookId: string;
	deliveryId: string;
	statusCode?: number;
	error?: string;
	duration?: number;
}

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
function generateSignature(payload: string, secret: string): string {
	return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Deliver a webhook with retry logic
 */
async function deliverWebhook(
	webhook: Webhook,
	payload: WebhookPayload,
	attempt: number = 1,
): Promise<WebhookDeliveryResult> {
	const payloadJson = JSON.stringify(payload);
	const signature = generateSignature(payloadJson, webhook.secret);
	const startTime = Date.now();

	// Prepare headers
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-Webhook-Signature": `sha256=${signature}`,
		"X-Webhook-Event": payload.event,
		"X-Webhook-Timestamp": payload.timestamp,
		"X-Webhook-Id": webhook.id,
		...(webhook.headers as Record<string, string> || {}),
	};

	let delivery: WebhookDelivery | null = null;

	try {
		// Create delivery record
		delivery = await db.webhookDelivery.create({
			data: {
				webhookId: webhook.id,
				event: payload.event,
				payload: payload as any,
				attempt,
			},
		});

		// Make the request
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), webhook.timeoutMs);

		const response = await fetch(webhook.url, {
			method: "POST",
			headers,
			body: payloadJson,
			signal: controller.signal,
		});

		clearTimeout(timeout);

		const duration = Date.now() - startTime;
		const responseBody = await response.text().catch(() => "");

		// Update delivery record
		await db.webhookDelivery.update({
			where: { id: delivery.id },
			data: {
				responseStatus: response.status,
				responseBody: responseBody.slice(0, 1000), // Truncate response
				duration,
				success: response.ok,
			},
		});

		if (response.ok) {
			webhookLogger.info("Webhook delivered successfully", {
				webhookId: webhook.id,
				event: payload.event,
				statusCode: response.status,
				duration,
			});

			return {
				success: true,
				webhookId: webhook.id,
				deliveryId: delivery.id,
				statusCode: response.status,
				duration,
			};
		}

		// Non-2xx response - may retry
		webhookLogger.warn("Webhook delivery failed with non-2xx status", {
			webhookId: webhook.id,
			event: payload.event,
			statusCode: response.status,
			attempt,
		});

		// Retry if attempts remaining
		if (attempt < webhook.retryCount) {
			const backoffMs = Math.pow(2, attempt) * 1000; // Exponential backoff
			webhookLogger.info(`Retrying webhook in ${backoffMs}ms`, {
				webhookId: webhook.id,
				attempt: attempt + 1,
			});

			await new Promise((resolve) => setTimeout(resolve, backoffMs));
			return deliverWebhook(webhook, payload, attempt + 1);
		}

		return {
			success: false,
			webhookId: webhook.id,
			deliveryId: delivery.id,
			statusCode: response.status,
			error: `HTTP ${response.status}: ${responseBody.slice(0, 200)}`,
			duration,
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		// Update delivery record with error
		if (delivery) {
			await db.webhookDelivery.update({
				where: { id: delivery.id },
				data: {
					error: errorMessage,
					duration,
					success: false,
				},
			});
		}

		webhookLogger.error("Webhook delivery error", {
			webhookId: webhook.id,
			event: payload.event,
			error: errorMessage,
			attempt,
		});

		// Retry if attempts remaining
		if (attempt < webhook.retryCount) {
			const backoffMs = Math.pow(2, attempt) * 1000;
			webhookLogger.info(`Retrying webhook in ${backoffMs}ms`, {
				webhookId: webhook.id,
				attempt: attempt + 1,
			});

			await new Promise((resolve) => setTimeout(resolve, backoffMs));
			return deliverWebhook(webhook, payload, attempt + 1);
		}

		return {
			success: false,
			webhookId: webhook.id,
			deliveryId: delivery?.id || "unknown",
			error: errorMessage,
			duration,
		};
	}
}

export class WebhookService {
	/**
	 * Trigger webhooks for a specific event
	 */
	async trigger(
		organizationId: string,
		event: WebhookEvent,
		data: Record<string, unknown>,
	): Promise<WebhookDeliveryResult[]> {
		// Find all active webhooks for this organization and event
		const webhooks = await db.webhook.findMany({
			where: {
				organizationId,
				isActive: true,
				events: {
					has: event,
				},
			},
		});

		if (webhooks.length === 0) {
			webhookLogger.debug("No webhooks found for event", {
				organizationId,
				event,
			});
			return [];
		}

		webhookLogger.info(`Triggering ${webhooks.length} webhooks for event`, {
			organizationId,
			event,
			webhookCount: webhooks.length,
		});

		const payload: WebhookPayload = {
			event,
			timestamp: new Date().toISOString(),
			data,
		};

		// Deliver to all webhooks in parallel
		const results = await Promise.all(
			webhooks.map((webhook) => deliverWebhook(webhook, payload)),
		);

		const successCount = results.filter((r) => r.success).length;
		webhookLogger.info("Webhook batch completed", {
			event,
			total: webhooks.length,
			success: successCount,
			failed: webhooks.length - successCount,
		});

		return results;
	}

	/**
	 * Trigger meeting started event
	 */
	async triggerMeetingStarted(
		organizationId: string,
		meetingId: string,
		metadata: Record<string, unknown> = {},
	) {
		return this.trigger(organizationId, "MEETING_STARTED", {
			meetingId,
			...metadata,
		});
	}

	/**
	 * Trigger meeting completed event
	 */
	async triggerMeetingCompleted(
		organizationId: string,
		meetingId: string,
		recordingId: string,
		metadata: Record<string, unknown> = {},
	) {
		return this.trigger(organizationId, "MEETING_COMPLETED", {
			meetingId,
			recordingId,
			...metadata,
		});
	}

	/**
	 * Trigger meeting failed event
	 */
	async triggerMeetingFailed(
		organizationId: string,
		meetingId: string,
		error: string,
		metadata: Record<string, unknown> = {},
	) {
		return this.trigger(organizationId, "MEETING_FAILED", {
			meetingId,
			error,
			...metadata,
		});
	}

	/**
	 * Trigger recording ready event (file available for download)
	 */
	async triggerRecordingReady(
		organizationId: string,
		recordingId: string,
		downloadUrl: string,
		metadata: Record<string, unknown> = {},
	) {
		return this.trigger(organizationId, "RECORDING_READY", {
			recordingId,
			downloadUrl,
			...metadata,
		});
	}

	/**
	 * Trigger encoding started event
	 */
	async triggerEncodingStarted(
		organizationId: string,
		recordingId: string,
		metadata: Record<string, unknown> = {},
	) {
		return this.trigger(organizationId, "ENCODING_STARTED", {
			recordingId,
			...metadata,
		});
	}

	/**
	 * Trigger encoding completed event
	 */
	async triggerEncodingCompleted(
		organizationId: string,
		recordingId: string,
		downloadUrl: string,
		metadata: Record<string, unknown> = {},
	) {
		return this.trigger(organizationId, "ENCODING_COMPLETED", {
			recordingId,
			downloadUrl,
			...metadata,
		});
	}

	/**
	 * Trigger encoding failed event
	 */
	async triggerEncodingFailed(
		organizationId: string,
		recordingId: string,
		error: string,
		metadata: Record<string, unknown> = {},
	) {
		return this.trigger(organizationId, "ENCODING_FAILED", {
			recordingId,
			error,
			...metadata,
		});
	}

	/**
	 * Trigger stream chunk ready event (for real-time streaming)
	 */
	async triggerStreamChunkReady(
		organizationId: string,
		meetingId: string,
		chunkUrl: string,
		chunkIndex: number,
		metadata: Record<string, unknown> = {},
	) {
		return this.trigger(organizationId, "STREAM_CHUNK_READY", {
			meetingId,
			chunkUrl,
			chunkIndex,
			...metadata,
		});
	}

	/**
	 * Test a webhook by sending a test payload
	 */
	async test(webhookId: string): Promise<WebhookDeliveryResult> {
		const webhook = await db.webhook.findUnique({
			where: { id: webhookId },
		});

		if (!webhook) {
			return {
				success: false,
				webhookId,
				deliveryId: "none",
				error: "Webhook not found",
			};
		}

		const testPayload: WebhookPayload = {
			event: webhook.events[0] || "MEETING_STARTED",
			timestamp: new Date().toISOString(),
			data: {
				test: true,
				message: "This is a test webhook delivery from Quorum",
			},
		};

		return deliverWebhook(webhook, testPayload);
	}

	/**
	 * Get delivery history for a webhook
	 */
	async getDeliveryHistory(
		webhookId: string,
		limit: number = 50,
	): Promise<WebhookDelivery[]> {
		return db.webhookDelivery.findMany({
			where: { webhookId },
			orderBy: { createdAt: "desc" },
			take: limit,
		});
	}

	/**
	 * Get delivery statistics for an organization
	 */
	async getStats(organizationId: string) {
		const webhooks = await db.webhook.findMany({
			where: { organizationId },
			include: {
				_count: {
					select: {
						deliveries: true,
					},
				},
			},
		});

		const [totalDeliveries, successfulDeliveries, failedDeliveries] = await Promise.all([
			db.webhookDelivery.count({
				where: { webhook: { organizationId } },
			}),
			db.webhookDelivery.count({
				where: { webhook: { organizationId }, success: true },
			}),
			db.webhookDelivery.count({
				where: { webhook: { organizationId }, success: false },
			}),
		]);

		return {
			webhookCount: webhooks.length,
			activeWebhooks: webhooks.filter((w) => w.isActive).length,
			totalDeliveries,
			successfulDeliveries,
			failedDeliveries,
			successRate: totalDeliveries > 0
				? ((successfulDeliveries / totalDeliveries) * 100).toFixed(2) + "%"
				: "N/A",
		};
	}
}

export const webhookService = new WebhookService();
