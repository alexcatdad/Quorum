import { describe, expect, it } from "bun:test";
import { CalendarService, extractMeetingUrl } from "./calendar";

describe("Calendar Service", () => {
	const calendarService = new CalendarService();

	describe("extractMeetingUrl", () => {
		it("should extract Teams meeting URL", () => {
			const text = "Join the meeting: https://teams.microsoft.com/l/meetup-join/12345";
			const result = extractMeetingUrl(text);

			expect(result).not.toBeNull();
			expect(result?.platform).toBe("TEAMS");
			expect(result?.url).toContain("teams.microsoft.com");
		});

		it("should extract Slack huddle URL", () => {
			const text = "Join at https://mycompany.slack.com/huddle/C12345";
			const result = extractMeetingUrl(text);

			expect(result).not.toBeNull();
			expect(result?.platform).toBe("SLACK");
			expect(result?.url).toContain("slack.com/huddle");
		});

		it("should extract YouTube live URL", () => {
			const text = "Watch live: https://www.youtube.com/watch?v=abc123";
			const result = extractMeetingUrl(text);

			expect(result).not.toBeNull();
			expect(result?.platform).toBe("YOUTUBE");
			expect(result?.url).toContain("youtube.com");
		});

		it("should extract YouTube short URL", () => {
			const text = "Stream: https://youtu.be/abc123";
			const result = extractMeetingUrl(text);

			expect(result).not.toBeNull();
			expect(result?.platform).toBe("YOUTUBE");
		});

		it("should return null for text without meeting URL", () => {
			const text = "This is just a regular meeting about project status";
			const result = extractMeetingUrl(text);

			expect(result).toBeNull();
		});

		it("should return null for unsupported platforms", () => {
			const text = "Join at https://meet.google.com/abc-defg-hij";
			const result = extractMeetingUrl(text);

			// Google Meet is detected but not supported for recording
			expect(result).toBeNull();
		});
	});

	describe("parseICal", () => {
		it("should parse basic iCal content", () => {
			const icalContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test-event-123
SUMMARY:Team Standup
DESCRIPTION:Daily standup meeting\\nJoin: https://teams.microsoft.com/l/meetup-join/test
DTSTART:20240115T090000Z
DTEND:20240115T093000Z
ORGANIZER:mailto:organizer@example.com
ATTENDEE:mailto:attendee1@example.com
ATTENDEE:mailto:attendee2@example.com
END:VEVENT
END:VCALENDAR`;

			const events = calendarService.parseICal(icalContent);

			expect(events.length).toBe(1);
			expect(events[0].uid).toBe("test-event-123");
			expect(events[0].summary).toBe("Team Standup");
			expect(events[0].description).toContain("Daily standup meeting");
			expect(events[0].organizer).toBe("organizer@example.com");
			expect(events[0].attendees).toContain("attendee1@example.com");
			expect(events[0].dtstart).toBeInstanceOf(Date);
			expect(events[0].dtend).toBeInstanceOf(Date);
		});

		it("should parse multiple events", () => {
			const icalContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Event 1
DTSTART:20240115T090000Z
DTEND:20240115T100000Z
END:VEVENT
BEGIN:VEVENT
UID:event-2
SUMMARY:Event 2
DTSTART:20240115T140000Z
DTEND:20240115T150000Z
END:VEVENT
END:VCALENDAR`;

			const events = calendarService.parseICal(icalContent);

			expect(events.length).toBe(2);
			expect(events[0].uid).toBe("event-1");
			expect(events[1].uid).toBe("event-2");
		});

		it("should handle events with location containing meeting URL", () => {
			const icalContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:location-test
SUMMARY:Video Call
LOCATION:https://teams.microsoft.com/l/meetup-join/12345
DTSTART:20240115T090000Z
DTEND:20240115T100000Z
END:VEVENT
END:VCALENDAR`;

			const events = calendarService.parseICal(icalContent);

			expect(events.length).toBe(1);
			expect(events[0].location).toContain("teams.microsoft.com");
		});

		it("should return empty array for invalid iCal content", () => {
			const icalContent = "This is not iCal content";
			const events = calendarService.parseICal(icalContent);

			expect(events.length).toBe(0);
		});

		it("should skip events without required fields", () => {
			const icalContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:No UID Event
DTSTART:20240115T090000Z
DTEND:20240115T100000Z
END:VEVENT
END:VCALENDAR`;

			const events = calendarService.parseICal(icalContent);

			expect(events.length).toBe(0);
		});
	});
});
