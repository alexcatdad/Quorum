import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import type {
	ParticipantUpdateCallback,
	PlatformCredentials,
	RecordingConfig,
	RecordingResult,
} from "../types";
import { ParticipantTracker } from "../utils/participant-tracker";
import { captureHAR, startRecording, waitForMeetingToStart } from "../utils/recorder";

export class SlackRecorder {
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
			headless: false, // Slack Huddles require non-headless for media
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
			// Navigate to Slack login
			await this.page.goto("https://slack.com/signin", { waitUntil: "networkidle" });

			// Enter workspace URL or email
			await this.page.fill('input[type="email"]', credentials.username);
			await this.page.click('button[type="submit"]');

			// Wait for password field
			await this.page.waitForSelector('input[type="password"]', { timeout: 10000 });

			// Enter password
			await this.page.fill('input[type="password"]', credentials.password);
			await this.page.click('button[type="submit"]');

			// Wait for Slack workspace to load
			await this.page.waitForSelector('[data-qa="workspace"]', { timeout: 30000 });

			return true;
		} catch (_error) {
			return false;
		}
	}

	async joinHuddle(config: RecordingConfig): Promise<RecordingResult> {
		if (!this.page) throw new Error("Recorder not initialized");

		try {
			// Navigate to Slack workspace/channel with huddle
			await this.page.goto(config.meetingUrl, { waitUntil: "networkidle" });

			// Look for and click the "Join" button for huddle
			await this.page.waitForSelector('[data-qa="huddle_join_button"]', {
				timeout: 30000,
			});

			// Join the huddle
			await this.page.click('[data-qa="huddle_join_button"]');

			// Wait for huddle to start
			const huddleStarted = await waitForMeetingToStart(this.page, 60000);

			if (!huddleStarted) {
				return {
					success: false,
					error: "Huddle did not start within timeout",
				};
			}

			// Mute mic and turn off camera
			const micButton = await this.page.$('[data-qa="huddle_mute_button"]');
			const cameraButton = await this.page.$('[data-qa="huddle_video_button"]');

			if (micButton) await micButton.click();
			if (cameraButton) await cameraButton.click();

			// Start participant tracking if enabled
			if (config.trackParticipants !== false) {
				this.participantTracker = new ParticipantTracker(this.page, "slack");
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

	async leaveHuddle(): Promise<void> {
		if (!this.page) return;

		try {
			// Click leave button
			const leaveButton = await this.page.$('[data-qa="huddle_leave_button"]');
			if (leaveButton) {
				await leaveButton.click();
			}
		} catch (_error) {}
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

			const result = await this.joinHuddle(config);

			await this.leaveHuddle();

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
