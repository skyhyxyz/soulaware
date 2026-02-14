import OpenAI from "openai";
import { env, hasOpenAi } from "@/lib/server/env";
import type { ChatHistoryMessage, StoredPurposeSnapshot } from "@/types/domain";

type CoachReply = {
  reflection: string;
  actionStep: string;
  deeperQuestion: string;
};

type PurposeSnapshotDraft = {
  mission: string;
  values: string[];
  nextActions: string[];
};

type SessionStage = "opening" | "exploring" | "planning" | "accountability";

type DominantIntent =
  | "decision"
  | "career"
  | "purpose"
  | "emotion"
  | "habit"
  | "general";

type EmotionalTone = "uncertain" | "stressed" | "motivated" | "neutral";

type CoachingLens =
  | "clarify"
  | "blocker"
  | "values"
  | "experiment"
  | "decision"
  | "accountability";

type SessionProfile = {
  recentUserMessages: string[];
  recentAssistantMessages: string[];
  topKeywords: string[];
  dominantIntent: DominantIntent;
  stage: SessionStage;
  tone: EmotionalTone;
};

const STOPWORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "almost",
  "also",
  "always",
  "and",
  "any",
  "are",
  "around",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "could",
  "doing",
  "done",
  "each",
  "else",
  "even",
  "ever",
  "feel",
  "feeling",
  "from",
  "have",
  "having",
  "into",
  "just",
  "kind",
  "know",
  "like",
  "little",
  "long",
  "made",
  "make",
  "maybe",
  "more",
  "most",
  "much",
  "need",
  "other",
  "really",
  "same",
  "some",
  "still",
  "that",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "today",
  "want",
  "week",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
  "you",
  "i",
  "im",
  "ive",
  "me",
  "my",
]);

const GENERIC_PATTERNS = [
  /you are taking a meaningful step/i,
  /clarity is already starting/i,
  /trusted yourself 10%/i,
  /what would progress look like/i,
  /meaningful step toward change/i,
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

function truncate(value: string, size: number): string {
  if (value.length <= size) {
    return value;
  }

  return `${value.slice(0, size)}...`;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
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

function normalizeTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const firstString = value.find((entry): entry is string => typeof entry === "string");
    return firstString?.trim() ?? "";
  }

  return "";
}

function pickString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (key in data) {
      const value = normalizeTextValue(data[key]);

      if (value) {
        return value;
      }
    }
  }

  return "";
}

function pickStringArray(data: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    if (!(key in data)) {
      continue;
    }

    const value = data[key];

    if (Array.isArray(value)) {
      const filtered = value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (filtered.length > 0) {
        return filtered;
      }
    }

    if (typeof value === "string") {
      const split = value
        .split(/\n|\||,/)
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (split.length > 0) {
        return split;
      }
    }
  }

  return [];
}

function parseLabeledCoachReply(raw: string): CoachReply | null {
  const sections: CoachReply = {
    reflection: "",
    actionStep: "",
    deeperQuestion: "",
  };

  let current: keyof CoachReply | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.replace(/^[-*]\s*/, "");

    if (/^reflection\s*:/i.test(normalized)) {
      current = "reflection";
      sections.reflection = normalized.replace(/^reflection\s*:/i, "").trim();
      continue;
    }

    if (/^action\s*step\s*:/i.test(normalized) || /^next\s*step\s*:/i.test(normalized)) {
      current = "actionStep";
      sections.actionStep = normalized
        .replace(/^action\s*step\s*:/i, "")
        .replace(/^next\s*step\s*:/i, "")
        .trim();
      continue;
    }

    if (
      /^deeper\s*question\s*:/i.test(normalized) ||
      /^question\s*:/i.test(normalized)
    ) {
      current = "deeperQuestion";
      sections.deeperQuestion = normalized
        .replace(/^deeper\s*question\s*:/i, "")
        .replace(/^question\s*:/i, "")
        .trim();
      continue;
    }

    if (current) {
      sections[current] = `${sections[current]} ${normalized}`.trim();
    }
  }

  if (!sections.reflection || !sections.actionStep || !sections.deeperQuestion) {
    return null;
  }

  return sections;
}

