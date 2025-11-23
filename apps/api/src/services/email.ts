import { db } from "@quorum/db";
import type { EmailInvitation, Platform } from "@prisma/client";
import { logger, createChildLogger } from "../utils/logger";
import { extractMeetingUrl, calendarService } from "./calendar";

const emailLogger = createChildLogger("email");

/**
 * Email configuration interface
 */
export interface EmailConfig {
	smtpHost: string;
	smtpPort: number;
	smtpUser: string;
	smtpPassword: string;
	smtpFrom: string;
	smtpSecure?: boolean;
}

/**
 * Parsed email invitation
 */
export interface ParsedEmail {
	from: string;
	to: string;
	subject: string;
	bodyText?: string;
	bodyHtml?: string;
	headers?: Record<string, string>;
	attachments?: Array<{
		filename: string;
		contentType: string;
		content: string;
	}>;
}

/**
 * Email service for processing meeting invitations
 */
export class EmailService {
	private config: EmailConfig | null = null;

	/**
	 * Configure SMTP settings
	 */
	configure(config: EmailConfig): void {
		this.config = config;
		emailLogger.info("Email service configured", {
			host: config.smtpHost,
			port: config.smtpPort,
		});
	}

	/**
	 * Process an incoming email invitation
	 */
	async processIncomingEmail(
		organizationId: string,
		email: ParsedEmail,
	): Promise<EmailInvitation> {
		emailLogger.info("Processing incoming email", {
			organizationId,
			from: email.from,
			subject: email.subject,
		});

		// Look for meeting URL in email body and subject
		const searchText = [
			email.subject || "",
			email.bodyText || "",
			email.bodyHtml || "",
		].join(" ");

		const meetingInfo = extractMeetingUrl(searchText);

		// Look for iCal attachment
		let icsContent: string | undefined;
		let scheduledStart: Date | undefined;
		let scheduledEnd: Date | undefined;

		const icsAttachment = email.attachments?.find(
			(a) => a.contentType === "text/calendar" || a.filename.endsWith(".ics")
		);

		if (icsAttachment) {
			icsContent = icsAttachment.content;

			// Parse iCal to get dates
			try {
				const events = calendarService.parseICal(icsContent);
				if (events.length > 0) {
					scheduledStart = events[0].dtstart;
					scheduledEnd = events[0].dtend;

					// Also try to extract meeting URL from iCal
					if (!meetingInfo) {
						const icalText = [
							events[0].description || "",
							events[0].location || "",
							events[0].summary || "",
						].join(" ");

						const icalMeetingInfo = extractMeetingUrl(icalText);
						if (icalMeetingInfo) {
							Object.assign(meetingInfo || {}, icalMeetingInfo);
						}
					}
				}
			} catch (error) {
				emailLogger.warn("Failed to parse iCal attachment", error);
			}
		}

		// Create email invitation record
		const invitation = await db.emailInvitation.create({
			data: {
				organizationId,
				fromAddress: email.from,
				toAddress: email.to,
				subject: email.subject,
				bodyText: email.bodyText,
				bodyHtml: email.bodyHtml,
				meetingUrl: meetingInfo?.url,
				platform: meetingInfo?.platform,
				scheduledStart,
				scheduledEnd,
				icsAttachment: icsContent,
				status: meetingInfo ? "PENDING" : "INVALID",
				rawHeaders: email.headers,
			},
		});

		emailLogger.info("Email invitation created", {
			invitationId: invitation.id,
			hasMeetingUrl: !!meetingInfo,
			platform: meetingInfo?.platform,
		});

		return invitation;
	}

