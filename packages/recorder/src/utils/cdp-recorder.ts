import type { Page, CDPSession } from "playwright";
import { writeFile } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";

export class CDPRecorder {
	private session: CDPSession | null = null;
	private videoStream: WriteStream | null = null;
	private frames: Buffer[] = [];
	private isRecording = false;

	async startRecording(page: Page, outputPath: string): Promise<void> {
		if (this.isRecording) {
			throw new Error("Already recording");
		}

		// Get CDP session
		const client = await page.context().newCDPSession(page);
		this.session = client;

		// Enable necessary CDP domains
		await this.session.send("Page.enable");
		await this.session.send("Runtime.enable");
		await this.session.send("Network.enable");

		// Start screen recording using CDP
		// Note: This requires Chrome/Chromium with headless mode disabled
		await this.session.send("Page.startScreencast", {
			format: "jpeg",
			quality: 90,
			maxWidth: 1920,
			maxHeight: 1080,
			everyNthFrame: 1,
		});

		// Create write stream for video
		this.videoStream = createWriteStream(outputPath);

		// Listen for screencast frames
		this.session.on("Page.screencastFrame", async (event: any) => {
			try {
				// Acknowledge the frame
				await this.session?.send("Page.screencastFrameAck", {
					sessionId: event.sessionId,
				});

				// Decode base64 frame data
				const frameData = Buffer.from(event.data, "base64");

				// Store frame for later processing
				this.frames.push(frameData);

				// Optionally write to stream immediately
				if (this.videoStream) {
					this.videoStream.write(frameData);
				}
			} catch (error) {
				console.error("Error processing screencast frame:", error);
			}
		});

		this.isRecording = true;
	}

	async stopRecording(): Promise<void> {
		if (!this.isRecording || !this.session) {
			return;
		}

		try {
			// Stop screencast
			await this.session.send("Page.stopScreencast");

			// Close video stream
			if (this.videoStream) {
				this.videoStream.end();
				this.videoStream = null;
			}

			this.isRecording = false;
		} catch (error) {
			console.error("Error stopping recording:", error);
			throw error;
		}
	}

	async close(): Promise<void> {
		await this.stopRecording();

		if (this.session) {
			await this.session.detach();
			this.session = null;
		}

		this.frames = [];
	}

	getFrameCount(): number {
		return this.frames.length;
	}

	isActive(): boolean {
		return this.isRecording;
	}
}

/**
 * Alternative implementation using Playwright's built-in video recording
 * This is more reliable than CDP for most use cases
 */
export async function recordWithPlaywright(
	page: Page,
	durationSeconds: number,
): Promise<string> {
	// Wait for the specified duration
	await page.waitForTimeout(durationSeconds * 1000);

	// Get video path from context
	const videoPath = await page.video()?.path();

	if (!videoPath) {
		throw new Error("No video was recorded");
	}

	return videoPath;
}
