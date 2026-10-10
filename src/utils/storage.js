import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Device-level flags stay local (one key per user, so accounts never mix)
const LAST_SPAWN_KEY = 'mission_reminder:lastSpawnDate';
const LAST_WEEKLY_REPORT_KEY = 'mission_reminder:lastWeeklyReportDate';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKFILL_DAYS = 60; // safety cap if the app wasn't opened for a long time
const PAGE_SIZE = 1000;       // Supabase returns at most 1000 rows per request

// ---------- Internal helpers ----------

async function getUserId() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Not signed in');
  return data.session.user.id;
}

// Local-time "YYYY-MM-DD" (toISOString would use UTC and shift days near midnight)
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const startOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

const endOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

// Database rows -> the shape the screens already use (so the UI code doesn't change)
const toTask = (row) => ({
  id: row.id,
  title: row.title,
  points: row.xp,
  type: row.type,
  templateId: row.template_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  status: row.completed ? 'done' : 'active',
});

const toTemplate = (row) => ({
  id: row.id,
  title: row.title,
  points: row.xp,
  createdAt: row.created_at,
  createdDate: toDateKey(new Date(row.created_at)),
});

// Read every row of a table, page by page
async function fetchAll(table, orderColumn) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

// The row for one template on one day
function buildDailyRow(template, date) {
  return {
    template_id: template.id,
    title: template.title,
    xp: template.points,
    type: 'daily',
    date: toDateKey(date),
    created_at: startOfDay(date).toISOString(),
    expires_at: endOfDay(date).toISOString(),
  };
}

