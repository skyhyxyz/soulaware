export const env = {
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  openAiChatModelPrimary:
    process.env.OPENAI_CHAT_MODEL_PRIMARY ?? "gpt-4.1",
  openAiChatModelFast: process.env.OPENAI_CHAT_MODEL_FAST ?? "gpt-4.1-mini",
  openAiSummaryModel: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-4.1-mini",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  soulawareChatEngine: process.env.SOULAWARE_CHAT_ENGINE ?? "v1",
  soulawareChatV2Percent: Number(process.env.SOULAWARE_CHAT_V2_PERCENT ?? "10"),
  soulawareCostAlertDailyUsd: Number(
    process.env.SOULAWARE_COST_ALERT_DAILY_USD ?? "0",
  ),
  soulawareCostAlertWebhookUrl: process.env.SOULAWARE_COST_ALERT_WEBHOOK_URL,
  cronSecret: process.env.CRON_SECRET,
};

export const hasOpenAi = Boolean(env.openAiApiKey);
export const hasSupabase = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
