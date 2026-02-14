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

function fallbackCoachReply(input: string, history: ChatHistoryMessage[]): CoachReply {
  const latestUserMessage =
    history
      .slice()
      .reverse()
      .find((message) => message.role === "user")?.content ?? input;

  const seed = `${input}|${latestUserMessage}|${history.length}`;

  const reflections = [
    "You are being honest about where you are, and that honesty creates momentum.",
    "Naming this clearly is already a meaningful step toward change.",
    "This moment sounds important, and your awareness is stronger than you think.",
    "You are noticing something real, which gives us a practical place to start.",
  ];

  const questions = [
    "What would progress look like by this time next week?",
    "Which choice here feels aligned, even if it is uncomfortable?",
    "If you removed fear for one hour, what move would you make first?",
    "What is one boundary that would protect your energy this week?",
  ];

  const actionOpeners = [
    "For the next 20 minutes, write down",
    "Before the day ends, capture",
    "In one focused session today, list",
    "Right now, take 15 minutes and map",
  ];

  const reflection = reflections[seededIndex(seed, reflections.length)];
  const deeperQuestion = questions[seededIndex(`${seed}:q`, questions.length)];
  const actionOpener = actionOpeners[seededIndex(`${seed}:a`, actionOpeners.length)];

  return {
    reflection,
    actionStep: `${actionOpener} three specifics: what you want more of, what you want less of, and one concrete next step tied to "${input.slice(
      0,
      80,
    )}".`,
    deeperQuestion,
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
    return fallbackCoachReply(params.text, params.history);
  }

  const baseUserMessage = [
    "Context from the latest conversation:",
    formatConversationContext(params.history),
    "",
    "Latest purpose snapshot:",
    formatSnapshotContext(params.latestSnapshot),
    "",
    `Current user message: ${params.text}`,
  ].join("\n");

  const jsonPrompt = [
    "You are Soulaware, an AI life guidance coach.",
    "You are not a licensed therapist and must avoid clinical diagnosis claims.",
    "Respond with practical, compassionate coaching for adults.",
    "Do not repeat exact wording from prior assistant messages in the context.",
    "Output strict JSON only with keys: reflection, actionStep, deeperQuestion.",
    "Each field must be one to two sentences and under 70 words.",
  ].join(" ");

  try {
    const completion = await client.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.7,
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
      return parsed;
    }
  } catch (error) {
    console.error("[Soulaware] JSON coach response failed", error);
  }

  const textPrompt = [
    "You are Soulaware, an AI life guidance coach.",
    "Do not use markdown, JSON, or bullet points.",
    "Return exactly three lines in this format:",
    "Reflection: ...",
    "Action step: ...",
    "Deeper question: ...",
    "Do not repeat exact wording from prior assistant messages.",
  ].join(" ");

  try {
    const completion = await client.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content: textPrompt,
        },
        {
          role: "user",
          content: baseUserMessage,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed =
      parseLabeledCoachReply(raw) ?? normalizeCoachReply(extractJsonObject(raw));

    if (parsed) {
      return parsed;
    }
  } catch (error) {
    console.error("[Soulaware] Text coach response failed", error);
  }

  return fallbackCoachReply(params.text, params.history);
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
  } catch (error) {
    console.error("[Soulaware] Purpose snapshot generation failed", error);
    return fallbackSnapshot(params.history);
  }

  return fallbackSnapshot(params.history);
}
