export interface RecordingConfig {
	meetingUrl: string;
	outputPath: string;
	duration?: number; // Maximum recording duration in seconds
	width?: number;
	height?: number;
}

export interface RecordingResult {
	success: boolean;
	filePath?: string;
	fileSize?: number;
	duration?: number;
	harPath?: string;
	error?: string;
}

export interface PlatformCredentials {
	username: string;
	password: string;
	[key: string]: any; // Platform-specific fields
}
