import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "./index";
import { db } from "@quorum/db";

describe("API Server", () => {
	let organizationId: string;
	let userId: string;
	let token: string;

	beforeAll(async () => {
		// Clean up test data
		await db.recording.deleteMany({});
		await db.meeting.deleteMany({});
		await db.botAccount.deleteMany({});
		await db.user.deleteMany({});
		await db.organization.deleteMany({});
	});

	afterAll(async () => {
		// Clean up test data
		await db.recording.deleteMany({});
		await db.meeting.deleteMany({});
		await db.botAccount.deleteMany({});
		await db.user.deleteMany({});
		await db.organization.deleteMany({});
		await db.$disconnect();
	});

	describe("Health Endpoints", () => {
		it("should return health status", async () => {
			const response = await app.handle(new Request("http://localhost/health"));

			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.status).toBe("healthy");
			expect(data.services.database).toBe("healthy");
		});

		it("should return ready status", async () => {
			const response = await app.handle(new Request("http://localhost/health/ready"));

			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.status).toBe("ready");
		});

		it("should return alive status", async () => {
			const response = await app.handle(new Request("http://localhost/health/live"));

			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.status).toBe("alive");
		});
	});

	describe("Auth Endpoints", () => {
		it("should register a new user", async () => {
			const response = await app.handle(
				new Request("http://localhost/auth/register", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						email: "test@example.com",
						name: "Test User",
						organizationName: "Test Org",
						organizationSlug: "test-org",
					}),
				}),
			);

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(data.token).toBeDefined();
			expect(data.user.email).toBe("test@example.com");
			expect(data.user.role).toBe("ADMIN");

			token = data.token;
			userId = data.user.id;
			organizationId = data.user.organizationId;
		});

		it("should login an existing user", async () => {
			const response = await app.handle(
				new Request("http://localhost/auth/login", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						email: "test@example.com",
					}),
				}),
			);

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(data.token).toBeDefined();
			expect(data.user.email).toBe("test@example.com");
		});
	});

	describe("Organization Endpoints", () => {
		it("should list organizations", async () => {
			const response = await app.handle(new Request("http://localhost/organizations"));

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(Array.isArray(data.data)).toBe(true);
			expect(data.data.length).toBeGreaterThan(0);
		});

		it("should get organization by ID", async () => {
			const response = await app.handle(
				new Request(`http://localhost/organizations/${organizationId}`),
			);

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(data.data.id).toBe(organizationId);
			expect(data.data.slug).toBe("test-org");
		});

		it("should create a new organization", async () => {
			const response = await app.handle(
				new Request("http://localhost/organizations", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						name: "Another Org",
						slug: "another-org",
					}),
				}),
			);

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(data.data.name).toBe("Another Org");
			expect(data.data.slug).toBe("another-org");
		});
	});

	describe("Meeting Endpoints", () => {
		let botAccountId: string;
		let meetingId: string;

		beforeAll(async () => {
			// Create a bot account for testing
			const botAccount = await db.botAccount.create({
				data: {
					name: "Test Bot",
					platform: "TEAMS",
					username: "testbot@example.com",
					credentials: { password: "test" },
					organizationId,
				},
			});

			botAccountId = botAccount.id;
		});

		it("should create a new meeting", async () => {
			const response = await app.handle(
				new Request("http://localhost/meetings", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						meetingUrl: "https://teams.microsoft.com/l/meetup-join/test",
						platform: "TEAMS",
						organizationId,
						botAccountId,
					}),
				}),
			);

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(data.data.meetingUrl).toBe(
				"https://teams.microsoft.com/l/meetup-join/test",
			);
			expect(data.data.platform).toBe("TEAMS");
			expect(data.data.status).toBe("PENDING");

			meetingId = data.data.id;
		});

		it("should list meetings", async () => {
			const response = await app.handle(new Request("http://localhost/meetings"));

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(Array.isArray(data.data)).toBe(true);
			expect(data.data.length).toBeGreaterThan(0);
		});

		it("should update meeting status", async () => {
			const response = await app.handle(
				new Request(`http://localhost/meetings/${meetingId}`, {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "RECORDING",
						actualStart: new Date().toISOString(),
					}),
				}),
			);

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(data.data.status).toBe("RECORDING");
			expect(data.data.actualStart).toBeDefined();
		});
	});

	describe("Recording Endpoints", () => {
		let recordingId: string;
		let meetingId: string;

		beforeAll(async () => {
			// Create a meeting for testing
			const meeting = await db.meeting.create({
				data: {
					meetingUrl: "https://teams.microsoft.com/l/meetup-join/test2",
					platform: "TEAMS",
					status: "COMPLETED",
					organizationId,
					botAccountId: (
						await db.botAccount.findFirst({ where: { organizationId } })
					)!.id,
				},
			});

			meetingId = meeting.id;
		});

		it("should create a new recording", async () => {
			const response = await app.handle(
				new Request("http://localhost/recordings", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						filePath: "recordings/test.webm",
						fileSize: 1024000,
						duration: 300,
						organizationId,
						meetingId,
					}),
				}),
			);

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(data.data.filePath).toBe("recordings/test.webm");
			expect(data.data.fileSize).toBe(1024000);
			expect(data.data.status).toBe("RAW");

			recordingId = data.data.id;
		});

		it("should list recordings", async () => {
			const response = await app.handle(new Request("http://localhost/recordings"));

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(Array.isArray(data.data)).toBe(true);
			expect(data.data.length).toBeGreaterThan(0);
		});

		it("should soft delete a recording", async () => {
			const response = await app.handle(
				new Request(`http://localhost/recordings/${recordingId}`, {
					method: "DELETE",
				}),
			);

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(data.success).toBe(true);
			expect(data.deleted).toBe("soft");
		});

		it("should restore a deleted recording", async () => {
			const response = await app.handle(
				new Request(`http://localhost/recordings/${recordingId}/restore`, {
					method: "POST",
				}),
			);

			expect(response.status).toBe(200);

			const data: any = await response.json();
			expect(data.success).toBe(true);
		});
	});
});
