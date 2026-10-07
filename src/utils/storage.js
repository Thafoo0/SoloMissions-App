import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------- Storage keys ----------
const TASKS_KEY = 'mission_reminder:tasks';
const TEMPLATES_KEY = 'mission_reminder:dailyTemplates';
const LAST_SPAWN_KEY = 'mission_reminder:lastSpawnDate';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKFILL_DAYS = 60; // safety cap if the app wasn't opened for a long time

// ---------- Internal helpers ----------
async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Failed to read ${key}:`, error);
    return fallback;
  }
}

async function writeJson(key, value) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

const writeTasks = (tasks) => writeJson(TASKS_KEY, tasks);

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- Weekly evaluation ----------

const LAST_WEEKLY_REPORT_KEY = 'mission_reminder:lastWeeklyReportDate';

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
  const lastSeen = await AsyncStorage.getItem(LAST_WEEKLY_REPORT_KEY);
  return lastSeen === toDateKey(getWeekStart());
}

/** Save this week's Monday so the report doesn't show again until next week. */
export async function markWeeklyReportSeen() {
  await AsyncStorage.setItem(LAST_WEEKLY_REPORT_KEY, toDateKey(getWeekStart()));
}

/** Delete one task by id. Returns true if something was removed. */
export async function deleteTask(taskId) {
  const tasks = await getTasks();
  const next = tasks.filter((task) => task.id !== taskId);
  if (next.length === tasks.length) return false; // id not found
  await writeTasks(next);
  return true;
}

/** Delete one daily template by id. Returns true if something was removed. */
export async function deleteDailyTemplate(templateId) {
  const templates = await getDailyTemplates();
  const next = templates.filter((template) => template.id !== templateId);
  if (next.length === templates.length) return false; // id not found
  await writeJson(TEMPLATES_KEY, next);
  return true;
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

// Build the task for one template on one day.
// The id is deterministic, so the same daily can never be spawned twice for the same day.
function buildDailyTask(template, date) {
  return {
    id: `daily-${template.id}-${toDateKey(date)}`,
    title: template.title,
    points: template.points,
    type: 'daily',
    templateId: template.id,
    createdAt: startOfDay(date).toISOString(),
    expiresAt: endOfDay(date).toISOString(),
    status: 'active',
  };
}

// ---------- Tasks ----------

/** Get all stored tasks. Old tasks saved before this update have no type: they count as side quests. */
export async function getTasks() {
  const tasks = await readJson(TASKS_KEY, []);
  return tasks.map((task) => ({ ...task, type: task.type ?? 'side' }));
}

/** Create a one-off quest that expires 24h after creation. Returns the saved task. */
export async function saveSideQuest(title, points) {
  const now = Date.now();
  const task = {
    id: createId(),
    title: title.trim(),
    points: Number(points),
    type: 'side',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DAY_MS).toISOString(),
    status: 'active',
  };

  const tasks = await getTasks();
  await writeTasks([...tasks, task]);
  return task;
}

/** Toggle a task between 'active' and 'done'. Returns the updated task, or null if not found. */
export async function toggleTaskStatus(taskId) {
  const tasks = await getTasks();
  let updated = null;

  const next = tasks.map((task) => {
    if (task.id !== taskId) return task;
    updated = { ...task, status: task.status === 'done' ? 'active' : 'done' };
    return updated;
  });

  if (updated) await writeTasks(next);
  return updated;
}

// ---------- Daily templates ----------

export async function getDailyTemplates() {
  return readJson(TEMPLATES_KEY, []);
}

/**
 * Save a daily routine. It spawns today's copy right away,
 * then a new copy appears every day via spawnDailiesIfNewDay().
 */
export async function saveDailyTemplate(title, points) {
  const now = new Date();
  const todayKey = toDateKey(now);

  const template = {
    id: createId(),
    title: title.trim(),
    points: Number(points),
    createdAt: now.toISOString(),
    createdDate: todayKey,
  };

  const templates = await getDailyTemplates();
  await writeJson(TEMPLATES_KEY, [...templates, template]);

  const lastSpawn = await AsyncStorage.getItem(LAST_SPAWN_KEY);
  if (lastSpawn === todayKey) {
    // Today's spawn already ran, so add this template's copy for today by hand
    const tasks = await getTasks();
    await writeTasks([...tasks, buildDailyTask(template, now)]);
  } else {
    // Otherwise the spawner will include the new template
    await spawnDailiesIfNewDay();
  }
  return template;
}

// ---------- The spawner ----------

let spawning = null; // prevents two screens from running the spawner at the same time

/**
 * Call this when the app opens or a screen gains focus.
 * If the date changed since lastSpawnDate, creates the daily tasks for each day that was missed
 * (days when the app wasn't opened show up as failed, so the heatmap stays honest),
 * then updates lastSpawnDate. Returns the newly created tasks ([] if nothing was needed).
 */
export function spawnDailiesIfNewDay() {
  if (!spawning) {
    spawning = runSpawn().finally(() => {
      spawning = null;
    });
  }
  return spawning;
}

async function runSpawn() {
  const todayKey = toDateKey(new Date());
  const lastSpawn = await AsyncStorage.getItem(LAST_SPAWN_KEY);
  if (lastSpawn === todayKey) return [];

  // Days to generate: every day after lastSpawnDate up to today (only today on first run)
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
  const existing = await getTasks();
  const existingIds = new Set(existing.map((t) => t.id));
  const created = [];

  for (const date of daysToSpawn) {
    const key = toDateKey(date);
    for (const template of templates) {
      if (template.createdDate > key) continue; // the routine didn't exist on that day yet
      const task = buildDailyTask(template, date);
      if (!existingIds.has(task.id)) created.push(task);
    }
  }

  if (created.length > 0) await writeTasks([...existing, ...created]);
  await AsyncStorage.setItem(LAST_SPAWN_KEY, todayKey);
  return created;
}