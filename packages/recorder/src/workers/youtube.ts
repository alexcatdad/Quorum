import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import type { RecordingConfig, RecordingResult, PlatformCredentials, ParticipantUpdateCallback } from "../types";
import { startRecording, captureHAR, waitForMeetingToStart } from "../utils/recorder";
import { ParticipantTracker } from "../utils/participant-tracker";

export class YouTubeRecorder {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private participantTracker: ParticipantTracker | null = null;
	private onParticipantUpdate: ParticipantUpdateCallback | null = null;

	/**
	 * Set callback for real-time participant updates (chat participants for YouTube)
	 */
	setParticipantUpdateCallback(callback: ParticipantUpdateCallback): void {
		this.onParticipantUpdate = callback;
	}

	async initialize(): Promise<void> {
		this.browser = await chromium.launch({
			headless: false,
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
		});

		this.page = await this.context.newPage();
	}

	async login(credentials: PlatformCredentials): Promise<boolean> {
		if (!this.page) throw new Error("Recorder not initialized");

		try {
			// Navigate to YouTube
			await this.page.goto("https://accounts.google.com/", { waitUntil: "networkidle" });

			// Enter email
			await this.page.fill('input[type="email"]', credentials.username);
			await this.page.click('button:has-text("Next")');

			// Wait for password field
			await this.page.waitForSelector('input[type="password"]', { timeout: 10000 });

			// Enter password
			await this.page.fill('input[type="password"]', credentials.password);
			await this.page.click('button:has-text("Next")');

			// Wait for login to complete
			await this.page.waitForTimeout(5000);

			return true;
		} catch (error) {
			console.error("YouTube/Google login failed:", error);
			return false;
		}
	}

	async recordStream(config: RecordingConfig): Promise<RecordingResult> {
		if (!this.page) throw new Error("Recorder not initialized");

		try {
			// Navigate to YouTube video/stream URL
			await this.page.goto(config.meetingUrl, { waitUntil: "networkidle" });

			// Wait for video player
			await this.page.waitForSelector("video", { timeout: 30000 });

			// Click play if not auto-playing
			const playButton = await this.page.$('button[aria-label="Play"]');
			if (playButton) {
				await playButton.click();
			}

			// Wait for stream to start
			const streamStarted = await waitForMeetingToStart(this.page, 60000);

			if (!streamStarted) {
				return {
					success: false,
					error: "Stream did not start within timeout",
				};
			}

			// Maximize video quality
			await this.page.click('button[aria-label="Settings"]');
			await this.page.waitForTimeout(500);
			await this.page.click('div:has-text("Quality")');
			await this.page.waitForTimeout(500);

			// Select highest quality available
			const qualityOptions = await this.page.$$('div[role="menuitemradio"]');
			if (qualityOptions.length > 0) {
				await qualityOptions[0].click(); // First option is usually highest quality
			}

			// Start participant tracking (tracks chat participants for YouTube)
			if (config.trackParticipants !== false) {
				this.participantTracker = new ParticipantTracker(this.page, "youtube");
				if (this.onParticipantUpdate) {
					this.participantTracker.setUpdateCallback(this.onParticipantUpdate);
				}
				await this.participantTracker.startTracking(config.participantPollInterval || 10000);
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

			// Login only if credentials provided (public streams don't need auth)
			if (credentials.username && credentials.password) {
				const loginSuccess = await this.login(credentials);
				if (!loginSuccess) {
					return {
						success: false,
						error: "Login failed",
					};
				}
			}

			const result = await this.recordStream(config);

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
