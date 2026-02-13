export type PromptMode = "coach" | "safety";

export type SafetyLevel = "none" | "elevated" | "high";

export type ChatRole = "user" | "assistant";

export type ChatMessageRequest = {
  text: string;
};

export type ChatMessageResponse = {
  reply: string;
  mode: PromptMode;
  messageId: string;
  safetyTriggered: boolean;
};

export type ChatHistoryMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  mode: PromptMode;
};

export type ChatHistoryResponse = {
  sessionId: string;
  messages: ChatHistoryMessage[];
};

export type PurposeSnapshotRequest = {
  contextWindow?: number;
};

export type PurposeSnapshotResponse = {
  snapshotId: string;
  mission: string;
  values: string[];
  nextActions: string[];
};

export type SafetyEvent = {
  id: string;
  guestId: string;
  level: SafetyLevel;
  triggerText: string;
  createdAt: string;
};

export type GuestSession = {
  id: string;
  guestId: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredChatMessage = {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  mode: PromptMode;
  createdAt: string;
};

export type StoredPurposeSnapshot = {
  id: string;
  sessionId: string;
  mission: string;
  values: string[];
  nextActions: string[];
  createdAt: string;
};

export type AnalyticsEventName =
  | "session_started"
  | "message_sent"
  | "snapshot_created"
  | "safety_triggered"
  | "returned_within_7d";

export type AnalyticsEvent = {
  id: string;
  guestId: string;
  eventName: AnalyticsEventName;
  metadata: Record<string, unknown>;
  createdAt: string;
};