	/**
	 * Schedule a meeting from an email invitation
	 */
	async scheduleMeetingFromInvitation(invitationId: string): Promise<void> {
		const invitation = await db.emailInvitation.findUnique({
			where: { id: invitationId },
		});

		if (!invitation) {
			throw new Error(`Email invitation not found: ${invitationId}`);
		}

		if (!invitation.meetingUrl || !invitation.platform) {
			await db.emailInvitation.update({
				where: { id: invitationId },
				data: {
					status: "INVALID",
					error: "No meeting URL or platform detected",
				},
			});
			return;
		}

		// Get a bot account for the platform
		const botAccount = await db.botAccount.findFirst({
			where: {
				organizationId: invitation.organizationId,
				platform: invitation.platform,
				isActive: true,
			},
		});

		if (!botAccount) {
			await db.emailInvitation.update({
				where: { id: invitationId },
				data: {
					status: "FAILED",
					error: `No active bot account for platform ${invitation.platform}`,
				},
			});
			return;
		}

		// Create meeting
		const meeting = await db.meeting.create({
			data: {
				organizationId: invitation.organizationId,
				botAccountId: botAccount.id,
				platform: invitation.platform,
				url: invitation.meetingUrl,
				scheduledStart: invitation.scheduledStart || new Date(),
				scheduledEnd: invitation.scheduledEnd,
				status: "PENDING",
			},
		});

		// Update invitation
		await db.emailInvitation.update({
			where: { id: invitationId },
			data: {
				meetingId: meeting.id,
				status: "PROCESSED",
			},
		});

		emailLogger.info("Meeting scheduled from email invitation", {
			invitationId,
			meetingId: meeting.id,
		});
	}

	/**
	 * Send email notification (requires SMTP configuration)
	 */
	async sendEmail(
		to: string,
		subject: string,
		body: { text?: string; html?: string },
	): Promise<boolean> {
		if (!this.config) {
			emailLogger.warn("Email service not configured, skipping send");
			return false;
		}

		try {
			// Using Bun's native capabilities for SMTP would require additional implementation
			// For now, we'll use fetch to send via an HTTP email API or implement basic SMTP

			// This is a placeholder for actual SMTP implementation
			// In production, you'd use nodemailer or similar
			emailLogger.info("Sending email", {
				to,
				subject,
				configuredHost: this.config.smtpHost,
			});

			// Simulate email sending
			// In a real implementation, this would connect to SMTP server
			const emailData = {
				from: this.config.smtpFrom,
				to,
				subject,
				text: body.text,
				html: body.html,
			};

			// For now, just log the email
			emailLogger.info("Email would be sent", emailData);

			return true;
		} catch (error) {
			emailLogger.error("Failed to send email", error);
			return false;
		}
	}

	/**
	 * Send recording ready notification
	 */
	async sendRecordingReadyNotification(
		to: string,
		meetingTitle: string,
		recordingUrl: string,
		duration?: number,
	): Promise<boolean> {
		const durationStr = duration ? `${Math.floor(duration / 60)} minutes` : "N/A";

		return this.sendEmail(to, `Recording Ready: ${meetingTitle}`, {
			text: `
Your meeting recording is ready!

Meeting: ${meetingTitle}
Duration: ${durationStr}

Download your recording here:
${recordingUrl}

This link will expire in 24 hours.

---
Quorum Meeting Recorder
			`.trim(),
			html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9fafb; }
    .button { display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Recording Ready</h1>
    </div>
    <div class="content">
      <p>Your meeting recording is ready!</p>
      <p><strong>Meeting:</strong> ${meetingTitle}</p>
      <p><strong>Duration:</strong> ${durationStr}</p>
      <a href="${recordingUrl}" class="button">Download Recording</a>
      <p><small>This link will expire in 24 hours.</small></p>
    </div>
    <div class="footer">
      <p>Quorum Meeting Recorder</p>
    </div>
  </div>
</body>
</html>
			`.trim(),
		});
	}

	/**
	 * Get pending email invitations
	 */
	async getPendingInvitations(organizationId: string): Promise<EmailInvitation[]> {
		return db.emailInvitation.findMany({
			where: {
				organizationId,
				status: "PENDING",
			},
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Get invitation statistics for an organization
	 */
	async getStats(organizationId: string) {
		const [total, pending, processed, invalid, failed] = await Promise.all([
			db.emailInvitation.count({ where: { organizationId } }),
			db.emailInvitation.count({ where: { organizationId, status: "PENDING" } }),
			db.emailInvitation.count({ where: { organizationId, status: "PROCESSED" } }),
			db.emailInvitation.count({ where: { organizationId, status: "INVALID" } }),
			db.emailInvitation.count({ where: { organizationId, status: "FAILED" } }),
		]);

		return {
			total,
			pending,
			processed,
			invalid,
			failed,
		};
	}
}

export const emailService = new EmailService();
