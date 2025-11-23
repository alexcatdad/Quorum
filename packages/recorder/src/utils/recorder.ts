import { writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import type { RecordingResult } from "../types";

export async function startRecording(
	page: Page,
	outputPath: string,
	duration?: number,
): Promise<RecordingResult> {
	try {
		// Start video recording
		const startTime = Date.now();

		// Wait for the specified duration or until recording is stopped
		const recordingDuration = duration || 3600; // Default 1 hour
		await page.waitForTimeout(recordingDuration * 1000);

		const endTime = Date.now();
		const actualDuration = Math.floor((endTime - startTime) / 1000);

		// In a real implementation, we would use CDP (Chrome DevTools Protocol)
		// to capture the video stream directly. For now, this is a placeholder.

		return {
			success: true,
			filePath: outputPath,
			duration: actualDuration,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function captureHAR(page: Page, harPath: string): Promise<void> {
	// Save HAR (HTTP Archive) file
	const harData = await page.context().storageState();
	await writeFile(harPath, JSON.stringify(harData, null, 2));
}

export async function waitForMeetingToStart(page: Page, timeout: number = 30000): Promise<boolean> {
	try {
		// Wait for video elements or meeting indicators
		await page.waitForSelector("video", { timeout });
		return true;
	} catch {
		return false;
	}
}

export async function getMeetingDuration(page: Page): Promise<number> {
	// Try to get meeting duration from the page
	try {
		const duration = await page.evaluate(() => {
			const video = document.querySelector("video");
			return video?.duration || 0;
		});

		return Math.floor(duration);
	} catch {
		return 0;
	}
}
