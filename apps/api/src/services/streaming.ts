import { createHmac } from "node:crypto";
import type { StreamConfig, StreamFormat } from "@prisma/client";
import { db } from "@quorum/db";
import { createChildLogger } from "../utils/logger";
import { webhookService } from "./webhook";

const streamLogger = createChildLogger("streaming");

export interface StreamChunk {
	meetingId: string;
	organizationId: string;
	chunkIndex: number;
	timestamp: string;
	format: StreamFormat;
	data: Buffer | string;
	metadata?: Record<string, unknown>;
}

export interface StreamDeliveryResult {
	configId: string;
	success: boolean;
	statusCode?: number;
	error?: string;
	duration?: number;
}

/**
 * Generate HMAC-SHA256 signature for stream chunk
 */
function generateSignature(payload: string, secret: string): string {
	return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Stream a chunk via HTTP POST
 */
async function streamViaHttpPost(
	config: StreamConfig,
	chunk: StreamChunk,
): Promise<StreamDeliveryResult> {
	const startTime = Date.now();

	try {
		const payload = {
			meetingId: chunk.meetingId,
			organizationId: chunk.organizationId,
			chunkIndex: chunk.chunkIndex,
			timestamp: chunk.timestamp,
			format: chunk.format,
			// For binary data, base64 encode it
			data: chunk.data instanceof Buffer ? chunk.data.toString("base64") : chunk.data,
			encoding: chunk.data instanceof Buffer ? "base64" : "utf-8",
			metadata: chunk.metadata,
		};

		const payloadJson = JSON.stringify(payload);
		const signature = config.secret ? generateSignature(payloadJson, config.secret) : undefined;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Stream-Chunk-Index": String(chunk.chunkIndex),
			"X-Stream-Meeting-Id": chunk.meetingId,
			"X-Stream-Timestamp": chunk.timestamp,
			...(signature && { "X-Stream-Signature": `sha256=${signature}` }),
			...((config.headers as Record<string, string>) || {}),
		};

		const response = await fetch(config.url, {
			method: "POST",
			headers,
			body: payloadJson,
		});

		const duration = Date.now() - startTime;

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "");
			streamLogger.warn("HTTP POST stream delivery failed", {
				configId: config.id,
				statusCode: response.status,
				error: errorBody.slice(0, 200),
			});

			return {
				configId: config.id,
				success: false,
				statusCode: response.status,
				error: `HTTP ${response.status}`,
				duration,
			};
		}

		streamLogger.debug("HTTP POST stream chunk delivered", {
			configId: config.id,
			chunkIndex: chunk.chunkIndex,
			duration,
		});

		return {
			configId: config.id,
			success: true,
			statusCode: response.status,
			duration,
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		streamLogger.error("HTTP POST stream delivery error", {
			configId: config.id,
			error: errorMessage,
		});

		return {
			configId: config.id,
			success: false,
			error: errorMessage,
			duration,
		};
	}
}

/**
 * Stream a chunk via WebSocket
 */
async function streamViaWebSocket(
	config: StreamConfig,
	chunk: StreamChunk,
	wsConnections: Map<string, WebSocket>,
): Promise<StreamDeliveryResult> {
	const startTime = Date.now();

	try {
		let ws = wsConnections.get(config.id);

		// Create new connection if needed
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			ws = new WebSocket(config.url);

			// Wait for connection
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("WebSocket connection timeout"));
				}, 10000);

				ws!.onopen = () => {
					clearTimeout(timeout);
					resolve();
				};

				ws!.onerror = (_event) => {
					clearTimeout(timeout);
					reject(new Error("WebSocket connection error"));
				};
			});

			// Send authentication if secret is configured
			if (config.secret) {
				ws.send(
					JSON.stringify({
						type: "auth",
						secret: config.secret,
					}),
				);
			}

			wsConnections.set(config.id, ws);
		}

		const payload = {
			type: "chunk",
			meetingId: chunk.meetingId,
			organizationId: chunk.organizationId,
			chunkIndex: chunk.chunkIndex,
			timestamp: chunk.timestamp,
			format: chunk.format,
			data: chunk.data instanceof Buffer ? chunk.data.toString("base64") : chunk.data,
			encoding: chunk.data instanceof Buffer ? "base64" : "utf-8",
			metadata: chunk.metadata,
		};

		ws.send(JSON.stringify(payload));

		const duration = Date.now() - startTime;

		streamLogger.debug("WebSocket stream chunk delivered", {
			configId: config.id,
			chunkIndex: chunk.chunkIndex,
			duration,
		});

		return {
			configId: config.id,
			success: true,
			duration,
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		// Remove failed connection
		wsConnections.delete(config.id);

		streamLogger.error("WebSocket stream delivery error", {
			configId: config.id,
			error: errorMessage,
		});

		return {
			configId: config.id,
			success: false,
			error: errorMessage,
			duration,
		};
	}
}

/**
 * Manages real-time streaming of recording content to external services
 */
export class StreamingService {
	private wsConnections: Map<string, WebSocket> = new Map();
	private activeStreams: Map<string, NodeJS.Timeout> = new Map();

	/**
	 * Get active stream configs for a meeting
	 */
	async getActiveConfigs(meetingId: string, organizationId: string): Promise<StreamConfig[]> {
		return db.streamConfig.findMany({
			where: {
				organizationId,
				isActive: true,
				OR: [
					{ meetingId },
					{ meetingId: null }, // Organization defaults
				],
			},
		});
	}

