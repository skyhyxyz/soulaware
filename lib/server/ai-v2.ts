import OpenAI from "openai";
import { env, hasOpenAi } from "@/lib/server/env";
import type {
  ChatHistoryMessage,
  ChatResponseKind,
  ChatSessionState,
  CoachingLens,
  StoredPurposeSnapshot,
} from "@/types/domain";

type DominantIntent =
  | "decision"
  | "career"
  | "purpose"
  | "emotion"
  | "habit"
  | "general";

type EmotionalTone = "uncertain" | "stressed" | "motivated" | "neutral";
type SessionStage = "opening" | "exploring" | "planning" | "accountability";

type SessionProfile = {
  dominantIntent: DominantIntent;
  tone: EmotionalTone;
  stage: SessionStage;
  keywords: string[];
  userMessages: string[];
  assistantMessages: string[];
  totalChars: number;
};

type CoachDraft = {
  reflection: string;
  actionStep: string;
  followUpQuestion: string;
};

type UsageMetrics = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type SummaryDraft = {
  rollingSummary: string;
  userFacts: string[];
  openLoops: string[];
};

type ReplyGeneration = {
  draft: CoachDraft | null;
  usage: UsageMetrics;
  raw: string;
};

export type GenerateCoachReplyV2Params = {
  text: string;
  history: ChatHistoryMessage[];
  latestSnapshot: StoredPurposeSnapshot | null;
  sessionState: ChatSessionState;
};

export type GenerateCoachReplyV2Result = {
  reply: string;
  responseKind: Extract<ChatResponseKind, "clarify" | "coach">;
  lens: CoachingLens;
  modelUsed: string;
  clarifierPending: boolean;
  retryCount: number;
  approximateTokens: number;
  estimatedCostUsd: number;
  summaryUpdated: boolean;
  lowQualityFallback: boolean;
  sessionStatePatch: Partial<Omit<ChatSessionState, "sessionId" | "updatedAt">>;
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "been",
  "by",
  "for",
  "from",
  "have",
  "i",
  "im",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "with",
  "you",
  "your",
]);

const ACTION_VERBS = new Set([
  "build",
  "change",
  "choose",
  "create",
  "decide",
  "define",
  "improve",
  "launch",
  "learn",
  "plan",
  "start",
  "stop",
  "ship",
  "write",
  "schedule",
  "test",
  "practice",
  "apply",
  "move",
  "focus",
]);

const GENERIC_PATTERNS = [
  /what would progress look like/i,
  /trusted yourself/i,
  /meaningful step/i,
  /clarity is already starting/i,
];

const BANNED_QUESTION_PATTERNS = [
  /what would progress look like/i,
  /if you trusted yourself/i,
];

const LENS_BY_INTENT: Record<DominantIntent, CoachingLens[]> = {
  decision: ["decision", "values", "experiment", "accountability"],
  career: ["decision", "blocker", "experiment", "accountability"],
  purpose: ["values", "clarify", "experiment", "decision"],
  emotion: ["clarify", "blocker", "values", "accountability"],
  habit: ["accountability", "experiment", "blocker", "decision"],
  general: ["clarify", "experiment", "values", "decision"],
};

const REFLECTION_OPENERS = [
  "What stands out from what you shared is",
  "The core signal in your message is",
  "A useful read on your situation is",
  "The pattern I notice here is",
];

const STEP_OPENERS = [
  "A concrete next move is",
  "One practical step for today is",
  "To build momentum, do this next",
  "A high-leverage action now is",
];

const QUESTION_OPENERS = [
  "Question to pressure-test this:",
  "Reflect on this next:",
  "One follow-up to sharpen direction:",
  "Check-in question:",
];

let aiClient: OpenAI | null = null;

function getOpenAiClient(): OpenAI | null {
  if (!hasOpenAi) {
    return null;
  }

  if (!aiClient) {
    aiClient = new OpenAI({ apiKey: env.openAiApiKey });
  }

  return aiClient;
}

function toWordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z][a-z'-]{1,}/g)
    ?.map((word) => word.trim())
    .filter(Boolean) ?? [];
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function clip(text: string, max = 220): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function seededIndex(seed: string, size: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash) % size;
}

