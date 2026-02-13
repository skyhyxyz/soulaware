import OpenAI from "openai";
import { env, hasOpenAi } from "@/lib/server/env";
import type { SafetyLevel } from "@/types/domain";

type SafetyResult = {
  level: SafetyLevel;
  isTriggered: boolean;
  reason: string;
};

const HIGH_RISK_PATTERNS = [
  /\bkill myself\b/i,
  /\bend my life\b/i,
  /\bsuicide\b/i,
  /\bi want to die\b/i,
  /\bhurt someone\b/i,
  /\bself harm\b/i,
  /\boverdose\b/i,
  /\bno reason to live\b/i,
];

const ELEVATED_PATTERNS = [
  /\bhopeless\b/i,
  /\bcan'?t go on\b/i,
  /\bpanic attack\b/i,
  /\bworthless\b/i,
];

const SAFETY_RESPONSE = [
  "I’m really glad you reached out. Your safety matters most right now.",
  "I can’t provide crisis support, but I strongly encourage you to connect with immediate help:",
  "- Call or text **988** (Suicide & Crisis Lifeline, US, 24/7)",
  "- If you may act on these thoughts or are in immediate danger, call **911** now",
  "- If possible, contact a trusted person who can stay with you right now",
].join("\n");

let moderationClient: OpenAI | null = null;

function getOpenAiClient(): OpenAI | null {
  if (!hasOpenAi) {
    return null;
  }

  if (!moderationClient) {
    moderationClient = new OpenAI({ apiKey: env.openAiApiKey });
  }

  return moderationClient;
}

function evaluateRuleBased(text: string): SafetyResult {
  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      level: "high",
      isTriggered: true,
      reason: "rule_high_risk",
    };
  }

  if (ELEVATED_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      level: "elevated",
      isTriggered: false,
      reason: "rule_elevated",
    };
  }

  return {
    level: "none",
    isTriggered: false,
    reason: "rule_clear",
  };
}

async function evaluateModeration(text: string): Promise<SafetyResult> {
  const client = getOpenAiClient();

  if (!client) {
    return {
      level: "none",
      isTriggered: false,
      reason: "moderation_skipped_no_api_key",
    };
  }

  try {
    const moderation = await client.moderations.create({
      model: "omni-moderation-latest",
      input: text,
    });

    const result = moderation.results[0];
    const categories = result?.categories;
    const isSelfHarm =
      Boolean(categories?.["self-harm"]) ||
      Boolean(categories?.["self-harm/intent"]) ||
      Boolean(categories?.["self-harm/instructions"]);

    if (isSelfHarm) {
      return {
        level: "high",
        isTriggered: true,
        reason: "moderation_self_harm",
      };
    }

    if (result?.flagged) {
      return {
        level: "elevated",
        isTriggered: false,
        reason: "moderation_flagged",
      };
    }

    return {
      level: "none",
      isTriggered: false,
      reason: "moderation_clear",
    };
  } catch {
    return {
      level: "none",
      isTriggered: false,
      reason: "moderation_failed",
    };
  }
}

export async function evaluateSafety(text: string): Promise<SafetyResult> {
  const ruleResult = evaluateRuleBased(text);

  if (ruleResult.isTriggered) {
    return ruleResult;
  }

  const moderationResult = await evaluateModeration(text);

  if (moderationResult.isTriggered) {
    return moderationResult;
  }

  if (ruleResult.level === "elevated" || moderationResult.level === "elevated") {
    return {
      level: "elevated",
      isTriggered: false,
      reason: `${ruleResult.reason}+${moderationResult.reason}`,
    };
  }

  return {
    level: "none",
    isTriggered: false,
    reason: `${ruleResult.reason}+${moderationResult.reason}`,
  };
}

export function getSafetyResponseText(): string {
  return SAFETY_RESPONSE;
}
