import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import logoModule from "../lib/logo.js";

const { RAUSKU_LOGO } = logoModule;
const h = React.createElement;

const FIELDS = [
  { key: "API_KEY", label: "API key", fallback: "", secret: true },
  { key: "API_AUTH_DISABLED", label: "Disable API auth in dev (True/False)", fallback: "0", type: "boolean" },
  { key: "DB_PATH", label: "SQLite DB path", fallback: "/data/rauskuclaw.sqlite" },
  { key: "WORKER_POLL_MS", label: "Worker poll interval ms", fallback: "300" },
  { key: "WORKER_QUEUE_ALLOWLIST", label: "Worker queue allowlist (csv)", fallback: "default" },
  { key: "CALLBACK_SIGNING_ENABLED", label: "Enable callback signing (True/False)", fallback: "0", type: "boolean" },
  { key: "CALLBACK_SIGNING_SECRET", label: "Callback signing secret", fallback: "", secret: true },
  { key: "CALLBACK_SIGNING_TOLERANCE_SEC", label: "Callback signing tolerance sec", fallback: "300" },
  { key: "METRICS_ENABLED", label: "Enable runtime metrics (True/False)", fallback: "1", type: "boolean" },
  { key: "METRICS_RETENTION_DAYS", label: "Metrics retention days", fallback: "7" },
  { key: "ALERT_WINDOW_SEC", label: "Alert window sec", fallback: "3600" },
  { key: "ALERT_QUEUE_STALLED_SEC", label: "Queue stalled alert sec", fallback: "900" },
  { key: "ALERT_FAILURE_RATE_PCT", label: "Failure rate alert pct", fallback: "50" },
  { key: "ALERT_FAILURE_RATE_MIN_COMPLETED", label: "Failure rate min completed", fallback: "20" },
  { key: "CODEX_OSS_ENABLED", label: "Enable Codex provider (True/False)", fallback: "0", type: "boolean" },
  {
    key: "CODEX_OSS_MODEL",
    label: "Codex model",
    fallback: "",
    when: (values) => String(values.CODEX_OSS_ENABLED || "0").trim() === "1"
  },
  {
    key: "CODEX_EXEC_MODE",
    label: "Codex exec mode (online/oss)",
    fallback: "online",
    when: (values) => String(values.CODEX_OSS_ENABLED || "0").trim() === "1"
  },
  {
    key: "CODEX_OSS_LOCAL_PROVIDER",
    label: "Codex OSS local provider (ollama/lmstudio)",
    fallback: "ollama"
  },
  { key: "CODEX_OSS_TIMEOUT_MS", label: "Codex OSS timeout ms", fallback: "60000" },
  { key: "CODEX_OSS_WORKDIR", label: "Codex OSS working directory", fallback: "/workspace" },
  { key: "CODEX_CLI_PATH", label: "Codex CLI path", fallback: "codex" },
  { key: "MEMORY_VECTOR_ENABLED", label: "Enable semantic memory vectors (True/False)", fallback: "0", type: "boolean" },
  {
    key: "SQLITE_VECTOR_EXTENSION_PATH",
    label: "sqlite-vector extension path",
    fallback: "",
    when: (values) => String(values.MEMORY_VECTOR_ENABLED || "0").trim() === "1"
  },
  { key: "OLLAMA_BASE_URL", label: "Ollama base URL", fallback: "http://rauskuclaw-ollama:11434" },
  { key: "OLLAMA_EMBED_MODEL", label: "Ollama embedding model", fallback: "embeddinggemma:300m-qat-q8_0" },
  { key: "OLLAMA_EMBED_TIMEOUT_MS", label: "Ollama embedding timeout ms", fallback: "15000" },
  { key: "MEMORY_SEARCH_TOP_K_DEFAULT", label: "Memory search top-k default", fallback: "10" },
  { key: "MEMORY_SEARCH_TOP_K_MAX", label: "Memory search top-k max", fallback: "100" },
  { key: "MEMORY_EMBED_QUEUE_TYPE", label: "Embedding queue job type", fallback: "system.memory.embed.sync" }
];

function withDefault(value, fallback) {
  const v = String(value == null ? "" : value).trim();
  return v || String(fallback || "");
}

function maskSecret(value) {
  const v = String(value || "");
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}