function normalizeCoachReply(data: Record<string, unknown> | null): CoachReply | null {
  if (!data) {
    return null;
  }

  const reflection = pickString(data, ["reflection", "insight", "mirror", "summary"]);
  const actionStep = pickString(data, [
    "actionStep",
    "action_step",
    "nextAction",
    "next_action",
    "action",
  ]);
  const deeperQuestion = pickString(data, [
    "deeperQuestion",
    "deeper_question",
    "question",
    "nextQuestion",
    "next_question",
  ]);

  if (!reflection || !actionStep || !deeperQuestion) {
    return null;
  }

  return {
    reflection,
    actionStep,
    deeperQuestion,
  };
}

function normalizeSnapshot(data: Record<string, unknown> | null): PurposeSnapshotDraft | null {
  if (!data) {
    return null;
  }

  const mission = pickString(data, ["mission", "missionStatement", "mission_statement"]);
  const values = pickStringArray(data, ["values", "coreValues", "core_values"]);
  const nextActions = pickStringArray(data, ["nextActions", "next_actions", "actions"]);

  if (!mission || values.length === 0 || nextActions.length === 0) {
    return null;
  }

  return {
    mission,
    values: values.slice(0, 5),
    nextActions: nextActions.slice(0, 3),
  };
}

function fillValues(values: string[]): string[] {
  const fallback = ["Growth", "Integrity", "Contribution", "Connection", "Courage"];
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

  for (const value of fallback) {
    if (unique.length >= 5) {
      break;
    }

    if (!unique.includes(value)) {
      unique.push(value);
    }
  }

  return unique.slice(0, 5);
}

function fillActions(actions: string[]): string[] {
  const fallback = [
    "Write a 10-minute reflection on what gives you energy this week.",
    "Schedule one focused 30-minute block for your most meaningful priority.",
    "Share one goal with a trusted person for accountability.",
  ];

  const cleaned = Array.from(new Set(actions.map((action) => action.trim()).filter(Boolean)));

  for (const action of fallback) {
    if (cleaned.length >= 3) {
      break;
    }

    if (!cleaned.includes(action)) {
      cleaned.push(action);
    }
  }

  return cleaned.slice(0, 3);
}

function seededIndex(seedText: string, size: number): number {
  let hash = 0;

  for (let index = 0; index < seedText.length; index += 1) {
    hash = (hash << 5) - hash + seedText.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash) % size;
}

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/^reflection\s*:/gim, "")
    .replace(/^action\s*step\s*:/gim, "")
    .replace(/^deeper\s*question\s*:/gim, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lexicalOverlapScore(a: string, b: string): number {
  const wordsA = new Set(
    normalizeForComparison(a)
      .split(" ")
      .map((word) => word.trim())
      .filter((word) => word.length >= 4),
  );
  const wordsB = new Set(
    normalizeForComparison(b)
      .split(" ")
      .map((word) => word.trim())
      .filter((word) => word.length >= 4),
  );

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersection += 1;
    }
  }

  return intersection / Math.min(wordsA.size, wordsB.size);
}

function flattenCoachReply(reply: CoachReply): string {
  return `${reply.reflection} ${reply.actionStep} ${reply.deeperQuestion}`;
}

function stripCoachLabel(value: string): string {
  return value
    .replace(/^reflection\s*:/i, "")
    .replace(/^action\s*step\s*:/i, "")
    .replace(/^deeper\s*question\s*:/i, "")
    .trim();
}

function tokenizeKeywords(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  return matches.filter((word) => !STOPWORDS.has(word));
}

function detectDominantIntent(text: string): DominantIntent {
  const lower = text.toLowerCase();

  if (/career|job|work|resume|interview|promotion|business|startup/.test(lower)) {
    return "career";
  }

  if (/purpose|meaning|mission|calling|fulfill|direction/.test(lower)) {
    return "purpose";
  }

  if (/decide|choice|choose|option|stuck between|which path/.test(lower)) {
    return "decision";
  }

  if (/habit|routine|discipline|consisten|procrastin|focus/.test(lower)) {
    return "habit";
  }

  if (/lost|anxious|overwhelm|sad|fear|afraid|stress|hopeless|tired/.test(lower)) {
    return "emotion";
  }

  return "general";
}

