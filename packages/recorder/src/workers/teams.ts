import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import type { RecordingConfig, RecordingResult, PlatformCredentials, ParticipantUpdateCallback } from "../types";
import { startRecording, captureHAR, waitForMeetingToStart } from "../utils/recorder";
import { ParticipantTracker } from "../utils/participant-tracker";

export class TeamsRecorder {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private participantTracker: ParticipantTracker | null = null;
	private onParticipantUpdate: ParticipantUpdateCallback | null = null;

	/**
	 * Set callback for real-time participant updates
	 */
	setParticipantUpdateCallback(callback: ParticipantUpdateCallback): void {
		this.onParticipantUpdate = callback;
	}

	async initialize(): Promise<void> {
		this.browser = await chromium.launch({
			headless: false, // Teams requires non-headless for media
			args: [
				"--use-fake-ui-for-media-stream",
				"--use-fake-device-for-media-stream",
				"--disable-blink-features=AutomationControlled",
			],
		});

		this.context = await this.browser.newContext({
			viewport: { width: 1920, height: 1080 },
			recordVideo: {
				dir: "./recordings",
				size: { width: 1920, height: 1080 },
			},
			recordHar: {
				path: "./recordings/network.har",
			},
			permissions: ["microphone", "camera"],
		});

		this.page = await this.context.newPage();
	}

	async login(credentials: PlatformCredentials): Promise<boolean> {
		if (!this.page) throw new Error("Recorder not initialized");

		try {
			// Navigate to Teams login
			await this.page.goto("https://teams.microsoft.com/", { waitUntil: "networkidle" });

			// Enter email
			await this.page.fill('input[type="email"]', credentials.username);
			await this.page.click('input[type="submit"]');

			// Wait for password field
			await this.page.waitForSelector('input[type="password"]', { timeout: 10000 });

			// Enter password
			await this.page.fill('input[type="password"]', credentials.password);
			await this.page.click('input[type="submit"]');

			// Wait for "Stay signed in?" and click No
			await this.page.waitForTimeout(2000);
			const staySignedInButton = await this.page.$('input[value="No"]');
			if (staySignedInButton) {
				await staySignedInButton.click();
			}

			// Wait for Teams to load
			await this.page.waitForSelector('[data-tid="app-bar"]', { timeout: 30000 });

			return true;
		} catch (error) {
			console.error("Teams login failed:", error);
			return false;
		}
	}

	async joinMeeting(config: RecordingConfig): Promise<RecordingResult> {
		if (!this.page) throw new Error("Recorder not initialized");

		try {
			// Navigate to meeting URL
			await this.page.goto(config.meetingUrl, { waitUntil: "networkidle" });

			// Wait for join button and click
			await this.page.waitForSelector('button[data-tid="prejoin-join-button"]', {
				timeout: 30000,
			});

			// Turn off camera and mic before joining
			const cameraButton = await this.page.$('button[data-tid="toggle-video"]');
			const micButton = await this.page.$('button[data-tid="toggle-mute"]');

			if (cameraButton) await cameraButton.click();
			if (micButton) await micButton.click();

			// Join the meeting
			await this.page.click('button[data-tid="prejoin-join-button"]');

			// Wait for meeting to start
			const meetingStarted = await waitForMeetingToStart(this.page, 60000);

			if (!meetingStarted) {
				return {
					success: false,
					error: "Meeting did not start within timeout",
				};
			}

			// Start participant tracking if enabled
			if (config.trackParticipants !== false) {
				this.participantTracker = new ParticipantTracker(this.page, "teams");
				if (this.onParticipantUpdate) {
					this.participantTracker.setUpdateCallback(this.onParticipantUpdate);
				}
				await this.participantTracker.startTracking(config.participantPollInterval || 5000);
			}

			// Start recording
			const result = await startRecording(this.page, config.outputPath, config.duration);

			// Stop participant tracking and get results
			if (this.participantTracker) {
				this.participantTracker.stopTracking();
				result.participants = this.participantTracker.getParticipants();
				result.participantEvents = this.participantTracker.getEvents();

				const metadata = await this.participantTracker.getMeetingMetadata();
				result.meetingTitle = metadata.title;
				result.hostName = metadata.host;
			}

			// Capture HAR file
			if (this.context) {
				const harPath = config.outputPath.replace(/\.[^.]+$/, ".har");
				await captureHAR(this.page, harPath);
				result.harPath = harPath;
			}

			return result;
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async leaveMeeting(): Promise<void> {
		if (!this.page) return;

		try {
			// Click leave button
			const leaveButton = await this.page.$('button[data-tid="call-hangup"]');
			if (leaveButton) {
				await leaveButton.click();
			}
		} catch (error) {
			console.error("Failed to leave meeting:", error);
		}
	}

	async close(): Promise<void> {
		if (this.page) {
			await this.page.close();
			this.page = null;
		}

		if (this.context) {
			await this.context.close();
			this.context = null;
		}

		if (this.browser) {
			await this.browser.close();
			this.browser = null;
		}
	}

	async record(
		credentials: PlatformCredentials,
		config: RecordingConfig,
	): Promise<RecordingResult> {
		try {
			await this.initialize();

			const loginSuccess = await this.login(credentials);
			if (!loginSuccess) {
				return {
					success: false,
					error: "Login failed",
				};
			}

			const result = await this.joinMeeting(config);

			await this.leaveMeeting();

			return result;
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			await this.close();
		}
	}
}
