const { envBoolOrConfig, envIntOrConfig } = require("./config");

let lastPruneMs = 0;

function nowIso() {
  return new Date().toISOString();
}

function getObservabilitySettings() {
  return {
    enabled: envBoolOrConfig("METRICS_ENABLED", "observability.metrics.enabled", true),
    retentionDays: Math.max(1, envIntOrConfig("METRICS_RETENTION_DAYS", "observability.metrics.retention_days", 7)),
    alertWindowSec: Math.max(60, envIntOrConfig("ALERT_WINDOW_SEC", "observability.metrics.alerts.window_sec", 3600)),
    alertQueueStalledSec: Math.max(5, envIntOrConfig("ALERT_QUEUE_STALLED_SEC", "observability.metrics.alerts.queue_stalled_sec", 900)),
    alertFailureRatePct: Math.max(1, Math.min(100, envIntOrConfig("ALERT_FAILURE_RATE_PCT", "observability.metrics.alerts.failure_rate_pct", 50))),
    alertFailureRateMinCompleted: Math.max(1, envIntOrConfig("ALERT_FAILURE_RATE_MIN_COMPLETED", "observability.metrics.alerts.failure_rate_min_completed", 20))
  };
}

function maybePruneMetrics(db, settings) {
  if (!settings.enabled) return;
  const nowMs = Date.now();
  if (nowMs - lastPruneMs < 60_000) return;
  lastPruneMs = nowMs;
  const cutoffMs = nowMs - (settings.retentionDays * 24 * 3600 * 1000);
  const cutoffIso = new Date(cutoffMs).toISOString();
  db.prepare("DELETE FROM metrics_events WHERE ts < ?").run(cutoffIso);
}

function recordMetric(db, name, opts = {}) {
  const settings = getObservabilitySettings();
  if (!settings.enabled) return false;
  maybePruneMetrics(db, settings);
  const value = Number.isFinite(Number(opts.value)) ? Number(opts.value) : 1;
  const labels = (opts.labels && typeof opts.labels === "object" && !Array.isArray(opts.labels)) ? opts.labels : null;
  db.prepare(`
    INSERT INTO metrics_events (ts, source, name, value, labels_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    nowIso(),
    String(opts.source || "runtime"),
    String(name || "").trim() || "unknown",
    value,
    labels ? JSON.stringify(labels) : null
  );
  return true;
}

function buildQueueFilterClause(queueScope = null) {
  if (!Array.isArray(queueScope) || queueScope.length < 1) return { clause: "", params: [] };
  const placeholders = queueScope.map(() => "?").join(",");
  return {
    clause: ` AND json_extract(labels_json, '$.queue') IN (${placeholders})`,
    params: queueScope
  };
}

function collectMetricCounters(db, windowSec, queueScope = null) {
  const safeWindowSec = Math.max(60, Math.min(7 * 24 * 3600, Number(windowSec) || 3600));
  const sinceIso = new Date(Date.now() - (safeWindowSec * 1000)).toISOString();
  const queueFilter = buildQueueFilterClause(queueScope);
  const rows = db.prepare(`
    SELECT name, SUM(value) AS total
    FROM metrics_events
    WHERE ts >= ?
    ${queueFilter.clause}
    GROUP BY name
    ORDER BY name ASC
  `).all(sinceIso, ...queueFilter.params);
  const counters = {};
  for (const row of rows) {
    counters[row.name] = Number(row.total || 0);
  }
  return { windowSec: safeWindowSec, sinceIso, counters };
}

function getJobStatusSnapshot(db, queueScope = null) {
  const queueSql = Array.isArray(queueScope) && queueScope.length > 0
    ? ` WHERE queue IN (${queueScope.map(() => "?").join(",")})`
    : "";
  const queueParams = Array.isArray(queueScope) && queueScope.length > 0 ? queueScope : [];
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS total
    FROM jobs
    ${queueSql}
    GROUP BY status
  `).all(...queueParams);
  const snapshot = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0
  };
  for (const row of rows) {
    const key = String(row.status || "");
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) snapshot[key] = Number(row.total || 0);
  }
  return snapshot;
}

function buildRuntimeAlerts(db, settings, windowSec, queueScope = null) {
  const alerts = [];
  const safeWindowSec = Math.max(60, Math.min(7 * 24 * 3600, Number(windowSec) || settings.alertWindowSec));
  const queueSql = Array.isArray(queueScope) && queueScope.length > 0
    ? ` AND queue IN (${queueScope.map(() => "?").join(",")})`
    : "";
  const queueParams = Array.isArray(queueScope) && queueScope.length > 0 ? queueScope : [];

  const oldestQueued = db.prepare(`
    SELECT id, created_at
    FROM jobs
    WHERE status = 'queued'
    ${queueSql}
    ORDER BY created_at ASC
    LIMIT 1
  `).get(...queueParams);
  if (oldestQueued && oldestQueued.created_at) {
    const ageSec = Math.max(0, Math.floor((Date.now() - new Date(oldestQueued.created_at).getTime()) / 1000));
    if (ageSec >= settings.alertQueueStalledSec) {
      alerts.push({
        code: "QUEUE_STALLED",
        severity: "warn",
        message: `Oldest queued job age (${ageSec}s) exceeds threshold (${settings.alertQueueStalledSec}s).`,
        details: {
          job_id: oldestQueued.id,
          oldest_age_sec: ageSec,
          threshold_sec: settings.alertQueueStalledSec
        }
      });
    }
  }

  const sinceIso = new Date(Date.now() - (safeWindowSec * 1000)).toISOString();
  const completedRows = db.prepare(`
    SELECT status, COUNT(*) AS total
    FROM jobs
    WHERE status IN ('succeeded', 'failed') AND updated_at >= ?
    ${queueSql}
    GROUP BY status
  `).all(sinceIso, ...queueParams);
  let succeeded = 0;
  let failed = 0;
  for (const row of completedRows) {
    if (row.status === "succeeded") succeeded = Number(row.total || 0);
    if (row.status === "failed") failed = Number(row.total || 0);
  }
  const completed = succeeded + failed;
  if (completed >= settings.alertFailureRateMinCompleted) {
    const failureRate = completed > 0 ? (failed / completed) * 100 : 0;
    if (failureRate >= settings.alertFailureRatePct) {
      alerts.push({
        code: "HIGH_FAILURE_RATE",
        severity: "warn",
        message: `Job failure rate (${failureRate.toFixed(1)}%) exceeds threshold (${settings.alertFailureRatePct}%).`,
        details: {
          window_sec: safeWindowSec,
          completed,
          failed,
          succeeded,
          failure_rate_pct: Number(failureRate.toFixed(2)),
          threshold_pct: settings.alertFailureRatePct
        }
      });
    }
  }

  return alerts;
}

module.exports = {
  getObservabilitySettings,
  recordMetric,
  collectMetricCounters,
  getJobStatusSnapshot,
  buildRuntimeAlerts
};
