import type { ServerWebSocket } from "bun";
import { createChildLogger } from "../utils/logger";

const wsLogger = createChildLogger("websocket");

interface WebSocketData {
	userId?: string;
	organizationId?: string;
	subscriptions: Set<string>;
}

export class WebSocketService {
	private connections: Map<string, ServerWebSocket<WebSocketData>> = new Map();

	constructor() {
		wsLogger.info("WebSocket service initialized");
	}

	handleConnection(ws: ServerWebSocket<WebSocketData>, userId?: string, organizationId?: string) {
		const connectionId = crypto.randomUUID();

		ws.data = {
			userId,
			organizationId,
			subscriptions: new Set(),
		};

		this.connections.set(connectionId, ws);

		wsLogger.info("WebSocket connection established", {
			connectionId,
			userId,
			organizationId,
			totalConnections: this.connections.size,
		});

		ws.send(
			JSON.stringify({
				type: "connected",
				connectionId,
				timestamp: new Date().toISOString(),
			}),
		);

		return connectionId;
	}

	handleDisconnection(connectionId: string) {
		this.connections.delete(connectionId);

		wsLogger.info("WebSocket connection closed", {
			connectionId,
			totalConnections: this.connections.size,
		});
	}

	handleMessage(ws: ServerWebSocket<WebSocketData>, message: string) {
		try {
			const data = JSON.parse(message);

			switch (data.type) {
				case "subscribe":
					this.handleSubscribe(ws, data.channel);
					break;

				case "unsubscribe":
					this.handleUnsubscribe(ws, data.channel);
					break;

				case "ping":
					ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
					break;

				default:
					wsLogger.warn("Unknown WebSocket message type", { type: data.type });
			}
		} catch (error) {
			wsLogger.error("Failed to handle WebSocket message", error);
			ws.send(
				JSON.stringify({
					type: "error",
					message: "Invalid message format",
				}),
			);
		}
	}

	private handleSubscribe(ws: ServerWebSocket<WebSocketData>, channel: string) {
		if (!ws.data) return;

		ws.data.subscriptions.add(channel);
		ws.send(
			JSON.stringify({
				type: "subscribed",
				channel,
				timestamp: new Date().toISOString(),
			}),
		);

		wsLogger.info("Client subscribed to channel", {
			channel,
			userId: ws.data.userId,
			totalSubscriptions: ws.data.subscriptions.size,
		});
	}

	private handleUnsubscribe(ws: ServerWebSocket<WebSocketData>, channel: string) {
		if (!ws.data) return;

		ws.data.subscriptions.delete(channel);
		ws.send(
			JSON.stringify({
				type: "unsubscribed",
				channel,
				timestamp: new Date().toISOString(),
			}),
		);

		wsLogger.info("Client unsubscribed from channel", {
			channel,
			userId: ws.data.userId,
		});
	}

	// Broadcast to all connections in an organization
	broadcastToOrganization(organizationId: string, message: any) {
		let count = 0;

		for (const ws of this.connections.values()) {
			if (ws.data?.organizationId === organizationId) {
				ws.send(JSON.stringify(message));
				count++;
			}
		}

		wsLogger.info("Broadcast to organization", {
			organizationId,
			recipientCount: count,
		});

		return count;
	}

	// Broadcast to a specific channel
	broadcastToChannel(channel: string, message: any) {
		let count = 0;

		for (const ws of this.connections.values()) {
			if (ws.data?.subscriptions.has(channel)) {
				ws.send(JSON.stringify(message));
				count++;
			}
		}

		wsLogger.info("Broadcast to channel", {
			channel,
			recipientCount: count,
		});

		return count;
	}

	// Send to a specific user
	sendToUser(userId: string, message: any) {
		let count = 0;

		for (const ws of this.connections.values()) {
			if (ws.data?.userId === userId) {
				ws.send(JSON.stringify(message));
				count++;
			}
		}

		return count;
	}

	// Notify about meeting status change
	notifyMeetingStatus(meetingId: string, organizationId: string, status: string, metadata?: any) {
		this.broadcastToOrganization(organizationId, {
			type: "meeting.status",
			meetingId,
			status,
			metadata,
			timestamp: new Date().toISOString(),
		});
	}

	// Notify about recording progress
	notifyRecordingProgress(
		recordingId: string,
		organizationId: string,
		progress: number,
		metadata?: any,
	) {
		this.broadcastToOrganization(organizationId, {
			type: "recording.progress",
			recordingId,
			progress,
			metadata,
			timestamp: new Date().toISOString(),
		});
	}

	// Notify about encoding progress
	notifyEncodingProgress(
		recordingId: string,
		organizationId: string,
		progress: number,
		metadata?: any,
	) {
		this.broadcastToOrganization(organizationId, {
			type: "encoding.progress",
			recordingId,
			progress,
			metadata,
			timestamp: new Date().toISOString(),
		});
	}

	getConnectionCount(): number {
		return this.connections.size;
	}

	getOrganizationConnectionCount(organizationId: string): number {
		let count = 0;
		for (const ws of this.connections.values()) {
			if (ws.data?.organizationId === organizationId) {
				count++;
			}
		}
		return count;
	}
}

export const websocketService = new WebSocketService();
