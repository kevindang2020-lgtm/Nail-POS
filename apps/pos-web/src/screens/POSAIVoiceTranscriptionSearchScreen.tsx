// POSAIVoiceTranscriptionSearchScreen.tsx — AI Center → AI Voice Transcription → Search. The original title, privacy line, search box
// and "Enter a search term to find calls." stay; behind them is the shared calls workspace (Voice Transcription Search guide, Nov 3 2026):
// redacted search over transcript / summary / intent / call ID (+ customer name and phone with customers.view), filters, which date,
// From/To calendars, numbered pages, the details overlay and Check Voice Transcription System. Raw text is never searched or shown.
import { VoiceCallsWorkspace } from './VoiceCallsWorkspace';

export function POSAIVoiceTranscriptionSearchScreen() {
  return <VoiceCallsWorkspace mode="search" />;
}