	/**
	 * Stream a chunk to all configured destinations
	 */
	async streamChunk(chunk: StreamChunk): Promise<StreamDeliveryResult[]> {
		const configs = await this.getActiveConfigs(chunk.meetingId, chunk.organizationId);

		if (configs.length === 0) {
			streamLogger.debug("No active stream configs for meeting", {
				meetingId: chunk.meetingId,
			});
			return [];
		}

		streamLogger.info(`Streaming chunk ${chunk.chunkIndex} to ${configs.length} destinations`, {
			meetingId: chunk.meetingId,
			chunkIndex: chunk.chunkIndex,
		});

		const results = await Promise.all(
			configs.map(async (config) => {
				switch (config.type) {
					case "HTTP_POST":
						return streamViaHttpPost(config, chunk);

					case "WEBSOCKET":
						return streamViaWebSocket(config, chunk, this.wsConnections);

					case "S3_MULTIPART":
						// S3 multipart is handled separately - notify via webhook
						await webhookService.triggerStreamChunkReady(
							chunk.organizationId,
							chunk.meetingId,
							config.url, // S3 path/bucket
							chunk.chunkIndex,
							chunk.metadata,
						);
						return {
							configId: config.id,
							success: true,
						};

					default:
						return {
							configId: config.id,
							success: false,
							error: `Unsupported stream type: ${config.type}`,
						};
				}
			}),
		);

		const successCount = results.filter((r) => r.success).length;
		streamLogger.info("Stream chunk delivery completed", {
			meetingId: chunk.meetingId,
			chunkIndex: chunk.chunkIndex,
			total: configs.length,
			success: successCount,
			failed: configs.length - successCount,
		});

		return results;
	}

	/**
	 * Stream metadata update (participants, events, etc.)
	 */
	async streamMetadata(
		meetingId: string,
		organizationId: string,
		metadata: Record<string, unknown>,
	): Promise<StreamDeliveryResult[]> {
		const configs = await this.getActiveConfigs(meetingId, organizationId);

		// Filter to metadata-format configs only
		const metadataConfigs = configs.filter((c) => c.format === "METADATA");

		if (metadataConfigs.length === 0) {
			return [];
		}

		const chunk: StreamChunk = {
			meetingId,
			organizationId,
			chunkIndex: -1, // Metadata doesn't have chunk index
			timestamp: new Date().toISOString(),
			format: "METADATA",
			data: JSON.stringify(metadata),
			metadata,
		};

		return Promise.all(
			metadataConfigs.map(async (config) => {
				if (config.type === "HTTP_POST") {
					return streamViaHttpPost(config, chunk);
				} else if (config.type === "WEBSOCKET") {
					return streamViaWebSocket(config, chunk, this.wsConnections);
				}
				return {
					configId: config.id,
					success: false,
					error: "Unsupported type for metadata",
				};
			}),
		);
	}

	/**
	 * Notify stream start
	 */
	async notifyStreamStart(meetingId: string, organizationId: string): Promise<void> {
		const configs = await this.getActiveConfigs(meetingId, organizationId);

		for (const config of configs) {
			if (config.type === "HTTP_POST") {
				const payload = {
					type: "stream_start",
					meetingId,
					organizationId,
					timestamp: new Date().toISOString(),
				};

				try {
					await fetch(config.url, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...((config.headers as Record<string, string>) || {}),
						},
						body: JSON.stringify(payload),
					});
				} catch (error) {
					streamLogger.error("Failed to notify stream start", {
						configId: config.id,
						error,
					});
				}
			}
		}

		streamLogger.info("Stream start notifications sent", {
			meetingId,
			configCount: configs.length,
		});
	}

	/**
	 * Notify stream end and close connections
	 */
	async notifyStreamEnd(meetingId: string, organizationId: string): Promise<void> {
		const configs = await this.getActiveConfigs(meetingId, organizationId);

		for (const config of configs) {
			// Close WebSocket connections
			const ws = this.wsConnections.get(config.id);
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(
					JSON.stringify({
						type: "stream_end",
						meetingId,
						timestamp: new Date().toISOString(),
					}),
				);
				ws.close();
				this.wsConnections.delete(config.id);
			}

			// Send HTTP notification
			if (config.type === "HTTP_POST") {
				const payload = {
					type: "stream_end",
					meetingId,
					organizationId,
					timestamp: new Date().toISOString(),
				};

				try {
					await fetch(config.url, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...((config.headers as Record<string, string>) || {}),
						},
						body: JSON.stringify(payload),
					});
				} catch (error) {
					streamLogger.error("Failed to notify stream end", {
						configId: config.id,
						error,
					});
				}
			}
		}

		// Clear any active stream timers
		const timer = this.activeStreams.get(meetingId);
		if (timer) {
			clearInterval(timer);
			this.activeStreams.delete(meetingId);
		}

		streamLogger.info("Stream end notifications sent", {
			meetingId,
			configCount: configs.length,
		});
	}

	/**
	 * Close all WebSocket connections (cleanup)
	 */
	closeAllConnections(): void {
		for (const [_configId, ws] of this.wsConnections) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.close();
			}
		}
		this.wsConnections.clear();

		for (const timer of this.activeStreams.values()) {
			clearInterval(timer);
		}
		this.activeStreams.clear();

		streamLogger.info("All streaming connections closed");
	}
}

export const streamingService = new StreamingService();