function detectTone(text: string): EmotionalTone {
  const lower = text.toLowerCase();

  if (/overwhelm|panic|burnout|exhaust|can't|cannot cope|anxious|stress/.test(lower)) {
    return "stressed";
  }

  if (/lost|uncertain|confused|not sure|stuck/.test(lower)) {
    return "uncertain";
  }

  if (/ready|excited|committed|motivated|take action|let's do/.test(lower)) {
    return "motivated";
  }

  return "neutral";
}

function detectStage(userMessageCount: number): SessionStage {
  if (userMessageCount <= 1) {
    return "opening";
  }

  if (userMessageCount <= 3) {
    return "exploring";
  }

  if (userMessageCount <= 6) {
    return "planning";
  }

  return "accountability";
}

function listRecentAssistantCoachTexts(
  history: ChatHistoryMessage[],
  limit: number,
): string[] {
  return history
    .filter((message) => message.role === "assistant" && message.mode === "coach")
    .slice(-limit)
    .map((message) => message.content);
}

function buildSessionProfile(history: ChatHistoryMessage[], currentText: string): SessionProfile {
  const recentUserMessages = history
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => message.content);

  const recentAssistantMessages = listRecentAssistantCoachTexts(history, 3);
  const aggregateText = [...recentUserMessages, currentText].join(" ");
  const keywords = tokenizeKeywords(aggregateText);

  const frequency = new Map<string, number>();
  for (const word of keywords) {
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }

  const topKeywords = Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word);

  return {
    recentUserMessages,
    recentAssistantMessages,
    topKeywords,
    dominantIntent: detectDominantIntent(aggregateText),
    stage: detectStage(recentUserMessages.length),
    tone: detectTone(aggregateText),
  };
}

function chooseCoachingLens(profile: SessionProfile, text: string): CoachingLens {
  if (profile.stage === "opening") {
    return "clarify";
  }

  const byIntent: Record<DominantIntent, CoachingLens[]> = {
    decision: ["decision", "values", "experiment"],
    career: ["decision", "blocker", "experiment"],
    purpose: ["values", "clarify", "experiment"],
    emotion: ["clarify", "blocker", "accountability"],
    habit: ["accountability", "experiment", "blocker"],
    general: ["clarify", "experiment", "values"],
  };

  const options = byIntent[profile.dominantIntent] ?? ["clarify", "experiment"];
  return options[seededIndex(`${text}:${profile.stage}:${profile.tone}`, options.length)];
}

function lensInstruction(lens: CoachingLens): string {
  const instructions: Record<CoachingLens, string> = {
    clarify: "Focus on clarifying what the user actually wants in concrete terms.",
    blocker: "Focus on identifying the biggest blocker and one way to remove friction.",
    values: "Focus on alignment between choices and personal values.",
    experiment: "Focus on a small, low-risk experiment the user can run in 24-72 hours.",
    decision: "Focus on decision quality: tradeoffs, criteria, and next decision step.",
    accountability: "Focus on follow-through, commitments, and measurable progress.",
  };

  return instructions[lens];
}

function buildAvoidPhraseBlock(profile: SessionProfile): string {
  const phrases: string[] = [];

  for (const text of profile.recentAssistantMessages) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = stripCoachLabel(rawLine);
      if (!line) {
        continue;
      }

      phrases.push(truncate(line, 90));

      if (phrases.length >= 8) {
        break;
      }
    }

    if (phrases.length >= 8) {
      break;
    }
  }

  if (phrases.length === 0) {
    return "";
  }

  const unique = Array.from(new Set(phrases));
  return unique.map((phrase, index) => `${index + 1}. "${phrase}"`).join("\n");
}

function formatConversationContext(profile: SessionProfile): string {
  if (profile.recentUserMessages.length === 0) {
    return "No previous user messages.";
  }

  return profile.recentUserMessages
    .map((message, index) => `USER_${index + 1}: ${truncate(message, 220)}`)
    .join("\n");
}

function formatSnapshotContext(snapshot: StoredPurposeSnapshot | null): string {
  if (!snapshot) {
    return "No previous purpose snapshot available.";
  }

  return [
    `Mission: ${snapshot.mission}`,
    `Values: ${snapshot.values.join(", ")}`,
    `Next actions: ${snapshot.nextActions.join(" | ")}`,
  ].join("\n");
}