function lexicalOverlapScore(a: string, b: string): number {
  const wordsA = new Set(
    normalizeForCompare(a)
      .split(" ")
      .filter((word) => word.length >= 4),
  );
  const wordsB = new Set(
    normalizeForCompare(b)
      .split(" ")
      .filter((word) => word.length >= 4),
  );

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(wordsA.size, wordsB.size);
}

function detectIntent(text: string): DominantIntent {
  const value = text.toLowerCase();

  if (/decision|choose|choice|option|tradeoff|stuck between/.test(value)) {
    return "decision";
  }

  if (/career|job|work|resume|interview|promotion|startup/.test(value)) {
    return "career";
  }

  if (/purpose|meaning|mission|calling|direction/.test(value)) {
    return "purpose";
  }

  if (/habit|routine|discipline|consistency|procrastin|focus/.test(value)) {
    return "habit";
  }

  if (/anxious|stress|overwhelm|fear|sad|lost|burnout|tired/.test(value)) {
    return "emotion";
  }

  return "general";
}

function detectTone(text: string): EmotionalTone {
  const value = text.toLowerCase();

  if (/panic|anxious|overwhelm|burnout|can't cope|stressed|drained/.test(value)) {
    return "stressed";
  }

  if (/lost|uncertain|confused|not sure|stuck/.test(value)) {
    return "uncertain";
  }

  if (/ready|committed|motivated|excited|let's do/.test(value)) {
    return "motivated";
  }

  return "neutral";
}

function detectStage(userTurns: number): SessionStage {
  if (userTurns <= 2) {
    return "opening";
  }

  if (userTurns <= 6) {
    return "exploring";
  }

  if (userTurns <= 12) {
    return "planning";
  }

  return "accountability";
}

