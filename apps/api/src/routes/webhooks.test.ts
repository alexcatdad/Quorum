import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@quorum/db";
import app from "../index";

describe("Webhook API", () => {
	let organizationId: string;
	let webhookId: string;

	beforeAll(async () => {
		// Create test organization
		const org = await db.organization.create({
			data: {
				name: "Webhook Test Org",
				slug: "webhook-test-org",
			},
		});
		organizationId = org.id;
	});

	afterAll(async () => {
		// Clean up
		await db.webhookDelivery.deleteMany({
			where: { webhook: { organizationId } },
		});
		await db.webhook.deleteMany({ where: { organizationId } });
		await db.organization.delete({ where: { id: organizationId } });
	});

	describe("POST /webhooks", () => {
		it("should create a webhook", async () => {
			const response = await app.handle(
				new Request("http://localhost/webhooks", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: "Test Webhook",
						url: "https://example.com/webhook",
						events: ["MEETING_STARTED", "MEETING_COMPLETED"],
						organizationId,
					}),
				}),
			);

			expect(response.status).toBe(200);
			const data: any = await response.json();
			expect(data.data.name).toBe("Test Webhook");
			expect(data.data.url).toBe("https://example.com/webhook");
			expect(data.data.events).toContain("MEETING_STARTED");
			expect(data.data.secret).toBeDefined();
			webhookId = data.data.id;
		});

		it("should reject invalid URL", async () => {
			const response = await app.handle(
				new Request("http://localhost/webhooks", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: "Invalid Webhook",
						url: "not-a-url",
						events: ["MEETING_STARTED"],
						organizationId,
					}),
				}),
			);

			expect(response.status).toBe(422);
		});
	});

	describe("GET /webhooks", () => {
		it("should list webhooks", async () => {
			const response = await app.handle(
				new Request(`http://localhost/webhooks?organizationId=${organizationId}`),
			);

			expect(response.status).toBe(200);
			const data: any = await response.json();
			expect(Array.isArray(data.data)).toBe(true);
			expect(data.data.length).toBeGreaterThan(0);
		});
	});

	describe("GET /webhooks/:id", () => {
		it("should get webhook by ID", async () => {
			const response = await app.handle(new Request(`http://localhost/webhooks/${webhookId}`));

			expect(response.status).toBe(200);
			const data: any = await response.json();
			expect(data.data.id).toBe(webhookId);
			expect(data.data.secret).toBeDefined();
		});

		it("should return 404 for non-existent webhook", async () => {
			const response = await app.handle(new Request("http://localhost/webhooks/non-existent-id"));

			expect(response.status).toBe(404);
		});
	});

	describe("PATCH /webhooks/:id", () => {
		it("should update webhook", async () => {
			const response = await app.handle(
				new Request(`http://localhost/webhooks/${webhookId}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: "Updated Webhook",
						isActive: false,
					}),
				}),
			);

			expect(response.status).toBe(200);
			const data: any = await response.json();
			expect(data.data.name).toBe("Updated Webhook");
			expect(data.data.isActive).toBe(false);
		});
	});

	describe("POST /webhooks/:id/regenerate-secret", () => {
		it("should regenerate webhook secret", async () => {
			const originalResponse = await app.handle(
				new Request(`http://localhost/webhooks/${webhookId}`),
			);
			const originalData: any = await originalResponse.json();
			const originalSecret = originalData.data.secret;

			const response = await app.handle(
				new Request(`http://localhost/webhooks/${webhookId}/regenerate-secret`, {
					method: "POST",
				}),
			);

			expect(response.status).toBe(200);
			const data: any = await response.json();
			expect(data.data.secret).toBeDefined();
			expect(data.data.secret).not.toBe(originalSecret);
		});
	});

	describe("GET /webhooks/:id/deliveries", () => {
		it("should return empty deliveries for new webhook", async () => {
			const response = await app.handle(
				new Request(`http://localhost/webhooks/${webhookId}/deliveries`),
			);

			expect(response.status).toBe(200);
			const data: any = await response.json();
			expect(Array.isArray(data.data)).toBe(true);
		});
	});

	describe("DELETE /webhooks/:id", () => {
		it("should delete webhook", async () => {
			const response = await app.handle(
				new Request(`http://localhost/webhooks/${webhookId}`, {
					method: "DELETE",
				}),
			);

			expect(response.status).toBe(200);
			const data: any = await response.json();
			expect(data.success).toBe(true);
		});
	});
});
