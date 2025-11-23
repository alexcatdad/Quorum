export { TeamsRecorder } from "./workers/teams";
export { SlackRecorder } from "./workers/slack";
export { YouTubeRecorder } from "./workers/youtube";
export type {
	RecordingConfig,
	RecordingResult,
	PlatformCredentials,
	Participant,
	ParticipantEvent,
	ParticipantUpdateCallback,
} from "./types";
