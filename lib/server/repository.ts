import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "@/lib/server/env";
import type {
  AnalyticsEvent,
  AnalyticsEventName,
  ChatHistoryMessage,
  ChatRole,
  GuestSession,
  PromptMode,
  SafetyEvent,
  SafetyLevel,
  StoredPurposeSnapshot,
} from "@/types/domain";

type MemoryStore = {
  sessions: GuestSession[];
  messages: Array<{
    id: string;
    sessionId: string;
    role: ChatRole;
    content: string;
    mode: PromptMode;
    createdAt: string;
  }>;
  snapshots: StoredPurposeSnapshot[];
  safetyEvents: SafetyEvent[];
  analyticsEvents: AnalyticsEvent[];
};

type SessionRow = {
  id: string;
  guest_id: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  mode: PromptMode;
  created_at: string;
};

type SnapshotRow = {
  id: string;
  session_id: string;
  mission: string;
  values_json: string[];
  next_actions_json: string[];
  created_at: string;
};

const globalStore = globalThis as unknown as {
  __soulawareMemoryStore?: MemoryStore;
};

function getMemoryStore(): MemoryStore {
  if (!globalStore.__soulawareMemoryStore) {
    globalStore.__soulawareMemoryStore = {
      sessions: [],
      messages: [],
      snapshots: [],
      safetyEvents: [],
      analyticsEvents: [],
    };
  }

  return globalStore.__soulawareMemoryStore;
}

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (!hasSupabase) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return supabaseClient;
}

function mapSession(row: SessionRow): GuestSession {
  return {
    id: row.id,
    guestId: row.guest_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): ChatHistoryMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    mode: row.mode,
  };
}

function mapSnapshot(row: SnapshotRow): StoredPurposeSnapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    mission: row.mission,
    values: Array.isArray(row.values_json) ? row.values_json : [],
    nextActions: Array.isArray(row.next_actions_json) ? row.next_actions_json : [],
    createdAt: row.created_at,
  };
}

export async function getOrCreateSession(guestId: string): Promise<GuestSession> {
  const now = new Date().toISOString();
  const supabase = getSupabaseClient();

  if (!supabase) {
    const store = getMemoryStore();
    const existing = store.sessions.find((session) => session.guestId === guestId);

    if (existing) {
      existing.updatedAt = now;
      return existing;
    }

    const created: GuestSession = {
      id: crypto.randomUUID(),
      guestId,
      createdAt: now,
      updatedAt: now,
    };

    store.sessions.push(created);
    return created;
  }

  const existingResult = await supabase
    .from("guest_sessions")
    .select("id, guest_id, created_at, updated_at")
    .eq("guest_id", guestId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<SessionRow>();

  if (existingResult.error) {
    throw new Error(`Unable to fetch session: ${existingResult.error.message}`);
  }

  if (existingResult.data) {
    const session = mapSession(existingResult.data);

    await supabase
      .from("guest_sessions")
      .update({ updated_at: now })
      .eq("id", session.id);

    session.updatedAt = now;
    return session;
  }

  const createdResult = await supabase
    .from("guest_sessions")
    .insert({ guest_id: guestId, updated_at: now })
    .select("id, guest_id, created_at, updated_at")
    .single<SessionRow>();

  if (createdResult.error || !createdResult.data) {
    throw new Error(
      `Unable to create session: ${createdResult.error?.message ?? "unknown error"}`,
    );
  }

  return mapSession(createdResult.data);
}

export async function listMessages(
  sessionId: string,
  limit?: number,
): Promise<ChatHistoryMessage[]> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    const store = getMemoryStore();
    const sorted = store.messages
      .filter((message) => message.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const selected = typeof limit === "number" ? sorted.slice(-limit) : sorted;
    return selected.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      mode: message.mode,
    }));
  }

  const isLimited = typeof limit === "number";
  let query = supabase
    .from("chat_messages")
    .select("id, session_id, role, content, mode, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: !isLimited });

  if (isLimited) {
    query = query.limit(limit);
  }

  const result = await query;

  if (result.error) {
    throw new Error(`Unable to load messages: ${result.error.message}`);
  }

  const rows = (result.data ?? []).map((row) => mapMessage(row as MessageRow));
  return isLimited ? rows.reverse() : rows;
}

