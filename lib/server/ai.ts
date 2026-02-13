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

function normalizeCoachReply(data: Record<string, unknown> | null): CoachReply | null {
  if (!data) {
    return null;
  }

  const reflection = typeof data.reflection === "string" ? data.reflection.trim() : "";
  const actionStep = typeof data.actionStep === "string" ? data.actionStep.trim() : "";
  const deeperQuestion =
    typeof data.deeperQuestion === "string" ? data.deeperQuestion.trim() : "";

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

  const mission = typeof data.mission === "string" ? data.mission.trim() : "";
  const values = Array.isArray(data.values)
    ? data.values.filter((entry): entry is string => typeof entry === "string")
    : [];
  const nextActions = Array.isArray(data.nextActions)
    ? data.nextActions.filter((entry): entry is string => typeof entry === "string")
    : [];

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

function fallbackCoachReply(input: string): CoachReply {
  return {
    reflection:
      "You are taking a meaningful step by putting this into words. That usually signals clarity is already starting.",
    actionStep: `Take 15 minutes today to write: what you want more of, what you want less of, and one next action connected to "${input.slice(
      0,
      60,
    )}".`,
    deeperQuestion:
      "If you trusted yourself 10% more this week, what decision would you make first?",
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

function formatConversationContext(messages: ChatHistoryMessage[]): string {
  return messages
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
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

  if (!client) {
    return fallbackCoachReply(params.text);
  }

  const prompt = [
    "You are Soulaware, an AI life guidance coach.",
    "You are not a licensed therapist and must avoid clinical diagnosis claims.",
    "Respond with practical, compassionate coaching for adults.",
    "Output strict JSON only with keys: reflection, actionStep, deeperQuestion.",
    "Each field must be one to two sentences and under 70 words.",
  ].join(" ");

  try {
    const completion = await client.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: [
            "Context from the latest conversation:",
            formatConversationContext(params.history),
            "",
            "Latest purpose snapshot:",
            formatSnapshotContext(params.latestSnapshot),
            "",
            `Current user message: ${params.text}`,
          ].join("\n"),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = normalizeCoachReply(extractJsonObject(raw));

    if (parsed) {
      return parsed;
    }
  } catch {
    return fallbackCoachReply(params.text);
  }

  return fallbackCoachReply(params.text);
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
      temperature: 0.5,
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
            formatConversationContext(params.history),
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
  } catch {
    return fallbackSnapshot(params.history);
  }

  return fallbackSnapshot(params.history);
}
