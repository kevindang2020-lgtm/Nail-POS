// POSAIVoiceTranscriptionHistoryScreen.tsx — AI Center → AI Voice Transcription → Call History. The original title, Status and Direction
// filters stay; behind them is the shared calls workspace (Voice Transcription Call History guide, Nov 3 2026): newest first, the
// server's branch, search, more filters, which date, From/To calendars, numbered pages, an empty state that says WHY, the details
// overlay and Check Voice Transcription System.
import { VoiceCallsWorkspace } from './VoiceCallsWorkspace';

export function POSAIVoiceTranscriptionHistoryScreen() {
  return <VoiceCallsWorkspace mode="history" />;
}