export async function createMessage(params: {
  sessionId: string;
  role: ChatRole;
  content: string;
  mode: PromptMode;
}): Promise<ChatHistoryMessage> {
  const now = new Date().toISOString();
  const supabase = getSupabaseClient();

  if (!supabase) {
    const store = getMemoryStore();
    const created = {
      id: crypto.randomUUID(),
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      mode: params.mode,
      createdAt: now,
    };

    store.messages.push(created);

    const session = store.sessions.find((entry) => entry.id === params.sessionId);
    if (session) {
      session.updatedAt = now;
    }

    return {
      id: created.id,
      role: created.role,
      content: created.content,
      createdAt: created.createdAt,
      mode: created.mode,
    };
  }

  const result = await supabase
    .from("chat_messages")
    .insert({
      session_id: params.sessionId,
      role: params.role,
      content: params.content,
      mode: params.mode,
    })
    .select("id, session_id, role, content, mode, created_at")
    .single<MessageRow>();

  if (result.error || !result.data) {
    throw new Error(
      `Unable to create message: ${result.error?.message ?? "unknown error"}`,
    );
  }

  await supabase
    .from("guest_sessions")
    .update({ updated_at: now })
    .eq("id", params.sessionId);

  return mapMessage(result.data);
}

export async function getLatestSnapshotForSession(
  sessionId: string,
): Promise<StoredPurposeSnapshot | null> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    const store = getMemoryStore();
    const existing = store.snapshots
      .filter((snapshot) => snapshot.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    return existing ?? null;
  }

  const result = await supabase
    .from("purpose_snapshots")
    .select("id, session_id, mission, values_json, next_actions_json, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SnapshotRow>();

  if (result.error) {
    throw new Error(`Unable to load latest snapshot: ${result.error.message}`);
  }

  return result.data ? mapSnapshot(result.data) : null;
}

export async function createPurposeSnapshot(params: {
  sessionId: string;
  mission: string;
  values: string[];
  nextActions: string[];
}): Promise<StoredPurposeSnapshot> {
  const now = new Date().toISOString();
  const supabase = getSupabaseClient();

  const values = params.values.slice(0, 5);
  const nextActions = params.nextActions.slice(0, 3);

  if (!supabase) {
    const store = getMemoryStore();
    const created: StoredPurposeSnapshot = {
      id: crypto.randomUUID(),
      sessionId: params.sessionId,
      mission: params.mission,
      values,
      nextActions,
      createdAt: now,
    };

    store.snapshots.push(created);

    const session = store.sessions.find((entry) => entry.id === params.sessionId);
    if (session) {
      session.updatedAt = now;
    }

    return created;
  }

  const result = await supabase
    .from("purpose_snapshots")
    .insert({
      session_id: params.sessionId,
      mission: params.mission,
      values_json: values,
      next_actions_json: nextActions,
    })
    .select("id, session_id, mission, values_json, next_actions_json, created_at")
    .single<SnapshotRow>();

  if (result.error || !result.data) {
    throw new Error(
      `Unable to create snapshot: ${result.error?.message ?? "unknown error"}`,
    );
  }

  await supabase
    .from("guest_sessions")
    .update({ updated_at: now })
    .eq("id", params.sessionId);

  return mapSnapshot(result.data);
}

export async function getSnapshotForGuest(params: {
  snapshotId: string;
  guestId: string;
}): Promise<StoredPurposeSnapshot | null> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    const store = getMemoryStore();
    const session = store.sessions.find((entry) => entry.guestId === params.guestId);
    if (!session) {
      return null;
    }

    return (
      store.snapshots.find(
        (snapshot) =>
          snapshot.id === params.snapshotId && snapshot.sessionId === session.id,
      ) ?? null
    );
  }

  const snapshotResult = await supabase
    .from("purpose_snapshots")
    .select("id, session_id, mission, values_json, next_actions_json, created_at")
    .eq("id", params.snapshotId)
    .maybeSingle<SnapshotRow>();

  if (snapshotResult.error) {
    throw new Error(`Unable to load snapshot: ${snapshotResult.error.message}`);
  }

  if (!snapshotResult.data) {
    return null;
  }

  const sessionResult = await supabase
    .from("guest_sessions")
    .select("id")
    .eq("id", snapshotResult.data.session_id)
    .eq("guest_id", params.guestId)
    .maybeSingle<{ id: string }>();

  if (sessionResult.error) {
    throw new Error(
      `Unable to authorize snapshot owner: ${sessionResult.error.message}`,
    );
  }

  if (!sessionResult.data) {
    return null;
  }

  return mapSnapshot(snapshotResult.data);
}