function isTrueValue(value) {
  const v = String(value == null ? "" : value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

function normalizeBoolean(value) {
  return isTrueValue(value) ? "1" : "0";
}

function SetupWizard({ initialValues, onDone }) {
  const { exit } = useApp();
  const [values, setValues] = useState({ ...initialValues });
  const [fieldIndex, setFieldIndex] = useState(0);
  const [mode, setMode] = useState("form");
  const [confirmInput, setConfirmInput] = useState("y");

  const visibleFields = useMemo(
    () => FIELDS.filter((field) => (field.when ? field.when(values) : true)),
    [values]
  );

  const activeField = mode === "form" ? visibleFields[fieldIndex] : null;
  const [input, setInput] = useState("");

  useEffect(() => {
    if (!activeField) return;
    const nextValue = withDefault(values[activeField.key], activeField.fallback);
    setInput(activeField.type === "boolean" ? normalizeBoolean(nextValue) : nextValue);
  }, [activeField, values]);

  useInput((str, key) => {
    if (key.ctrl && key.c) {
      onDone({ cancelled: true, values: initialValues });
      exit();
      return;
    }

    if (mode === "form") {
      if (!activeField) return;
      if (key.return) {
        const nextValue = activeField.type === "boolean"
          ? normalizeBoolean(input)
          : withDefault(input, activeField.fallback);
        setValues((prev) => ({ ...prev, [activeField.key]: nextValue }));
        if (fieldIndex >= visibleFields.length - 1) {
          setMode("confirm");
        } else {
          setFieldIndex((idx) => idx + 1);
        }
        return;
      }
      if (activeField.type === "boolean") {
        if (key.leftArrow || key.upArrow || str === "1") {
          setInput("1");
          return;
        }
        if (key.rightArrow || key.downArrow || str === "2") {
          setInput("0");
          return;
        }
        if (str === " ") {
          setInput((prev) => (isTrueValue(prev) ? "0" : "1"));
          return;
        }
      }
      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }
      if (key.escape) {
        onDone({ cancelled: true, values: initialValues });
        exit();
        return;
      }
      if (!key.ctrl && !key.meta && str && activeField.type !== "boolean") {
        setInput((prev) => prev + str);
      }
      return;
    }

    if (mode === "confirm") {
      if (key.return) {
        const answer = String(confirmInput || "").trim().toLowerCase();
        if (answer === "y" || answer === "yes") {
          onDone({ cancelled: false, values, confirmed: true });
        } else {
          onDone({ cancelled: true, values: initialValues, confirmed: false });
        }
        exit();
        return;
      }
      if (key.backspace || key.delete) {
        setConfirmInput((prev) => prev.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && str) {
        setConfirmInput((prev) => prev + str);
      }
    }
  });

  const formNode = mode === "form" && activeField
    ? h(Box, { flexDirection: "column" },
      h(Text, { color: "yellow" }, `[${fieldIndex + 1}/${visibleFields.length}] ${activeField.label}`),
      activeField.type === "boolean"
        ? h(
            Text,
            null,
            h(Text, { color: isTrueValue(input) ? "green" : "gray" }, isTrueValue(input) ? "(x) True" : "( ) True"),
            " / ",
            h(
              Text,
              { color: isTrueValue(input) ? "gray" : "green" },
              isTrueValue(input) ? "( ) False" : "(x) False"
            )
          )
        : h(Text, null,
            activeField.secret ? maskSecret(input) : input,
            h(Text, { color: "gray" }, "█")
          ),
      activeField.type === "boolean"
        ? h(Text, { color: "gray" }, "Use arrows, 1/2 or space. Enter = confirm.")
        : null
    )
    : null;

  const reviewRows = visibleFields.map((field) => h(
    Text,
    { key: field.key },
    h(Text, { color: "gray" }, `${field.key}=`),
    field.secret ? maskSecret(values[field.key]) : String(values[field.key] || "")
  ));

  const confirmNode = mode === "confirm"
    ? h(Box, { flexDirection: "column" },
      h(Text, { color: "yellow" }, "Review:"),
      ...reviewRows,
      h(Box, { marginTop: 1 },
        h(Text, { color: "yellow" }, "Write changes to .env? [y/N]: "),
        h(Text, null, confirmInput),
        h(Text, { color: "gray" }, "█")
      )
    )
    : null;

  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { color: "cyanBright" }, RAUSKU_LOGO),
    h(Text, { color: "green" }, "RauskuClaw setup wizard"),
    h(Text, { color: "gray" }, "Enter = next, Ctrl+C = cancel"),
    h(Box, { marginTop: 1, flexDirection: "column" }, formNode, confirmNode)
  );
}

export async function runSetupInkWizard(initialValues) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const app = render(h(SetupWizard, { initialValues, onDone: done }));
    app.waitUntilExit().then(() => {
      done({ cancelled: true, values: initialValues });
    });
  });
}
