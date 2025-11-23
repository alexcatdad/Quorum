import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export interface EncodingOptions {
	inputPath: string;
	outputPath: string;
	codec?: string; // Default: vp9
	quality?: number; // CRF value, 0-63 (lower = better quality)
	preset?: string; // Default: medium
	width?: number;
	height?: number;
	audioBitrate?: string; // Default: 128k
	onProgress?: (progress: EncodingProgress) => void;
}

export interface EncodingProgress {
	frame: number;
	fps: number;
	size: number; // bytes
	time: string; // HH:MM:SS.ms
	bitrate: string; // kbits/s
	speed: string; // e.g., "1.5x"
	percent?: number;
}

export interface EncodingResult {
	success: boolean;
	outputPath?: string;
	outputSize?: number;
	duration?: number;
	error?: string;
}

export class VP9Encoder {
	async encode(options: EncodingOptions): Promise<EncodingResult> {
		const {
			inputPath,
			outputPath,
			codec = "vp9",
			quality = 30, // Good balance between quality and file size
			preset = "medium",
			width,
			height,
			audioBitrate = "128k",
			onProgress,
		} = options;

		return new Promise((resolve) => {
			const args = [
				"-i",
				inputPath,
				"-c:v",
				`lib${codec}`,
				"-crf",
				quality.toString(),
				"-b:v",
				"0", // Use CRF mode
			];

			// Add scaling if dimensions provided
			if (width && height) {
				args.push("-vf", `scale=${width}:${height}`);
			}

			// Audio codec
			args.push("-c:a", "libopus", "-b:a", audioBitrate);

			// CPU preset
			args.push("-cpu-used", this.getVP9Preset(preset));

			// Enable two-pass for better quality
			args.push("-row-mt", "1", "-threads", "4");

			// Output
			args.push("-y", outputPath); // Overwrite output file

			const ffmpeg = spawn("ffmpeg", args);

			let errorOutput = "";

			ffmpeg.stderr.on("data", (data) => {
				const output = data.toString();
				errorOutput += output;

				// Parse progress from ffmpeg output
				if (onProgress) {
					const progress = this.parseProgress(output);
					if (progress) {
						onProgress(progress);
					}
				}
			});

			ffmpeg.on("close", async (code) => {
				if (code === 0) {
					try {
						const stats = await stat(outputPath);

						resolve({
							success: true,
							outputPath,
							outputSize: stats.size,
						});
					} catch (error) {
						resolve({
							success: false,
							error: `Encoding completed but failed to stat output file: ${error}`,
						});
					}
				} else {
					resolve({
						success: false,
						error: `FFmpeg exited with code ${code}. Output: ${errorOutput}`,
					});
				}
			});

			ffmpeg.on("error", (error) => {
				resolve({
					success: false,
					error: `Failed to start FFmpeg: ${error.message}`,
				});
			});
		});
	}

	private getVP9Preset(preset: string): string {
		// Map preset names to VP9 cpu-used values
		const presets: Record<string, string> = {
			ultrafast: "8",
			superfast: "6",
			veryfast: "5",
			faster: "4",
			fast: "3",
			medium: "2",
			slow: "1",
			slower: "0",
			veryslow: "0",
		};

		return presets[preset] || "2";
	}

	private parseProgress(output: string): EncodingProgress | null {
		// Parse ffmpeg progress output
		// Example: frame=  123 fps= 45 q=-0.0 size=    1234kB time=00:00:05.12 bitrate=1974.1kbits/s speed=1.23x
		const frameMatch = output.match(/frame=\s*(\d+)/);
		const fpsMatch = output.match(/fps=\s*(\d+\.?\d*)/);
		const sizeMatch = output.match(/size=\s*(\d+)kB/);
		const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
		const bitrateMatch = output.match(/bitrate=\s*(\d+\.?\d*kbits\/s)/);
		const speedMatch = output.match(/speed=\s*(\d+\.?\d*x)/);

		if (!frameMatch) return null;

		const progress: EncodingProgress = {
			frame: Number.parseInt(frameMatch[1], 10),
			fps: fpsMatch ? Number.parseFloat(fpsMatch[1]) : 0,
			size: sizeMatch ? Number.parseInt(sizeMatch[1], 10) * 1024 : 0,
			time: timeMatch ? timeMatch[1] : "00:00:00.00",
			bitrate: bitrateMatch ? bitrateMatch[1] : "0kbits/s",
			speed: speedMatch ? speedMatch[1] : "0x",
		};

		return progress;
	}

	async getVideoInfo(filePath: string): Promise<{
		duration: number;
		width: number;
		height: number;
		codec: string;
		bitrate: number;
	} | null> {
		return new Promise((resolve) => {
			const args = [
				"-v",
				"quiet",
				"-print_format",
				"json",
				"-show_format",
				"-show_streams",
				filePath,
			];

			const ffprobe = spawn("ffprobe", args);

			let output = "";

			ffprobe.stdout.on("data", (data) => {
				output += data.toString();
			});

			ffprobe.on("close", (code) => {
				if (code === 0) {
					try {
						const info = JSON.parse(output);
						const videoStream = info.streams?.find((s: any) => s.codec_type === "video");

						if (videoStream) {
							resolve({
								duration: Number.parseFloat(info.format?.duration || "0"),
								width: videoStream.width || 0,
								height: videoStream.height || 0,
								codec: videoStream.codec_name || "unknown",
								bitrate: Number.parseInt(info.format?.bit_rate || "0", 10),
							});
						} else {
							resolve(null);
						}
					} catch (_error) {
						resolve(null);
					}
				} else {
					resolve(null);
				}
			});

			ffprobe.on("error", () => {
				resolve(null);
			});
		});
	}
}