function buildSessionProfileBlock(profile: SessionProfile): string {
  return [
    `Intent: ${profile.dominantIntent}`,
    `Stage: ${profile.stage}`,
    `Tone: ${profile.tone}`,
    `Top keywords: ${profile.topKeywords.join(", ") || "none"}`,
  ].join("\n");
}

function isReplyTooSimilarToRecent(reply: CoachReply, history: ChatHistoryMessage[]): boolean {
  const candidate = flattenCoachReply(reply);
  const candidateNormalized = normalizeForComparison(candidate);
  const recentAssistantTexts = listRecentAssistantCoachTexts(history, 3);

  if (GENERIC_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return true;
  }

  for (const previous of recentAssistantTexts) {
    const previousNormalized = normalizeForComparison(previous);

    if (!previousNormalized) {
      continue;
    }

    if (candidateNormalized === previousNormalized) {
      return true;
    }

    const overlap = lexicalOverlapScore(candidate, previous);
    if (overlap >= 0.68) {
      return true;
    }
  }

  return false;
}

function containsKeyword(text: string, keyword: string): boolean {
  return normalizeForComparison(text).includes(normalizeForComparison(keyword));
}

function defaultQuestionForIntent(profile: SessionProfile, userText: string): string {
  const keyword = profile.topKeywords[0] ?? tokenizeKeywords(userText)[0] ?? "this";

  const options: Record<DominantIntent, string[]> = {
    decision: [
      `Which criterion matters most to you when choosing around ${keyword}?`,
      `What tradeoff are you willing to accept in this decision about ${keyword}?`,
    ],
    career: [
      `Which career move around ${keyword} would make you proud six months from now?`,
      `What capability related to ${keyword} should you build first this week?`,
    ],
    purpose: [
      `What part of ${keyword} feels most aligned with who you want to become?`,
      `Where does ${keyword} connect with contribution, not just achievement?`,
    ],
    emotion: [
      `What boundary around ${keyword} would lower stress this week?`,
      `When ${keyword} shows up, what helps you regain steadiness fastest?`,
    ],
    habit: [
      `What is the smallest repeatable action around ${keyword} you can do daily?`,
      `What trigger can you pair with ${keyword} so follow-through becomes automatic?`,
    ],
    general: [
      `What would a good first move around ${keyword} look like in the next 24 hours?`,
      `What would make progress on ${keyword} undeniable by next week?`,
    ],
  };

  const choices = options[profile.dominantIntent] ?? options.general;
  return choices[seededIndex(`${userText}:${keyword}:${profile.stage}`, choices.length)];
}

function postProcessCoachReply(
  reply: CoachReply,
  profile: SessionProfile,
  userText: string,
): CoachReply {
  const keyword = profile.topKeywords[0] ?? tokenizeKeywords(userText)[0] ?? "your goal";

  const reflection = truncate(reply.reflection.trim(), 240);
  let actionStep = truncate(reply.actionStep.trim(), 280);
  let deeperQuestion = truncate(reply.deeperQuestion.trim(), 220);

  if (!containsKeyword(actionStep, keyword)) {
    actionStep = `${actionStep} Start with one concrete move on ${keyword} within 24 hours.`;
  }

  if (!deeperQuestion.endsWith("?")) {
    deeperQuestion = `${deeperQuestion.replace(/[.]+$/, "")}?`;
  }

  if (deeperQuestion.length < 25 || /what would progress look like/i.test(deeperQuestion)) {
    deeperQuestion = defaultQuestionForIntent(profile, userText);
  }

  return {
    reflection,
    actionStep,
    deeperQuestion,
  };
}

