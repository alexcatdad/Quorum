import type { Page } from "playwright";
import type { Participant, ParticipantEvent, ParticipantUpdateCallback } from "../types";

/**
 * Platform-specific selectors for participant extraction
 */
export const PLATFORM_SELECTORS = {
	teams: {
		participantList: '[data-tid="roster-participant"]',
		participantName: '[data-tid="roster-participant-name"]',
		participantAvatar: '[data-tid="roster-participant-avatar"] img',
		participantMuted: '[data-tid="roster-participant-mute-icon"]',
		participantVideo: '[data-tid="roster-participant-video-icon"]',
		participantSpeaking: '[data-tid="roster-participant-speaking"]',
		participantRole: '[data-tid="roster-participant-role"]',
		meetingTitle: '[data-tid="meeting-title"]',
		rosterButton: 'button[data-tid="roster-button"]',
		hostIndicator: '[data-tid="roster-host-indicator"]',
	},
	slack: {
		participantList: '[data-qa="huddle_participant"]',
		participantName: '[data-qa="huddle_participant_name"]',
		participantAvatar: '[data-qa="huddle_participant_avatar"] img',
		participantMuted: '[data-qa="huddle_participant_muted"]',
		participantSpeaking: '[data-qa="huddle_participant_speaking"]',
		huddleTitle: '[data-qa="huddle_title"]',
	},
	youtube: {
		participantList: ".ytp-participant",
		viewerCount: ".ytp-live-badge-text",
		channelName: "#channel-name",
		videoTitle: "h1.ytd-video-primary-info-renderer",
		liveChat: "#chat-messages .yt-live-chat-text-message-renderer",
		chatAuthor: "#author-name",
	},
};

/**
 * Tracks participants in a meeting and detects changes
 */
export class ParticipantTracker {
	private page: Page;
	private platform: "teams" | "slack" | "youtube";
	private participants: Map<string, Participant> = new Map();
	private events: ParticipantEvent[] = [];
	private pollInterval: NodeJS.Timeout | null = null;
	private onUpdate: ParticipantUpdateCallback | null = null;

	constructor(page: Page, platform: "teams" | "slack" | "youtube") {
		this.page = page;
		this.platform = platform;
	}

	/**
	 * Set callback for real-time participant updates
	 */
	setUpdateCallback(callback: ParticipantUpdateCallback): void {
		this.onUpdate = callback;
	}

	/**
	 * Start tracking participants
	 */
	async startTracking(intervalMs: number = 5000): Promise<void> {
		// Initial poll
		await this.pollParticipants();

		// Set up periodic polling
		this.pollInterval = setInterval(async () => {
			await this.pollParticipants();
		}, intervalMs);
	}

	/**
	 * Stop tracking participants
	 */
	stopTracking(): void {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}