// Insert daily rows; rows that already exist (same template + day) are skipped
async function insertDailyRows(rows) {
  if (rows.length === 0) return [];
  const { data, error } = await supabase
    .from('tasks')
    .upsert(rows, { onConflict: 'template_id,date', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data.map(toTask);
}

// ---------- Tasks ----------

/** Get all of the signed-in user's tasks. Returns [] on error or when signed out. */
export async function getTasks() {
  try {
    const rows = await fetchAll('tasks', 'created_at');

    // Keep the "failed" column in sync with reality (fire and forget, not awaited)
    supabase
      .from('tasks')
      .update({ failed: true })
      .eq('completed', false)
      .eq('failed', false)
      .lt('expires_at', new Date().toISOString())
      .then(
        () => {},
        () => {}
      );

    return rows.map(toTask);
  } catch (error) {
    console.warn('getTasks failed:', error);
    return [];
  }
}

/** Create a one-off quest that expires 24h after creation. Returns the saved task. */
export async function saveSideQuest(title, points) {
  const now = new Date();
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: title.trim(),
      xp: Number(points),
      type: 'side',
      date: toDateKey(now),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + DAY_MS).toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return toTask(data);
}

/** Toggle a task between 'active' and 'done'. Returns the updated task, or null if not found. */
export async function toggleTaskStatus(taskId) {
  const { data: current, error: readError } = await supabase
    .from('tasks')
    .select('completed')
    .eq('id', taskId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return null;

  const { data, error } = await supabase
    .from('tasks')
    .update({ completed: !current.completed })
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return toTask(data);
}

/** Delete one task by id. Returns true if something was removed. */
export async function deleteTask(taskId) {
  const { data, error } = await supabase.from('tasks').delete().eq('id', taskId).select('id');
  if (error) throw error;
  return data.length > 0;
}

// ---------- Daily templates ----------

export async function getDailyTemplates() {
  try {
    const rows = await fetchAll('daily_templates', 'created_at');
    return rows.map(toTemplate);
  } catch (error) {
    console.warn('getDailyTemplates failed:', error);
    return [];
  }
}

/**
 * Save a daily routine. It spawns today's copy right away,
 * then a new copy appears every day via spawnDailiesIfNewDay().
 */
export async function saveDailyTemplate(title, points) {
  const { data, error } = await supabase
    .from('daily_templates')
    .insert({ title: title.trim(), xp: Number(points) })
    .select()
    .single();
  if (error) throw error;
  const template = toTemplate(data);

  const uid = await getUserId();
  const todayKey = toDateKey(new Date());
  const lastSpawn = await AsyncStorage.getItem(`${LAST_SPAWN_KEY}:${uid}`);

  if (lastSpawn === todayKey) {
    // Today's spawn already ran, so add this routine's copy for today by hand
    await insertDailyRows([buildDailyRow(template, new Date())]);
  } else {
    // Otherwise the spawner will include the new template
    await spawnDailiesIfNewDay();
  }
  return template;
}

/** Delete one daily template by id. Its past and current tasks stay as history. */
export async function deleteDailyTemplate(templateId) {
  const { data, error } = await supabase
    .from('daily_templates')
    .delete()
    .eq('id', templateId)
    .select('id');
  if (error) throw error;
  return data.length > 0;
}

// ---------- The spawner ----------

let spawning = null; // prevents two screens from running the spawner at the same time

/**
 * Call this when the app opens or a screen gains focus.
 * If the date changed since the last spawn, creates the daily tasks for each day that was missed
 * (days when the app wasn't opened show up as failed, so the heatmap stays honest).
 * Safe to run twice: the database ignores duplicates. Returns the newly created tasks.
 */
export function spawnDailiesIfNewDay() {
  if (!spawning) {
    spawning = runSpawn()
      .catch((error) => {
        console.warn('spawnDailiesIfNewDay failed:', error);
        return [];
      })
      .finally(() => {
        spawning = null;
      });
  }
  return spawning;
}

async function runSpawn() {
  const uid = await getUserId();
  const spawnKey = `${LAST_SPAWN_KEY}:${uid}`;
  const todayKey = toDateKey(new Date());
  const lastSpawn = await AsyncStorage.getItem(spawnKey);
  if (lastSpawn === todayKey) return [];

  // Days to generate: every day after the last spawn up to today (only today on first run)
  const days = [];
  if (!lastSpawn) {
    days.push(fromDateKey(todayKey));
  } else {
    const cursor = fromDateKey(lastSpawn);
    cursor.setDate(cursor.getDate() + 1);
    while (toDateKey(cursor) <= todayKey) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const daysToSpawn = days.slice(-MAX_BACKFILL_DAYS);

  const templates = await getDailyTemplates();
  const rows = [];
  for (const date of daysToSpawn) {
    const key = toDateKey(date);
    for (const template of templates) {
      if (template.createdDate > key) continue; // the routine didn't exist on that day yet
      rows.push(buildDailyRow(template, date));
    }
  }

  const created = await insertDailyRows(rows);
  await AsyncStorage.setItem(spawnKey, todayKey);
  return created;
}

// ---------- Weekly evaluation ----------

// Monday (00:00, local time) of the week that contains `date`
function getWeekStart(date = new Date()) {
  const offset = (date.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

/**
 * Points earned vs. points available for one Monday-Sunday week.
 * weeksAgo = 1 (default): the week that just ended
 * weeksAgo = 0: the current week so far
 * Tasks count in the week they were created, same as the Results calendar.
 */
export async function getWeeklyStats(weeksAgo = 1) {
  const start = getWeekStart();
  start.setDate(start.getDate() - 7 * weeksAgo);
  const end = new Date(start);
  end.setDate(end.getDate() + 7); // next Monday 00:00 (exclusive)

  const tasks = await getTasks();
  let totalEarned = 0;
  let totalPossible = 0;

  for (const task of tasks) {
    const created = new Date(task.createdAt);
    if (created < start || created >= end) continue;
    totalPossible += task.points;
    if (task.status === 'done') totalEarned += task.points;
  }

  const percentage =
    totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : 0;

  return { totalEarned, totalPossible, percentage, weekStart: toDateKey(start) };
}

/** True if the report was already marked as seen during the current week. */
export async function getWeeklyReportStatus() {
  try {
    const uid = await getUserId();
    const lastSeen = await AsyncStorage.getItem(`${LAST_WEEKLY_REPORT_KEY}:${uid}`);
    return lastSeen === toDateKey(getWeekStart());
  } catch {
    return true; // signed out: don't show a report
  }
}

/** Save this week's Monday so the report doesn't show again until next week. */
export async function markWeeklyReportSeen() {
  try {
    const uid = await getUserId();
    await AsyncStorage.setItem(`${LAST_WEEKLY_REPORT_KEY}:${uid}`, toDateKey(getWeekStart()));
  } catch {
    // signed out: nothing to save
  }
}