function fallbackCoachReply(
  input: string,
  history: ChatHistoryMessage[],
  profile: SessionProfile,
): CoachReply {
  const seed = `${input}|${history.length}|${profile.stage}|${profile.dominantIntent}`;
  const keyword = profile.topKeywords[0] ?? tokenizeKeywords(input)[0] ?? "this area";

  const reflectionsByTone: Record<EmotionalTone, string[]> = {
    stressed: [
      "You are carrying a lot right now, and naming it is a strong step toward control.",
      "This sounds heavy, and your willingness to face it directly matters.",
    ],
    uncertain: [
      "You are in the uncertainty phase, which is often where real clarity starts.",
      "Being honest about not knowing yet is the right foundation for better choices.",
    ],
    motivated: [
      "You already have momentum, and this is a good moment to convert it into execution.",
      "Your energy is usable right now, so we should direct it into one sharp move.",
    ],
    neutral: [
      "You are paying attention to something important, which creates room for change.",
      "This is a useful checkpoint, and we can turn it into a clear next move.",
    ],
  };

  const actionByLens: Record<CoachingLens, string[]> = {
    clarify: [
      `Write three lines: what success on ${keyword} means, why it matters, and what happens if you delay another month.`,
      `Create a one-sentence goal for ${keyword} and remove anything not directly supporting it this week.`,
    ],
    blocker: [
      `List the top two blockers around ${keyword}, then design one friction-reducing step for each today.`,
      `Pick the hardest obstacle around ${keyword} and shrink it into a 20-minute task you can do now.`,
    ],
    values: [
      `Rank your top three values and check whether your current approach to ${keyword} matches them.`,
      `Make one decision on ${keyword} that favors long-term alignment over short-term comfort.`,
    ],
    experiment: [
      `Run a 48-hour experiment on ${keyword}: one small behavior change and one observable metric.`,
      `Choose one low-risk test related to ${keyword} and schedule it in your calendar today.`,
    ],
    decision: [
      `Define three decision criteria for ${keyword}, score each option, and commit to the highest score.`,
      `Write the top tradeoff in your ${keyword} decision and choose based on what you value most.`,
    ],
    accountability: [
      `Set a 7-day commitment on ${keyword}, add a check-in date, and report progress to one trusted person.`,
      `Pick one measurable milestone on ${keyword} and track it daily for the next week.`,
    ],
  };

  const lens = chooseCoachingLens(profile, input);
  const reflections = reflectionsByTone[profile.tone];
  const reflection = reflections[seededIndex(seed, reflections.length)];
  const actions = actionByLens[lens];
  const actionStep = actions[seededIndex(`${seed}:${lens}`, actions.length)];

  return {
    reflection,
    actionStep,
    deeperQuestion: defaultQuestionForIntent(profile, input),
  };
}

function fallbackSnapshot(messages: ChatHistoryMessage[]): PurposeSnapshotDraft {
  const latestUserMessage =
    messages
      .slice()
      .reverse()
      .find((message) => message.role === "user")?.content ??
    "live with clarity, contribution, and aligned growth";

  return {
    mission: `Create a life aligned with your true priorities by focusing on what matters most: ${latestUserMessage.slice(
      0,
      120,
    )}.`,
    values: fillValues(["Growth", "Authenticity", "Purpose"]),
    nextActions: fillActions([
      "Define one meaningful weekly objective that reflects your core values.",
      "Identify one draining commitment you can reduce this week.",
      "Take one concrete step toward a purpose-aligned career or life move.",
    ]),
  };
}

export function renderCoachReply(reply: CoachReply): string {
  return [
    `Reflection: ${reply.reflection}`,
    `Action step: ${reply.actionStep}`,
    `Deeper question: ${reply.deeperQuestion}`,
  ].join("\n\n");
}

