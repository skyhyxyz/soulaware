export const env = {
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

export const hasOpenAi = Boolean(env.openAiApiKey);
export const hasSupabase = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