export async function createSafetyEvent(params: {
  sessionId: string;
  guestId: string;
  level: SafetyLevel;
  triggerText: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const supabase = getSupabaseClient();

  if (!supabase) {
    const store = getMemoryStore();
    store.safetyEvents.push({
      id: crypto.randomUUID(),
      guestId: params.guestId,
      level: params.level,
      triggerText: params.triggerText,
      createdAt: now,
    });
    return;
  }

  const result = await supabase.from("safety_events").insert({
    session_id: params.sessionId,
    level: params.level,
    trigger_text: params.triggerText,
  });

  if (result.error) {
    throw new Error(`Unable to create safety event: ${result.error.message}`);
  }
}

export async function clearSessionData(guestId: string): Promise<void> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    const store = getMemoryStore();
    const session = store.sessions.find((entry) => entry.guestId === guestId);

    if (!session) {
      return;
    }

    store.messages = store.messages.filter((entry) => entry.sessionId !== session.id);
    store.snapshots = store.snapshots.filter((entry) => entry.sessionId !== session.id);
    store.safetyEvents = store.safetyEvents.filter(
      (entry) => entry.guestId !== guestId,
    );
    session.updatedAt = new Date().toISOString();
    return;
  }

  const sessionResult = await supabase
    .from("guest_sessions")
    .select("id")
    .eq("guest_id", guestId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (sessionResult.error) {
    throw new Error(`Unable to clear session: ${sessionResult.error.message}`);
  }

  const sessionId = sessionResult.data?.id;
  if (!sessionId) {
    return;
  }

  await Promise.all([
    supabase.from("chat_messages").delete().eq("session_id", sessionId),
    supabase.from("purpose_snapshots").delete().eq("session_id", sessionId),
    supabase.from("safety_events").delete().eq("session_id", sessionId),
  ]);
}

export async function deleteGuestData(guestId: string): Promise<void> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    const store = getMemoryStore();
    const sessionIds = store.sessions
      .filter((entry) => entry.guestId === guestId)
      .map((entry) => entry.id);

    store.messages = store.messages.filter((entry) => !sessionIds.includes(entry.sessionId));
    store.snapshots = store.snapshots.filter(
      (entry) => !sessionIds.includes(entry.sessionId),
    );
    store.sessions = store.sessions.filter((entry) => entry.guestId !== guestId);
    store.safetyEvents = store.safetyEvents.filter((entry) => entry.guestId !== guestId);
    store.analyticsEvents = store.analyticsEvents.filter(
      (entry) => entry.guestId !== guestId,
    );
    return;
  }

  const sessionsResult = await supabase
    .from("guest_sessions")
    .select("id")
    .eq("guest_id", guestId);

  if (sessionsResult.error) {
    throw new Error(`Unable to fetch guest sessions: ${sessionsResult.error.message}`);
  }

  const sessionIds = (sessionsResult.data ?? []).map((row) => row.id as string);

  if (sessionIds.length > 0) {
    await Promise.all([
      supabase.from("chat_messages").delete().in("session_id", sessionIds),
      supabase.from("purpose_snapshots").delete().in("session_id", sessionIds),
      supabase.from("safety_events").delete().in("session_id", sessionIds),
    ]);
  }

  await Promise.all([
    supabase.from("analytics_events").delete().eq("guest_id", guestId),
    supabase.from("guest_sessions").delete().eq("guest_id", guestId),
  ]);
}

export async function trackEvent(params: {
  guestId: string;
  eventName: AnalyticsEventName;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date().toISOString();
  const metadata = params.metadata ?? {};
  const supabase = getSupabaseClient();

  if (!supabase) {
    const store = getMemoryStore();
    store.analyticsEvents.push({
      id: crypto.randomUUID(),
      guestId: params.guestId,
      eventName: params.eventName,
      metadata,
      createdAt: now,
    });
    return;
  }

  const result = await supabase.from("analytics_events").insert({
    guest_id: params.guestId,
    event_name: params.eventName,
    metadata,
    created_at: now,
  });

  if (result.error) {
    throw new Error(`Unable to track analytics event: ${result.error.message}`);
  }
}