export async function generateCoachReply(params: {
  text: string;
  history: ChatHistoryMessage[];
  latestSnapshot: StoredPurposeSnapshot | null;
}): Promise<CoachReply> {
  const client = getOpenAiClient();
  const profile = buildSessionProfile(params.history, params.text);
  const lens = chooseCoachingLens(profile, params.text);

  if (!client) {
    return fallbackCoachReply(params.text, params.history, profile);
  }

  const avoidPhraseBlock = buildAvoidPhraseBlock(profile);
  const baseUserParts = [
    "Session profile:",
    buildSessionProfileBlock(profile),
    "",
    "Recent user context:",
    formatConversationContext(profile),
    "",
    "Latest purpose snapshot:",
    formatSnapshotContext(params.latestSnapshot),
    "",
    `Current user message: ${params.text}`,
  ];

  if (avoidPhraseBlock) {
    baseUserParts.push("", "Avoid reusing these prior assistant phrases:", avoidPhraseBlock);
  }

  const baseUserMessage = baseUserParts.join("\n");

  const jsonPrompt = [
    "You are Soulaware, an AI life guidance coach.",
    "You are not a licensed therapist and must avoid diagnosis claims.",
    `Coaching lens for this turn: ${lensInstruction(lens)}`,
    "Respond with practical, compassionate coaching for adults.",
    "Make this answer materially different from recent assistant wording.",
    "Use at least one concrete phrase from the current user message in the action step.",
    "Avoid generic questions like 'What would progress look like by next week?'.",
    "Output strict JSON only with keys: reflection, actionStep, deeperQuestion.",
    "Each field must be one to two sentences and under 70 words.",
  ].join(" ");

  let candidate: CoachReply | null = null;

  try {
    const completion = await client.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.85,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: jsonPrompt,
        },
        {
          role: "user",
          content: baseUserMessage,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed =
      normalizeCoachReply(extractJsonObject(raw)) ?? parseLabeledCoachReply(raw);

    if (parsed) {
      candidate = postProcessCoachReply(parsed, profile, params.text);
      if (!isReplyTooSimilarToRecent(candidate, params.history)) {
        return candidate;
      }
    }
  } catch (error) {
    console.error("[Soulaware] JSON coach response failed", error);
  }

  const variationPrompt = [
    "You are Soulaware, an AI life guidance coach.",
    "Do not use markdown, JSON, or bullet points.",
    "Return exactly three lines in this format:",
    "Reflection: ...",
    "Action step: ...",
    "Deeper question: ...",
    `Coaching lens for this turn: ${lensInstruction(lens)}`,
    "Your reply must be substantially different from recent assistant wording.",
    "Use one specific keyword from the user context.",
  ].join(" ");

  const variationUserMessage = [
    baseUserMessage,
    "",
    "The previous draft was too repetitive. Generate a fresh angle and a new question.",
    candidate ? `Previous draft to avoid: ${flattenCoachReply(candidate)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.95,
      messages: [
        {
          role: "system",
          content: variationPrompt,
        },
        {
          role: "user",
          content: variationUserMessage,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed =
      parseLabeledCoachReply(raw) ?? normalizeCoachReply(extractJsonObject(raw));

    if (parsed) {
      const normalized = postProcessCoachReply(parsed, profile, params.text);
      if (!isReplyTooSimilarToRecent(normalized, params.history)) {
        return normalized;
      }
    }
  } catch (error) {
    console.error("[Soulaware] variation coach response failed", error);
  }

  return fallbackCoachReply(params.text, params.history, profile);
}

export async function generatePurposeSnapshot(params: {
  history: ChatHistoryMessage[];
  latestSnapshot: StoredPurposeSnapshot | null;
}): Promise<PurposeSnapshotDraft> {
  const client = getOpenAiClient();

  if (!client) {
    return fallbackSnapshot(params.history);
  }

  const prompt = [
    "You are Soulaware, creating a purpose snapshot.",
    "Return strict JSON only with keys: mission, values, nextActions.",
    "mission must be one sentence.",
    "values must contain exactly 5 short value labels.",
    "nextActions must contain exactly 3 concrete actions that can be done in 7 days.",
    "Do not include markdown.",
  ].join(" ");

  try {
    const completion = await client.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.55,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: [
            "Conversation context:",
            params.history
              .slice(-12)
              .map((message) => `${message.role.toUpperCase()}: ${truncate(message.content, 220)}`)
              .join("\n"),
            "",
            "Latest previous snapshot:",
            formatSnapshotContext(params.latestSnapshot),
            "",
            "Generate the updated purpose snapshot now.",
          ].join("\n"),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = normalizeSnapshot(extractJsonObject(raw));

    if (parsed) {
      return {
        mission: parsed.mission,
        values: fillValues(parsed.values),
        nextActions: fillActions(parsed.nextActions),
      };
    }
  } catch (error) {
    console.error("[Soulaware] Purpose snapshot generation failed", error);
    return fallbackSnapshot(params.history);
  }

  return fallbackSnapshot(params.history);
}

export {
  generateCoachReplyV2,
  type GenerateCoachReplyV2Params,
  type GenerateCoachReplyV2Result,
} from "@/lib/server/ai-v2";
