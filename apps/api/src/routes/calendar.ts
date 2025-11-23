import { db } from "@quorum/db";
import { Elysia, t } from "elysia";
import { calendarService, extractMeetingUrl } from "../services/calendar";
import { NotFoundError } from "../types/errors";
import { logger } from "../utils/logger";

// Calendar provider enum
const CalendarProviderEnum = t.Union([
	t.Literal("ICAL"),
	t.Literal("GOOGLE"),
	t.Literal("OUTLOOK"),
]);

// Calendar event status enum
const CalendarEventStatusEnum = t.Union([
	t.Literal("PENDING"),
	t.Literal("SCHEDULED"),
	t.Literal("SKIPPED"),
	t.Literal("COMPLETED"),
	t.Literal("FAILED"),
]);

export const calendarRoutes = new Elysia({ prefix: "/calendar" })
	// ==================== CALENDAR INTEGRATIONS ====================

	// List calendar integrations
	.get(
		"/integrations",
		async ({ query }) => {
			const where: any = {};

			if (query.organizationId) {
				where.organizationId = query.organizationId;
			}

			if (query.provider) {
				where.provider = query.provider;
			}

			if (query.isActive !== undefined) {
				where.isActive = query.isActive;
			}

			const integrations = await db.calendarIntegration.findMany({
				where,
				orderBy: { createdAt: "desc" },
				take: query.limit || 50,
				skip: query.offset || 0,
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
							events: true,
						},
					},
				},
			});

			// Don't return tokens in list response
			const sanitized = integrations.map(({ accessToken, refreshToken, ...rest }) => rest);

			return { data: sanitized };
		},
		{
			query: t.Object({
				organizationId: t.Optional(t.String()),
				provider: t.Optional(CalendarProviderEnum),
				isActive: t.Optional(t.Boolean()),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "List calendar integrations",
				description: "Get a list of calendar integrations with optional filtering",
			},
		},
	)
	// Get calendar integration by ID
	.get(
		"/integrations/:id",
		async ({ params: { id } }) => {
			const integration = await db.calendarIntegration.findUnique({
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
							events: true,
						},
					},
				},
			});

			if (!integration) {
				throw new NotFoundError("CalendarIntegration", id);
			}

			// Don't return tokens
			const { accessToken, refreshToken, ...rest } = integration;

			return { data: rest };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Get calendar integration by ID",
				description: "Get detailed information about a specific calendar integration",
			},
		},
	)
	// Create calendar integration
	.post(
		"/integrations",
		async ({ body }) => {
			// Check if organization exists
			const organization = await db.organization.findUnique({
				where: { id: body.organizationId },
			});

			if (!organization) {
				throw new NotFoundError("Organization", body.organizationId);
			}

			const integration = await db.calendarIntegration.create({
				data: {
					name: body.name,
					provider: body.provider,
					calendarUrl: body.calendarUrl,
					calendarId: body.calendarId,
					syncInterval: body.syncInterval ?? 300,
					isActive: body.isActive ?? true,
					autoSchedule: body.autoSchedule ?? false,
					filterKeywords: body.filterKeywords || [],
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

			logger.info(`Calendar integration created: ${integration.id} - ${integration.name}`);

			// Trigger initial sync
			if (integration.isActive && integration.provider === "ICAL") {
				calendarService.syncCalendarIntegration(integration.id).catch((error) => {
					logger.error("Initial calendar sync failed", { integrationId: integration.id, error });
				});
			}

			return { data: integration };
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 255 }),
				provider: CalendarProviderEnum,
				calendarUrl: t.Optional(t.String()),
				calendarId: t.Optional(t.String()),
				syncInterval: t.Optional(t.Number({ minimum: 60, maximum: 86400 })),
				isActive: t.Optional(t.Boolean()),
				autoSchedule: t.Optional(t.Boolean()),
				filterKeywords: t.Optional(t.Array(t.String())),
				organizationId: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Create calendar integration",
				description:
					"Create a new calendar integration. For ICAL provider, calendarUrl is required.",
			},
		},
	)
	// Update calendar integration
	.patch(
		"/integrations/:id",
		async ({ params: { id }, body }) => {
			const existing = await db.calendarIntegration.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("CalendarIntegration", id);
			}

			const integration = await db.calendarIntegration.update({
				where: { id },
				data: {
					...(body.name && { name: body.name }),
					...(body.calendarUrl !== undefined && { calendarUrl: body.calendarUrl }),
					...(body.calendarId !== undefined && { calendarId: body.calendarId }),
					...(body.syncInterval !== undefined && { syncInterval: body.syncInterval }),
					...(body.isActive !== undefined && { isActive: body.isActive }),
					...(body.autoSchedule !== undefined && { autoSchedule: body.autoSchedule }),
					...(body.filterKeywords !== undefined && { filterKeywords: body.filterKeywords }),
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

			logger.info(`Calendar integration updated: ${integration.id}`);

			return { data: integration };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			body: t.Object({
				name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
				calendarUrl: t.Optional(t.Union([t.String(), t.Null()])),
				calendarId: t.Optional(t.Union([t.String(), t.Null()])),
				syncInterval: t.Optional(t.Number({ minimum: 60, maximum: 86400 })),
				isActive: t.Optional(t.Boolean()),
				autoSchedule: t.Optional(t.Boolean()),
				filterKeywords: t.Optional(t.Array(t.String())),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Update calendar integration",
				description: "Update calendar integration settings",
			},
		},
	)
	// Delete calendar integration
	.delete(
		"/integrations/:id",
		async ({ params: { id } }) => {
			const existing = await db.calendarIntegration.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("CalendarIntegration", id);
			}

			await db.calendarIntegration.delete({
				where: { id },
			});

			logger.info(`Calendar integration deleted: ${id}`);

			return { success: true };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Delete calendar integration",
				description: "Permanently delete a calendar integration and all its events",
			},
		},
	)
	// Sync calendar integration
	.post(
		"/integrations/:id/sync",
		async ({ params: { id } }) => {
			const result = await calendarService.syncCalendarIntegration(id);

			return { data: result };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Sync calendar integration",
				description: "Manually trigger a sync for a calendar integration",
			},
		},
	)

	// ==================== CALENDAR EVENTS ====================

	// List calendar events
	.get(
		"/events",
		async ({ query }) => {
			const where: any = {};

			if (query.organizationId) {
				where.organizationId = query.organizationId;
			}

			if (query.integrationId) {
				where.calendarIntegrationId = query.integrationId;
			}

			if (query.status) {
				where.status = query.status;
			}

			if (query.platform) {
				where.platform = query.platform;
			}

			if (query.upcoming) {
				where.startTime = { gte: new Date() };
			}

			const events = await db.calendarEvent.findMany({
				where,
				orderBy: { startTime: query.upcoming ? "asc" : "desc" },
				take: query.limit || 50,
				skip: query.offset || 0,
				include: {
					calendarIntegration: {
						select: {
							id: true,
							name: true,
							provider: true,
						},
					},
					meeting: {
						select: {
							id: true,
							status: true,
						},
					},
				},
			});

			return { data: events };
		},
		{
			query: t.Object({
				organizationId: t.Optional(t.String()),
				integrationId: t.Optional(t.String()),
				status: t.Optional(CalendarEventStatusEnum),
				platform: t.Optional(
					t.Union([t.Literal("TEAMS"), t.Literal("SLACK"), t.Literal("YOUTUBE")]),
				),
				upcoming: t.Optional(t.Boolean()),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "List calendar events",
				description: "Get a list of calendar events with optional filtering",
			},
		},
	)
	// Get calendar event by ID
	.get(
		"/events/:id",
		async ({ params: { id } }) => {
			const event = await db.calendarEvent.findUnique({
				where: { id },
				include: {
					calendarIntegration: {
						select: {
							id: true,
							name: true,
							provider: true,
						},
					},
					meeting: true,
				},
			});

			if (!event) {
				throw new NotFoundError("CalendarEvent", id);
			}

			return { data: event };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Get calendar event by ID",
				description: "Get detailed information about a specific calendar event",
			},
		},
	)
	// Schedule calendar event as meeting
	.post(
		"/events/:id/schedule",
		async ({ params: { id } }) => {
			const event = await db.calendarEvent.findUnique({
				where: { id },
			});

			if (!event) {
				throw new NotFoundError("CalendarEvent", id);
			}

			await calendarService.scheduleEventAsMeeting(event);

			const updated = await db.calendarEvent.findUnique({
				where: { id },
				include: {
					meeting: true,
				},
			});

			return { data: updated };
		},
		{
			params: t.Object({
				id: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Schedule calendar event",
				description: "Create a meeting from a calendar event",
			},
		},
	)
	// Parse iCal content directly
	.post(
		"/parse-ical",
		async ({ body }) => {
			const events = calendarService.parseICal(body.content);

			// Extract meeting URLs from each event
			const eventsWithMeetings = events.map((event) => {
				const searchText = [
					event.description || "",
					event.location || "",
					event.summary || "",
				].join(" ");

				const meetingInfo = extractMeetingUrl(searchText);

				return {
					...event,
					meetingUrl: meetingInfo?.url,
					platform: meetingInfo?.platform,
				};
			});

			return { data: eventsWithMeetings };
		},
		{
			body: t.Object({
				content: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Parse iCal content",
				description: "Parse iCal content and extract meeting URLs",
			},
		},
	)
	// Extract meeting URL from text
	.post(
		"/extract-meeting-url",
		async ({ body }) => {
			const result = extractMeetingUrl(body.text);

			return {
				data: result || { url: null, platform: null },
			};
		},
		{
			body: t.Object({
				text: t.String({ minLength: 1 }),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Extract meeting URL",
				description: "Extract meeting URL and detect platform from text",
			},
		},
	)
	// Get upcoming events for organization
	.get(
		"/upcoming/:organizationId",
		async ({ params: { organizationId }, query }) => {
			const events = await calendarService.getUpcomingEvents(organizationId, query.hours || 24);

			return { data: events };
		},
		{
			params: t.Object({
				organizationId: t.String({ minLength: 1 }),
			}),
			query: t.Object({
				hours: t.Optional(t.Number({ minimum: 1, maximum: 168 })),
			}),
			detail: {
				tags: ["Calendar"],
				summary: "Get upcoming events",
				description: "Get upcoming calendar events for an organization within the specified hours",
			},
		},
	);
