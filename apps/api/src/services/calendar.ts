import type { CalendarEvent, CalendarIntegration, Platform } from "@prisma/client";
import { db } from "@quorum/db";
import { createChildLogger } from "../utils/logger";

const calendarLogger = createChildLogger("calendar");

/**
 * Meeting URL patterns for different platforms
 */
const MEETING_URL_PATTERNS = {
	TEAMS: [
		/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/gi,
		/https:\/\/teams\.live\.com\/meet\/[^\s"<>]+/gi,
	],
	SLACK: [
		/https:\/\/[a-z0-9-]+\.slack\.com\/huddle\/[^\s"<>]+/gi,
		/https:\/\/slack\.com\/huddle\/[^\s"<>]+/gi,
	],
	YOUTUBE: [
		/https:\/\/(www\.)?youtube\.com\/watch\?v=[^\s"<>&]+/gi,
		/https:\/\/youtu\.be\/[^\s"<>]+/gi,
		/https:\/\/(www\.)?youtube\.com\/live\/[^\s"<>]+/gi,
	],
	ZOOM: [/https:\/\/[a-z0-9-]+\.zoom\.us\/j\/[^\s"<>]+/gi, /https:\/\/zoom\.us\/j\/[^\s"<>]+/gi],
	GOOGLE_MEET: [/https:\/\/meet\.google\.com\/[a-z-]+/gi],
	WEBEX: [/https:\/\/[a-z0-9-]+\.webex\.com\/[^\s"<>]+/gi],
};

/**
 * Simple iCal parser (no external dependencies)
 */
interface ICalEvent {
	uid: string;
	summary: string;
	description?: string;
	location?: string;
	dtstart: Date;
	dtend: Date;
	organizer?: string;
	attendees?: string[];
}

function parseICalDate(dateStr: string): Date {
	// Handle various iCal date formats
	// YYYYMMDD
	// YYYYMMDDTHHMMSS
	// YYYYMMDDTHHMMSSZ
	// YYYYMMDDTHHMMSS+0000
	const cleanStr = dateStr.replace(/[:-]/g, "");

	if (cleanStr.length === 8) {
		// Date only
		const year = Number.parseInt(cleanStr.slice(0, 4), 10);
		const month = Number.parseInt(cleanStr.slice(4, 6), 10) - 1;
		const day = Number.parseInt(cleanStr.slice(6, 8), 10);
		return new Date(year, month, day);
	}

	// Date with time
	const year = Number.parseInt(cleanStr.slice(0, 4), 10);
	const month = Number.parseInt(cleanStr.slice(4, 6), 10) - 1;
	const day = Number.parseInt(cleanStr.slice(6, 8), 10);
	const hour = Number.parseInt(cleanStr.slice(9, 11), 10) || 0;
	const minute = Number.parseInt(cleanStr.slice(11, 13), 10) || 0;
	const second = Number.parseInt(cleanStr.slice(13, 15), 10) || 0;

	if (cleanStr.endsWith("Z")) {
		return new Date(Date.UTC(year, month, day, hour, minute, second));
	}

	return new Date(year, month, day, hour, minute, second);
}

function parseICalContent(icalContent: string): ICalEvent[] {
	const events: ICalEvent[] = [];
	const lines = icalContent.split(/\r?\n/);

	let currentEvent: Partial<ICalEvent> | null = null;
	let currentKey = "";
	let currentValue = "";

	for (const line of lines) {
		// Handle line continuation (lines starting with space or tab)
		if (line.startsWith(" ") || line.startsWith("\t")) {
			currentValue += line.slice(1);
			continue;
		}

		// Process previous key-value if exists
		if (currentKey && currentEvent) {
			processICalProperty(currentEvent, currentKey, currentValue);
		}

		// Parse new line
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;

		currentKey = line.slice(0, colonIndex).split(";")[0].toUpperCase();
		currentValue = line.slice(colonIndex + 1);

		if (currentKey === "BEGIN" && currentValue === "VEVENT") {
			currentEvent = { attendees: [] };
		} else if (currentKey === "END" && currentValue === "VEVENT" && currentEvent) {
			if (currentEvent.uid && currentEvent.summary && currentEvent.dtstart && currentEvent.dtend) {
				events.push(currentEvent as ICalEvent);
			}
			currentEvent = null;
		}
	}

	return events;
}

function processICalProperty(event: Partial<ICalEvent>, key: string, value: string): void {
	switch (key) {
		case "UID":
			event.uid = value;
			break;
		case "SUMMARY":
			event.summary = value;
			break;
		case "DESCRIPTION":
			event.description = value.replace(/\\n/g, "\n").replace(/\\,/g, ",");
			break;
		case "LOCATION":
			event.location = value;
			break;
		case "DTSTART":
			event.dtstart = parseICalDate(value);
			break;
		case "DTEND":
			event.dtend = parseICalDate(value);
			break;
		case "ORGANIZER":
			// Extract email from ORGANIZER:mailto:email@example.com
			event.organizer = value.replace(/^mailto:/i, "");
			break;
		case "ATTENDEE": {
			const attendeeEmail = value.replace(/^mailto:/i, "");
			event.attendees?.push(attendeeEmail);
			break;
		}
	}
}

/**
 * Extract meeting URL and detect platform from text
 */
export function extractMeetingUrl(text: string): { url: string; platform: Platform } | null {
	for (const [platform, patterns] of Object.entries(MEETING_URL_PATTERNS)) {
		for (const pattern of patterns) {
			const match = text.match(pattern);
			if (match?.[0]) {
				// Only return platforms we support
				if (platform === "TEAMS" || platform === "SLACK" || platform === "YOUTUBE") {
					return { url: match[0], platform: platform as Platform };
				}
				// For other platforms, still detect but mark as unsupported
				calendarLogger.info(`Detected unsupported platform: ${platform}`, { url: match[0] });
				return null;
			}
		}
	}
	return null;
}

export class CalendarService {
	/**
	 * Fetch and parse iCal from URL
	 */
	async fetchICalFromUrl(url: string): Promise<ICalEvent[]> {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch iCal: ${response.status} ${response.statusText}`);
		}

		const content = await response.text();
		return parseICalContent(content);
	}

	/**
	 * Parse iCal content directly
	 */
	parseICal(content: string): ICalEvent[] {
		return parseICalContent(content);
	}

	/**
	 * Sync calendar events from an integration
	 */
	async syncCalendarIntegration(integrationId: string): Promise<{
		synced: number;
		created: number;
		updated: number;
		errors: string[];
	}> {
		const integration = await db.calendarIntegration.findUnique({
			where: { id: integrationId },
		});

		if (!integration) {
			throw new Error(`Calendar integration not found: ${integrationId}`);
		}

		const result = {
			synced: 0,
			created: 0,
			updated: 0,
			errors: [] as string[],
		};

		try {
			let events: ICalEvent[] = [];

			switch (integration.provider) {
				case "ICAL":
					if (!integration.calendarUrl) {
						throw new Error("iCal URL is required for ICAL provider");
					}
					events = await this.fetchICalFromUrl(integration.calendarUrl);
					break;

				case "GOOGLE":
				case "OUTLOOK":
					// For OAuth providers, we would need to implement OAuth flow
					// and API calls. For now, return empty and log a warning.
					calendarLogger.warn(`OAuth provider ${integration.provider} not yet implemented`);
					return result;

				default:
					throw new Error(`Unsupported provider: ${integration.provider}`);
			}

			calendarLogger.info(`Fetched ${events.length} events from calendar`, {
				integrationId,
				provider: integration.provider,
			});

			// Process each event
			for (const event of events) {
				try {
					await this.processCalendarEvent(integration, event);
					result.synced++;
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					result.errors.push(`Event ${event.uid}: ${errorMsg}`);
				}
			}

			// Update last sync time
			await db.calendarIntegration.update({
				where: { id: integrationId },
				data: { lastSyncAt: new Date() },
			});

			return result;
		} catch (error) {
			calendarLogger.error("Calendar sync failed", { integrationId, error });
			throw error;
		}
	}

	/**
	 * Process a single calendar event
	 */
	private async processCalendarEvent(
		integration: CalendarIntegration,
		event: ICalEvent,
	): Promise<CalendarEvent> {
		// Check if event already exists
		const existing = await db.calendarEvent.findUnique({
			where: {
				calendarIntegrationId_externalId: {
					calendarIntegrationId: integration.id,
					externalId: event.uid,
				},
			},
		});

		// Extract meeting URL from description, location, or summary
		const searchText = [event.description || "", event.location || "", event.summary || ""].join(
			" ",
		);

		const meetingInfo = extractMeetingUrl(searchText);

		// Check if event matches filter keywords (if any)
		let shouldProcess = true;
		if (integration.filterKeywords.length > 0) {
			shouldProcess = integration.filterKeywords.some((keyword) =>
				searchText.toLowerCase().includes(keyword.toLowerCase()),
			);
		}

		const eventData = {
			calendarIntegrationId: integration.id,
			organizationId: integration.organizationId,
			externalId: event.uid,
			title: event.summary,
			description: event.description,
			location: event.location,
			meetingUrl: meetingInfo?.url,
			platform: meetingInfo?.platform,
			startTime: event.dtstart,
			endTime: event.dtend,
			organizer: event.organizer,
			attendees: event.attendees,
			status: shouldProcess && meetingInfo ? "PENDING" : "SKIPPED",
			rawData: event as any,
		};

		if (existing) {
			// Update existing event
			const updated = await db.calendarEvent.update({
				where: { id: existing.id },
				data: eventData,
			});

			return updated;
		}

		// Create new event
		const created = await db.calendarEvent.create({
			data: eventData as any,
		});

		// Auto-schedule meeting if enabled
		if (integration.autoSchedule && meetingInfo && shouldProcess) {
			await this.scheduleEventAsMeeting(created);
		}

		return created;
	}

	/**
	 * Schedule a calendar event as a meeting
	 */
	async scheduleEventAsMeeting(event: CalendarEvent): Promise<void> {
		if (!event.meetingUrl || !event.platform) {
			throw new Error("Event does not have a meeting URL or platform");
		}

		// Check if meeting already exists
		if (event.meetingId) {
			calendarLogger.info("Meeting already scheduled for event", { eventId: event.id });
			return;
		}

		// Get a bot account for the platform
		const botAccount = await db.botAccount.findFirst({
			where: {
				organizationId: event.organizationId,
				platform: event.platform,
				isActive: true,
			},
		});

		if (!botAccount) {
			await db.calendarEvent.update({
				where: { id: event.id },
				data: {
					status: "FAILED",
					error: `No active bot account for platform ${event.platform}`,
				},
			});
			return;
		}

		// Create meeting
		const meeting = await db.meeting.create({
			data: {
				organizationId: event.organizationId,
				botAccountId: botAccount.id,
				platform: event.platform,
				url: event.meetingUrl,
				scheduledStart: event.startTime,
				scheduledEnd: event.endTime,
				status: "PENDING",
			},
		});

		// Link event to meeting
		await db.calendarEvent.update({
			where: { id: event.id },
			data: {
				meetingId: meeting.id,
				status: "SCHEDULED",
			},
		});

		calendarLogger.info("Meeting scheduled from calendar event", {
			eventId: event.id,
			meetingId: meeting.id,
		});
	}

	/**
	 * Get upcoming events for an organization
	 */
	async getUpcomingEvents(organizationId: string, hours: number = 24): Promise<CalendarEvent[]> {
		const now = new Date();
		const future = new Date(now.getTime() + hours * 60 * 60 * 1000);

		return db.calendarEvent.findMany({
			where: {
				organizationId,
				startTime: {
					gte: now,
					lte: future,
				},
				status: {
					in: ["PENDING", "SCHEDULED"],
				},
			},
			orderBy: { startTime: "asc" },
			include: {
				meeting: true,
				calendarIntegration: {
					select: {
						id: true,
						name: true,
						provider: true,
					},
				},
			},
		});
	}

	/**
	 * Start calendar sync scheduler
	 */
	startSyncScheduler(): void {
		// Run every minute to check for integrations that need syncing
		setInterval(async () => {
			try {
				const integrations = await db.calendarIntegration.findMany({
					where: {
						isActive: true,
					},
				});

				const now = new Date();

				for (const integration of integrations) {
					const lastSync = integration.lastSyncAt || new Date(0);
					const nextSync = new Date(lastSync.getTime() + integration.syncInterval * 1000);

					if (now >= nextSync) {
						calendarLogger.info("Starting scheduled calendar sync", {
							integrationId: integration.id,
							provider: integration.provider,
						});

						this.syncCalendarIntegration(integration.id).catch((error) => {
							calendarLogger.error("Scheduled sync failed", {
								integrationId: integration.id,
								error,
							});
						});
					}
				}
			} catch (error) {
				calendarLogger.error("Sync scheduler error", error);
			}
		}, 60000); // Check every minute

		calendarLogger.info("Calendar sync scheduler started");
	}
}

export const calendarService = new CalendarService();