		// Mark remaining participants as left
		const now = new Date().toISOString();
		for (const participant of this.participants.values()) {
			if (!participant.leftAt) {
				participant.leftAt = now;
				this.events.push({
					type: "left",
					participant,
					timestamp: now,
				});
			}
		}
	}

	/**
	 * Get current list of participants
	 */
	getParticipants(): Participant[] {
		return Array.from(this.participants.values());
	}

	/**
	 * Get all participant events
	 */
	getEvents(): ParticipantEvent[] {
		return this.events;
	}

	/**
	 * Poll for current participants based on platform
	 */
	private async pollParticipants(): Promise<void> {
		try {
			switch (this.platform) {
				case "teams":
					await this.pollTeamsParticipants();
					break;
				case "slack":
					await this.pollSlackParticipants();
					break;
				case "youtube":
					await this.pollYouTubeParticipants();
					break;
			}
		} catch (_error) {}
	}

	/**
	 * Poll Microsoft Teams participants
	 */
	private async pollTeamsParticipants(): Promise<void> {
		const selectors = PLATFORM_SELECTORS.teams;

		// Try to open roster panel if not visible
		const rosterButton = await this.page.$(selectors.rosterButton);
		if (rosterButton) {
			const isRosterOpen = await this.page.$(selectors.participantList);
			if (!isRosterOpen) {
				await rosterButton.click().catch(() => {});
				await this.page
					.waitForSelector(selectors.participantList, { timeout: 5000 })
					.catch(() => {});
			}
		}

		const participantElements = await this.page.$$(selectors.participantList);
		const currentParticipants = new Set<string>();
		const now = new Date().toISOString();

		for (const element of participantElements) {
			const name = await element
				.$eval(selectors.participantName, (el) => el.textContent?.trim() || "")
				.catch(() => "Unknown");

			if (!name || name === "Unknown") continue;

			const id = name.toLowerCase().replace(/\s+/g, "-");
			currentParticipants.add(id);

			const avatar = await element
				.$eval(selectors.participantAvatar, (el: HTMLImageElement) => el.src)
				.catch(() => undefined);

			const isMuted = (await element.$(selectors.participantMuted)) !== null;
			const isSpeaking = (await element.$(selectors.participantSpeaking)) !== null;
			const isHost = (await element.$(selectors.hostIndicator)) !== null;

			const participant: Participant = {
				id,
				name,
				avatar,
				isMuted,
				isSpeaking,
				role: isHost ? "host" : "attendee",
				joinedAt: now,
			};

			this.updateParticipant(participant);
		}

		// Check for participants who left
		this.checkForLeftParticipants(currentParticipants, now);
	}

	/**
	 * Poll Slack Huddle participants
	 */
	private async pollSlackParticipants(): Promise<void> {
		const selectors = PLATFORM_SELECTORS.slack;

		const participantElements = await this.page.$$(selectors.participantList);
		const currentParticipants = new Set<string>();
		const now = new Date().toISOString();

		for (const element of participantElements) {
			const name = await element
				.$eval(selectors.participantName, (el) => el.textContent?.trim() || "")
				.catch(() => "Unknown");

			if (!name || name === "Unknown") continue;

			const id = name.toLowerCase().replace(/\s+/g, "-");
			currentParticipants.add(id);

			const avatar = await element
				.$eval(selectors.participantAvatar, (el: HTMLImageElement) => el.src)
				.catch(() => undefined);

			const isMuted = (await element.$(selectors.participantMuted)) !== null;
			const isSpeaking = (await element.$(selectors.participantSpeaking)) !== null;

			const participant: Participant = {
				id,
				name,
				avatar,
				isMuted,
				isSpeaking,
				role: "attendee",
				joinedAt: now,
			};

			this.updateParticipant(participant);
		}

		this.checkForLeftParticipants(currentParticipants, now);
	}

	/**
	 * Poll YouTube Live participants (viewers/chat)
	 */
	private async pollYouTubeParticipants(): Promise<void> {
		const selectors = PLATFORM_SELECTORS.youtube;
		const now = new Date().toISOString();
		const currentParticipants = new Set<string>();

		// For YouTube, we track chat participants
		const chatMessages = await this.page.$$(selectors.liveChat);

		for (const message of chatMessages.slice(-50)) {
			// Last 50 messages
			const author = await message
				.$eval(selectors.chatAuthor, (el) => el.textContent?.trim() || "")
				.catch(() => "Unknown");

			if (!author || author === "Unknown") continue;

			const id = author.toLowerCase().replace(/\s+/g, "-");
			currentParticipants.add(id);

			const participant: Participant = {
				id,
				name: author,
				role: "attendee",
				joinedAt: now,
			};

			// Only add if not already tracked (to avoid spam from frequent chatters)
			if (!this.participants.has(id)) {
				this.updateParticipant(participant);
			}
		}

		// Don't mark YouTube chat participants as "left" since chat is transient
	}

	/**
	 * Update or add a participant
	 */
	private updateParticipant(participant: Participant): void {
		const existing = this.participants.get(participant.id!);
		const now = new Date().toISOString();

		if (!existing) {
			// New participant joined
			participant.joinedAt = now;
			this.participants.set(participant.id!, participant);

			const event: ParticipantEvent = {
				type: "joined",
				participant,
				timestamp: now,
			};
			this.events.push(event);
			this.onUpdate?.(this.getParticipants(), event);
		} else {
			// Check for state changes
			if (existing.isSpeaking !== participant.isSpeaking) {
				const event: ParticipantEvent = {
					type: participant.isSpeaking ? "speaking_start" : "speaking_end",
					participant,
					timestamp: now,
				};
				this.events.push(event);
				this.onUpdate?.(this.getParticipants(), event);
			}

			if (existing.isMuted !== participant.isMuted) {
				const event: ParticipantEvent = {
					type: participant.isMuted ? "muted" : "unmuted",
					participant,
					timestamp: now,
				};
				this.events.push(event);
				this.onUpdate?.(this.getParticipants(), event);
			}

			if (existing.isPresenting !== participant.isPresenting) {
				const event: ParticipantEvent = {
					type: participant.isPresenting ? "presenting_start" : "presenting_end",
					participant,
					timestamp: now,
				};
				this.events.push(event);
				this.onUpdate?.(this.getParticipants(), event);
			}

			// Update the participant record
			this.participants.set(participant.id!, {
				...existing,
				...participant,
				joinedAt: existing.joinedAt, // Preserve original join time
			});
		}
	}

	/**
	 * Check for participants who have left
	 */
	private checkForLeftParticipants(currentIds: Set<string>, timestamp: string): void {
		for (const [id, participant] of this.participants) {
			if (!currentIds.has(id) && !participant.leftAt) {
				participant.leftAt = timestamp;

				const event: ParticipantEvent = {
					type: "left",
					participant,
					timestamp,
				};
				this.events.push(event);
				this.onUpdate?.(this.getParticipants(), event);
			}
		}
	}

	/**
	 * Get meeting metadata
	 */
	async getMeetingMetadata(): Promise<{ title?: string; host?: string }> {
		try {
			switch (this.platform) {
				case "teams": {
					const title = await this.page
						.$eval(PLATFORM_SELECTORS.teams.meetingTitle, (el) => el.textContent?.trim())
						.catch(() => undefined);
					return { title };
				}
				case "slack": {
					const title = await this.page
						.$eval(PLATFORM_SELECTORS.slack.huddleTitle, (el) => el.textContent?.trim())
						.catch(() => undefined);
					return { title };
				}
				case "youtube": {
					const title = await this.page
						.$eval(PLATFORM_SELECTORS.youtube.videoTitle, (el) => el.textContent?.trim())
						.catch(() => undefined);
					const host = await this.page
						.$eval(PLATFORM_SELECTORS.youtube.channelName, (el) => el.textContent?.trim())
						.catch(() => undefined);
					return { title, host };
				}
				default:
					return {};
			}
		} catch {
			return {};
		}
	}
}
