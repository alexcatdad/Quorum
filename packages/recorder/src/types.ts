export interface RecordingConfig {
	meetingUrl: string;
	outputPath: string;
	duration?: number; // Maximum recording duration in seconds
	width?: number;
	height?: number;
	trackParticipants?: boolean; // Enable participant tracking
	participantPollInterval?: number; // How often to poll for participants (ms)
}

export interface Participant {
	id?: string;
	name: string;
	email?: string;
	avatar?: string;
	joinedAt?: string;
	leftAt?: string;
	isMuted?: boolean;
	isVideoOn?: boolean;
	isPresenting?: boolean;
	isSpeaking?: boolean;
	role?: "host" | "presenter" | "attendee" | "guest";
}

export interface ParticipantEvent {
	type:
		| "joined"
		| "left"
		| "speaking_start"
		| "speaking_end"
		| "muted"
		| "unmuted"
		| "video_on"
		| "video_off"
		| "presenting_start"
		| "presenting_end";
	participant: Participant;
	timestamp: string;
}

export interface RecordingResult {
	success: boolean;
	filePath?: string;
	fileSize?: number;
	duration?: number;
	harPath?: string;
	error?: string;
	participants?: Participant[];
	participantEvents?: ParticipantEvent[];
	meetingTitle?: string;
	hostName?: string;
}

export interface PlatformCredentials {
	username: string;
	password: string;
	[key: string]: any; // Platform-specific fields
}

// Callback for real-time participant updates
export type ParticipantUpdateCallback = (
	participants: Participant[],
	event?: ParticipantEvent,
) => void;