function extractKeywords(text: string): string[] {
  const frequency = new Map<string, number>();
  for (const token of toWordTokens(text)) {
    if (STOPWORDS.has(token)) {
      continue;
    }

    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

function isLowInformationInput(text: string): boolean {
  const tokens = toWordTokens(text);

  if (tokens.length <= 3) {
    return true;
  }

  const stopwordCount = tokens.filter((token) => STOPWORDS.has(token)).length;
  const stopwordRatio = stopwordCount / Math.max(tokens.length, 1);
  const actionVerbPresent = tokens.some((token) => ACTION_VERBS.has(token));

  if (tokens.length <= 8 && stopwordRatio >= 0.68) {
    return true;
  }

  if (tokens.length <= 6 && !actionVerbPresent) {
    return true;
  }

  return false;
}

function buildSessionProfile(params: {
  history: ChatHistoryMessage[];
  text: string;
}): SessionProfile {
  const userMessages = params.history
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => message.content);

  const assistantMessages = params.history
    .filter((message) => message.role === "assistant" && message.mode === "coach")
    .slice(-4)
    .map((message) => message.content);

  const combined = [...userMessages, params.text].join(" ");
  const totalChars = combined.length + assistantMessages.join(" ").length;

  return {
    dominantIntent: detectIntent(combined),
    tone: detectTone(combined),
    stage: detectStage(userMessages.length),
    keywords: extractKeywords(combined),
    userMessages,
    assistantMessages,
    totalChars,
  };
}

function chooseLens(profile: SessionProfile, previousLens: ChatSessionState["lastLens"], seed: string): CoachingLens {
  const options = [...(LENS_BY_INTENT[profile.dominantIntent] ?? LENS_BY_INTENT.general)];
  if (options.length === 0) {
    return "clarify";
  }

  let selected = options[seededIndex(seed, options.length)];

  if (selected === previousLens && selected !== "clarify") {
    const alternative = options.find((lens) => lens !== previousLens);
    if (alternative) {
      selected = alternative;
    }
  }

  return selected;
}

function complexityScore(profile: SessionProfile, text: string): number {
  let score = 0;
  const tokens = toWordTokens(text);

  if (tokens.length >= 35) score += 2;
  if (profile.stage === "planning" || profile.stage === "accountability") score += 1;
  if (profile.dominantIntent === "decision" || profile.dominantIntent === "purpose") score += 2;
  if (profile.tone === "stressed" || profile.tone === "uncertain") score += 1;
  if (/between|tradeoff|multiple|options|conflict/.test(text.toLowerCase())) score += 2;
  if (profile.totalChars >= 3200) score += 1;

  return score;
}

function pickTopic(text: string, profile: SessionProfile): string {
  const keyword = profile.keywords[0];
  if (keyword) {
    return keyword;
  }

  const tokens = toWordTokens(text);
  return tokens[0] ?? "this";
}

function buildClarifierQuestion(topic: string, intent: DominantIntent): string {
  const prompts: Record<DominantIntent, string> = {
    decision: `When you say "${topic}", what exact decision are you trying to make right now?`,
    career: `For "${topic}", what outcome are you aiming for in your career over the next 30 days?`,
    purpose: `For "${topic}", what feels most meaningful to you right now, and why?`,
    emotion: `When "${topic}" shows up, what is happening in the moment and what feels hardest?`,
    habit: `For "${topic}", what specific habit are you trying to start, stop, or stabilize?`,
    general: `When you say "${topic}", what exactly do you want to change first?`,
  };

  return prompts[intent];
}

function buildAvoidPhraseBlock(messages: string[]): string {
  const fragments: string[] = [];

  for (const message of messages) {
    for (const line of message.split(/\r?\n/)) {
      const cleaned = line.trim().replace(/^[-*]\s*/, "");
      if (!cleaned) {
        continue;
      }

      fragments.push(clip(cleaned, 90));

      if (fragments.length >= 6) {
        break;
      }
    }

    if (fragments.length >= 6) {
      break;
    }
  }

  if (fragments.length === 0) {
    return "";
  }

  return Array.from(new Set(fragments))
    .map((fragment, index) => `${index + 1}. "${fragment}"`)
    .join("\n");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function safeUsageFromCompletion(
  usage:
    | OpenAI.Chat.Completions.ChatCompletion["usage"]
    | undefined,
  fallbackInput: string,
  fallbackOutput: string,
): UsageMetrics {
  if (usage) {
    return {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
    };
  }

  const promptTokens = estimateTokens(fallbackInput);
  const completionTokens = estimateTokens(fallbackOutput);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function estimateCostUsd(model: string, usage: UsageMetrics): number {
  // Approximate pricing for observability; values are intentionally conservative.
  const pricing = model.includes("mini")
    ? { promptPer1k: 0.0008, completionPer1k: 0.0032 }
    : { promptPer1k: 0.005, completionPer1k: 0.015 };

  return Number(
    (
      (usage.promptTokens / 1000) * pricing.promptPer1k +
      (usage.completionTokens / 1000) * pricing.completionPer1k
    ).toFixed(6),
  );
}

function extractJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function parseCoachDraft(raw: string): CoachDraft | null {
  const parsed = extractJson(raw);
  if (parsed) {
    const reflection =
      typeof parsed.reflection === "string" ? parsed.reflection.trim() : "";
    const actionStep =
      typeof parsed.actionStep === "string"
        ? parsed.actionStep.trim()
        : typeof parsed.nextStep === "string"
          ? parsed.nextStep.trim()
          : "";
    const followUpQuestion =
      typeof parsed.followUpQuestion === "string"
        ? parsed.followUpQuestion.trim()
        : typeof parsed.question === "string"
          ? parsed.question.trim()
          : "";

    if (reflection && actionStep && followUpQuestion) {
      return { reflection, actionStep, followUpQuestion };
    }
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const reflectionLine = lines.find((line) => /^reflection:/i.test(line));
  const actionLine = lines.find((line) => /^action/i.test(line));
  const questionLine = lines.find((line) => /^question:/i.test(line) || /question/i.test(line));

  if (!reflectionLine || !actionLine || !questionLine) {
    return null;
  }

  const reflection = reflectionLine.replace(/^reflection:\s*/i, "").trim();
  const actionStep = actionLine.replace(/^action[^:]*:\s*/i, "").trim();
  const followUpQuestion = questionLine.replace(/^question[^:]*:\s*/i, "").trim();

  if (!reflection || !actionStep || !followUpQuestion) {
    return null;
  }

  return { reflection, actionStep, followUpQuestion };
}

function normalizeQuestion(question: string, profile: SessionProfile, keyword: string): string {
  let normalized = question.trim();

  if (!normalized.endsWith("?")) {
    normalized = `${normalized.replace(/[.]+$/, "")}?`;
  }

  if (
    normalized.length < 20 ||
    BANNED_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    const replacements: Record<DominantIntent, string[]> = {
      decision: [
        `Which criterion matters most for your decision on ${keyword}?`,
        `What tradeoff on ${keyword} are you willing to accept today?`,
      ],
      career: [
        `What capability tied to ${keyword} would move your career forward fastest this month?`,
        `What career outcome around ${keyword} would feel like a win in 30 days?`,
      ],
      purpose: [
        `How does ${keyword} connect to the life you actually want to build?`,
        `Where is ${keyword} most aligned with your deeper values?`,
      ],
      emotion: [
        `What support or boundary around ${keyword} would lower pressure this week?`,
        `When ${keyword} feels intense, what helps you regain steadiness fastest?`,
      ],
      habit: [
        `What is the smallest repeatable action around ${keyword} you can commit to daily?`,
        `What trigger can you pair with ${keyword} to make follow-through easier?`,
      ],
      general: [
        `What would be undeniable progress on ${keyword} by this time next week?`,
        `Which first move on ${keyword} can you complete in under 30 minutes?`,
      ],
    };

    const options = replacements[profile.dominantIntent] ?? replacements.general;
    normalized = options[seededIndex(`${keyword}:${profile.stage}`, options.length)];
  }

  return normalized;
}

function formatAdaptiveReply(draft: CoachDraft, seed: string): string {
  const reflectionOpener =
    REFLECTION_OPENERS[seededIndex(`${seed}:r`, REFLECTION_OPENERS.length)];
  const stepOpener = STEP_OPENERS[seededIndex(`${seed}:s`, STEP_OPENERS.length)];
  const questionOpener =
    QUESTION_OPENERS[seededIndex(`${seed}:q`, QUESTION_OPENERS.length)];

  return [
    `${reflectionOpener} ${draft.reflection}`,
    `${stepOpener}: ${draft.actionStep}`,
    `${questionOpener} ${draft.followUpQuestion}`,
  ].join("\n\n");
}

function isLowQualityReply(candidate: string, assistantMessages: string[]): boolean {
  if (GENERIC_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return true;
  }

  const normalizedCandidate = normalizeForCompare(candidate);

  for (const previous of assistantMessages.slice(-3)) {
    const normalizedPrevious = normalizeForCompare(previous);
    if (!normalizedPrevious) {
      continue;
    }

    if (normalizedPrevious === normalizedCandidate) {
      return true;
    }

    if (lexicalOverlapScore(candidate, previous) >= 0.7) {
      return true;
    }
  }

  return false;
}

async function generateDraftWithModel(params: {
  client: OpenAI;
  model: string;
  profile: SessionProfile;
  lens: CoachingLens;
  latestSnapshot: StoredPurposeSnapshot | null;
  rollingSummary: string;
  userFacts: string[];
  openLoops: string[];
  inputText: string;
  avoidPhrases: string;
  forceVariation: boolean;
  previousCandidate?: string;
}): Promise<ReplyGeneration> {
  const contextLines = [
    `Intent: ${params.profile.dominantIntent}`,
    `Tone: ${params.profile.tone}`,
    `Stage: ${params.profile.stage}`,
    `Lens: ${params.lens}`,
    `Rolling summary: ${params.rollingSummary || "none"}`,
    `User facts: ${params.userFacts.join(" | ") || "none"}`,
    `Open loops: ${params.openLoops.join(" | ") || "none"}`,
    `Keywords: ${params.profile.keywords.join(", ") || "none"}`,
    "Recent user turns:",
    ...params.profile.userMessages.map((message, index) => `U${index + 1}: ${clip(message, 220)}`),
    "Recent assistant turns:",
    ...params.profile.assistantMessages
      .slice(-4)
      .map((message, index) => `A${index + 1}: ${clip(message, 220)}`),
    "Latest purpose snapshot:",
    params.latestSnapshot
      ? `Mission=${params.latestSnapshot.mission}; Values=${params.latestSnapshot.values.join(", ")}; NextActions=${params.latestSnapshot.nextActions.join(" | ")}`
      : "none",
    `Current user message: ${params.inputText}`,
  ];

  if (params.avoidPhrases) {
    contextLines.push("Avoid reusing these phrases:", params.avoidPhrases);
  }

  if (params.forceVariation && params.previousCandidate) {
    contextLines.push("Previous repetitive draft to avoid:", params.previousCandidate);
  }

  const userMessage = contextLines.join("\n");

  const systemPrompt = [
    "You are Soulaware, an elite AI coaching guide for life, career, and purpose clarity.",
    "Do not use therapy diagnosis language.",
    "Write adaptive, specific coaching that sounds human and contextual, not templated.",
    "Never ask generic questions.",
    "Return strict JSON with keys reflection, actionStep, followUpQuestion.",
    "Each field must be concise, specific, and grounded in current user context.",
    params.forceVariation
      ? "This is a retry for similarity. Produce a materially different angle and question."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const completion = await params.client.chat.completions.create({
    model: params.model,
    temperature: params.forceVariation ? 0.95 : 0.82,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const draft = parseCoachDraft(raw);
  const usage = safeUsageFromCompletion(completion.usage, userMessage, raw);

  return { draft, raw, usage };
}

async function summarizeSessionState(params: {
  client: OpenAI;
  summaryModel: string;
  profile: SessionProfile;
  currentSummary: string;
  currentFacts: string[];
  currentLoops: string[];
  latestSnapshot: StoredPurposeSnapshot | null;
}): Promise<{ summary: SummaryDraft; usage: UsageMetrics }> {
  const userContext = params.profile.userMessages
    .slice(-8)
    .map((entry, index) => `U${index + 1}: ${clip(entry, 260)}`)
    .join("\n");

  const input = [
    `Current rolling summary: ${params.currentSummary || "none"}`,
    `Current facts: ${params.currentFacts.join(" | ") || "none"}`,
    `Current open loops: ${params.currentLoops.join(" | ") || "none"}`,
    `Recent user messages:\n${userContext || "none"}`,
    `Latest snapshot: ${
      params.latestSnapshot
        ? `${params.latestSnapshot.mission}; ${params.latestSnapshot.values.join(", ")}`
        : "none"
    }`,
  ].join("\n\n");

  try {
    const completion = await params.client.chat.completions.create({
      model: params.summaryModel,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Summarize coaching memory for continuity.",
            "Return strict JSON with keys rollingSummary, userFacts, openLoops.",
            "rollingSummary must be <= 80 words.",
            "userFacts must be 3-8 concise stable facts.",
            "openLoops must be 1-6 unresolved decisions/tasks.",
          ].join(" "),
        },
        { role: "user", content: input },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJson(raw);

    if (parsed) {
      const rollingSummary =
        typeof parsed.rollingSummary === "string"
          ? parsed.rollingSummary.trim()
          : params.currentSummary;
      const userFacts = Array.isArray(parsed.userFacts)
        ? parsed.userFacts.filter((entry): entry is string => typeof entry === "string")
        : params.currentFacts;
      const openLoops = Array.isArray(parsed.openLoops)
        ? parsed.openLoops.filter((entry): entry is string => typeof entry === "string")
        : params.currentLoops;

      const usage = safeUsageFromCompletion(completion.usage, input, raw);

      return {
        summary: {
          rollingSummary: rollingSummary || params.currentSummary,
          userFacts: userFacts.map((entry) => clip(entry.trim(), 120)).filter(Boolean).slice(0, 8),
          openLoops: openLoops.map((entry) => clip(entry.trim(), 130)).filter(Boolean).slice(0, 6),
        },
        usage,
      };
    }
  } catch {
    // fallback below
  }

  const fallbackFacts = Array.from(new Set(params.profile.keywords.slice(0, 5))).map(
    (keyword) => `User repeatedly referenced ${keyword}.`,
  );

  const summary: SummaryDraft = {
    rollingSummary:
      params.profile.userMessages.length > 0
        ? `User is currently focused on ${params.profile.keywords.slice(0, 3).join(", ") || "core direction"}, with a ${params.profile.tone} tone in the ${params.profile.stage} stage.`
        : params.currentSummary,
    userFacts: fallbackFacts.length > 0 ? fallbackFacts : params.currentFacts,
    openLoops:
      params.currentLoops.length > 0
        ? params.currentLoops
        : [`Clarify the next concrete step on ${params.profile.keywords[0] ?? "current goal"}.`],
  };

  const fallbackUsage = {
    promptTokens: estimateTokens(input),
    completionTokens: estimateTokens(summary.rollingSummary + summary.userFacts.join(" ") + summary.openLoops.join(" ")),
    totalTokens:
      estimateTokens(input) +
      estimateTokens(summary.rollingSummary + summary.userFacts.join(" ") + summary.openLoops.join(" ")),
  };

  return { summary, usage: fallbackUsage };
}

function deterministicFallbackReply(params: {
  profile: SessionProfile;
  lens: CoachingLens;
  text: string;
}): CoachDraft {
  const keyword = params.profile.keywords[0] ?? pickTopic(params.text, params.profile);

  const reflection = `${REFLECTION_OPENERS[seededIndex(params.text, REFLECTION_OPENERS.length)]} your focus on ${keyword} is the right anchor for this turn.`;
  const actionsByLens: Record<CoachingLens, string> = {
    clarify: `Write one sentence defining what success on ${keyword} means by next week, then remove one distraction that does not support it.`,
    blocker: `Identify the single largest blocker on ${keyword} and shrink it into a 20-minute task you can complete today.`,
    values: `List your top three values and pick the option on ${keyword} that best matches them, even if it is less comfortable.`,
    experiment: `Run a 48-hour experiment on ${keyword} with one measurable metric so you can learn quickly.`,
    decision: `Define three criteria for this ${keyword} decision, score each option, and commit to one next move.`,
    accountability: `Set a 7-day commitment for ${keyword}, include one measurable milestone, and schedule a check-in.`,
  };

  return {
    reflection,
    actionStep: actionsByLens[params.lens],
    followUpQuestion: normalizeQuestion(
      `What is the first concrete move on ${keyword} you can complete in the next 24 hours?`,
      params.profile,
      keyword,
    ),
  };
}

export async function generateCoachReplyV2(
  params: GenerateCoachReplyV2Params,
): Promise<GenerateCoachReplyV2Result> {
  const client = getOpenAiClient();
  const profile = buildSessionProfile({ history: params.history, text: params.text });
  const topic = pickTopic(params.text, profile);
  const initialLens = chooseLens(
    profile,
    params.sessionState.lastLens,
    `${params.text}:${params.sessionState.lastLens}:${profile.stage}:${profile.dominantIntent}`,
  );
  const fastModel = env.openAiChatModelFast;
  const primaryModel = env.openAiChatModelPrimary;

  if (isLowInformationInput(params.text) && !params.sessionState.pendingClarifier) {
    return {
      reply: buildClarifierQuestion(topic, profile.dominantIntent),
      responseKind: "clarify",
      lens: "clarify",
      modelUsed: fastModel,
      clarifierPending: true,
      retryCount: 0,
      approximateTokens: 0,
      estimatedCostUsd: 0,
      summaryUpdated: false,
      lowQualityFallback: false,
      sessionStatePatch: {
        pendingClarifier: true,
        clarifierTopic: topic,
        lastLens: "clarify",
        lastModel: fastModel,
      },
    };
  }

  const mergedInput = params.sessionState.pendingClarifier
    ? `${params.sessionState.clarifierTopic}. ${params.text}`.trim()
    : params.text;
  const score = complexityScore(profile, mergedInput);
  const selectedModel = score >= 4 ? primaryModel : fastModel;
  const avoidPhrases = buildAvoidPhraseBlock(profile.assistantMessages);

  let retryCount = 0;
  let lowQualityFallback = false;
  let usageAccumulator: UsageMetrics = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  let estimatedCostUsd = 0;

  const addUsage = (model: string, usage: UsageMetrics) => {
    usageAccumulator = {
      promptTokens: usageAccumulator.promptTokens + usage.promptTokens,
      completionTokens: usageAccumulator.completionTokens + usage.completionTokens,
      totalTokens: usageAccumulator.totalTokens + usage.totalTokens,
    };
    estimatedCostUsd += estimateCostUsd(model, usage);
  };

  let finalDraft: CoachDraft | null = null;

  if (client) {
    try {
      const first = await generateDraftWithModel({
        client,
        model: selectedModel,
        profile,
        lens: initialLens,
        latestSnapshot: params.latestSnapshot,
        rollingSummary: params.sessionState.rollingSummary,
        userFacts: params.sessionState.userFacts,
        openLoops: params.sessionState.openLoops,
        inputText: mergedInput,
        avoidPhrases,
        forceVariation: false,
      });

      addUsage(selectedModel, first.usage);

      if (first.draft) {
        const keyword = profile.keywords[0] ?? topic;
        first.draft.followUpQuestion = normalizeQuestion(
          first.draft.followUpQuestion,
          profile,
          keyword,
        );

        const candidate = formatAdaptiveReply(
          first.draft,
          `${mergedInput}:${initialLens}:${selectedModel}:v1`,
        );

        if (!isLowQualityReply(candidate, profile.assistantMessages)) {
          finalDraft = first.draft;
        } else {
          retryCount = 1;
          const retry = await generateDraftWithModel({
            client,
            model: selectedModel,
            profile,
            lens: initialLens,
            latestSnapshot: params.latestSnapshot,
            rollingSummary: params.sessionState.rollingSummary,
            userFacts: params.sessionState.userFacts,
            openLoops: params.sessionState.openLoops,
            inputText: mergedInput,
            avoidPhrases,
            forceVariation: true,
            previousCandidate: candidate,
          });

          addUsage(selectedModel, retry.usage);

          if (retry.draft) {
            retry.draft.followUpQuestion = normalizeQuestion(
              retry.draft.followUpQuestion,
              profile,
              keyword,
            );
            const retryCandidate = formatAdaptiveReply(
              retry.draft,
              `${mergedInput}:${initialLens}:${selectedModel}:retry`,
            );

            if (!isLowQualityReply(retryCandidate, profile.assistantMessages)) {
              finalDraft = retry.draft;
            }
          }
        }
      }
    } catch {
      // fallback below
    }
  }

  if (!finalDraft) {
    finalDraft = deterministicFallbackReply({
      profile,
      lens: initialLens,
      text: mergedInput,
    });
    lowQualityFallback = true;
  }

  const reply = formatAdaptiveReply(
    finalDraft,
    `${mergedInput}:${initialLens}:${profile.stage}:${profile.dominantIntent}`,
  );

  let summaryUpdated = false;
  const nextStatePatch: GenerateCoachReplyV2Result["sessionStatePatch"] = {
    pendingClarifier: false,
    clarifierTopic: "",
    lastLens: initialLens,
    lastModel: selectedModel,
  };

  const shouldUpdateSummary =
    profile.userMessages.length > 0 &&
    (profile.userMessages.length % 4 === 0 || profile.totalChars >= 5000);

  if (client && shouldUpdateSummary) {
    const summary = await summarizeSessionState({
      client,
      summaryModel: env.openAiSummaryModel,
      profile,
      currentSummary: params.sessionState.rollingSummary,
      currentFacts: params.sessionState.userFacts,
      currentLoops: params.sessionState.openLoops,
      latestSnapshot: params.latestSnapshot,
    });

    nextStatePatch.rollingSummary = summary.summary.rollingSummary;
    nextStatePatch.userFacts = summary.summary.userFacts;
    nextStatePatch.openLoops = summary.summary.openLoops;
    addUsage(env.openAiSummaryModel, summary.usage);
    summaryUpdated = true;
  }

  return {
    reply,
    responseKind: "coach",
    lens: initialLens,
    modelUsed: selectedModel,
    clarifierPending: false,
    retryCount,
    approximateTokens: usageAccumulator.totalTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    summaryUpdated,
    lowQualityFallback,
    sessionStatePatch: nextStatePatch,
  };
}
