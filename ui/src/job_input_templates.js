function asString(value, maxLen = 2000) {
  return String(value || "").trim().slice(0, maxLen);
}

export function getInputTemplateForType(typeName) {
  const t = asString(typeName, 120);
  if (t === "tool.exec") {
    return {
      command: "git",
      args: ["status", "--short"]
    };
  }
  if (t === "data.fetch") {
    return {
      url: "https://api.github.com/",
      timeout_ms: 8000,
      max_bytes: 4096
    };
  }
  if (t === "data.file_read") {
    return {
      path: "README.md",
      max_bytes: 262144
    };
  }
  if (t === "tools.web_search") {
    return {
      query: "latest node.js release notes",
      provider: "duckduckgo",
      max_results: 5,
      timeout_ms: 8000
    };
  }
  if (t === "tools.file_search") {
    return {
      query: "README",
      path: ".",
      max_results: 30
    };
  }
  if (t === "tools.find_in_files") {
    return {
      query: "TODO",
      path: ".",
      max_results: 50
    };
  }
  if (t === "workflow.run") {
    return {
      workflow: "find_readme",
      params: {
        query: "README"
      }
    };
  }
  return null;
}

export function validateTypeSpecificInput(typeName, inputValue) {
  const t = asString(typeName, 120);
  if (!t) return [];

  if (t === "tool.exec") {
    if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) {
      return ["tool.exec input must be a JSON object."];
    }
    const command = asString(inputValue.command || inputValue.cmd || inputValue.script, 4000);
    const out = [];
    if (!command) out.push("tool.exec requires input.command.");
    if (command.length > 4000) out.push("tool.exec input.command must be at most 4000 characters.");
    if (inputValue.args != null) {
      if (!Array.isArray(inputValue.args)) {
        out.push("tool.exec input.args must be an array of strings.");
      } else {
        if (inputValue.args.length > 100) out.push("tool.exec input.args supports at most 100 entries.");
        for (const arg of inputValue.args) {
          if (typeof arg !== "string") out.push("tool.exec input.args must be an array of strings.");
          if (asString(arg, 5000).length > 4000) out.push("tool.exec args entries must be at most 4000 characters.");
        }
      }
    }
    if (inputValue.timeout_ms != null) {
      const n = Number(inputValue.timeout_ms);
      if (!Number.isInteger(n) || n < 100 || n > 120000) {
        out.push("tool.exec input.timeout_ms must be an integer between 100 and 120000.");
      }
    }
    return out;
  }

  if (t === "data.fetch") {
    if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) {
      return ["data.fetch input must be a JSON object."];
    }
    const out = [];
    const urlRaw = asString(inputValue.url, 4000);
    if (!urlRaw) {
      out.push("data.fetch requires input.url.");
    } else {
      try {
        const u = new URL(urlRaw);
        if (u.protocol !== "https:") out.push("data.fetch input.url must use https://");
      } catch {
        out.push("data.fetch input.url must be a valid absolute URL.");
      }
    }
    if (inputValue.timeout_ms != null) {
      const n = Number(inputValue.timeout_ms);
      if (!Number.isInteger(n) || n < 200 || n > 120000) {
        out.push("data.fetch input.timeout_ms must be an integer between 200 and 120000.");
      }
    }
    if (inputValue.max_bytes != null) {
      const n = Number(inputValue.max_bytes);
      if (!Number.isInteger(n) || n < 512 || n > 1048576) {
        out.push("data.fetch input.max_bytes must be an integer between 512 and 1048576.");
      }
    }
    return out;
  }

  if (t === "data.file_read") {
    if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) {
      return ["data.file_read input must be a JSON object."];
    }
    const out = [];
    const filePath = asString(inputValue.path || inputValue.file_path, 2000);
    if (!filePath) out.push("data.file_read requires input.path.");
    if (inputValue.max_bytes != null) {
      const n = Number(inputValue.max_bytes);
      if (!Number.isInteger(n) || n < 512 || n > 1048576) {
        out.push("data.file_read input.max_bytes must be an integer between 512 and 1048576.");
      }
    }
    return out;
  }

  if (t === "tools.web_search") {
    if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) {
      return ["tools.web_search input must be a JSON object."];
    }
    const out = [];
    const query = asString(inputValue.query || inputValue.q, 500);
    if (!query) out.push("tools.web_search requires input.query.");
    if (inputValue.provider != null) {
      const provider = asString(inputValue.provider, 40).toLowerCase();
      if (!provider || (provider !== "duckduckgo" && provider !== "brave")) {
        out.push("tools.web_search input.provider must be one of: duckduckgo, brave.");
      }
    }
    if (inputValue.max_results != null) {
      const n = Number(inputValue.max_results);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        out.push("tools.web_search input.max_results must be an integer between 1 and 20.");
      }
    }
    if (inputValue.timeout_ms != null) {
      const n = Number(inputValue.timeout_ms);
      if (!Number.isInteger(n) || n < 200 || n > 120000) {
        out.push("tools.web_search input.timeout_ms must be an integer between 200 and 120000.");
      }
    }
    return out;
  }

  if (t === "tools.file_search") {
    if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) {
      return ["tools.file_search input must be a JSON object."];
    }
    const out = [];
    const query = asString(inputValue.query || inputValue.q || inputValue.name, 240);
    if (!query) out.push("tools.file_search requires input.query.");
    const dirPath = asString(inputValue.path || inputValue.base_path || ".", 2000);
    if (!dirPath) out.push("tools.file_search requires a non-empty input.path.");
    if (inputValue.max_results != null) {
      const n = Number(inputValue.max_results);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        out.push("tools.file_search input.max_results must be an integer between 1 and 200.");
      }
    }
    return out;
  }

  if (t === "tools.find_in_files") {
    if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) {
      return ["tools.find_in_files input must be a JSON object."];
    }
    const out = [];
    const query = asString(inputValue.query || inputValue.q || inputValue.pattern, 500);
    if (!query) out.push("tools.find_in_files requires input.query.");
    if (inputValue.files != null) {
      if (!Array.isArray(inputValue.files)) {
        out.push("tools.find_in_files input.files must be an array of paths.");
      } else {
        if (inputValue.files.length > 500) out.push("tools.find_in_files input.files supports at most 500 entries.");
        for (const item of inputValue.files) {
          const filePath = asString(item, 2000);
          if (!filePath) out.push("tools.find_in_files input.files entries must be non-empty paths.");
        }
      }
    }
    if (inputValue.max_results != null) {
      const n = Number(inputValue.max_results);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        out.push("tools.find_in_files input.max_results must be an integer between 1 and 500.");
      }
    }
    if (inputValue.max_bytes_per_file != null) {
      const n = Number(inputValue.max_bytes_per_file);
      if (!Number.isInteger(n) || n < 512 || n > 2 * 1024 * 1024) {
        out.push("tools.find_in_files input.max_bytes_per_file must be an integer between 512 and 2097152.");
      }
    }
    if (inputValue.max_scanned != null) {
      const n = Number(inputValue.max_scanned);
      if (!Number.isInteger(n) || n < 100 || n > 50000) {
        out.push("tools.find_in_files input.max_scanned must be an integer between 100 and 50000.");
      }
    }
    if (inputValue.regex != null && typeof inputValue.regex !== "boolean") {
      out.push("tools.find_in_files input.regex must be boolean.");
    }
    if (inputValue.case_sensitive != null && typeof inputValue.case_sensitive !== "boolean") {
      out.push("tools.find_in_files input.case_sensitive must be boolean.");
    }
    if (inputValue.include_hidden != null && typeof inputValue.include_hidden !== "boolean") {
      out.push("tools.find_in_files input.include_hidden must be boolean.");
    }
    return out;
  }

  if (t === "workflow.run") {
    if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) {
      return ["workflow.run input must be a JSON object."];
    }
    const out = [];
    const workflow = asString(inputValue.workflow || inputValue.name, 240);
    if (!workflow) out.push("workflow.run requires input.workflow.");
    if (inputValue.params != null && (!inputValue.params || typeof inputValue.params !== "object" || Array.isArray(inputValue.params))) {
      out.push("workflow.run input.params must be an object.");
    }
    if (inputValue.vars != null && (!inputValue.vars || typeof inputValue.vars !== "object" || Array.isArray(inputValue.vars))) {
      out.push("workflow.run input.vars must be an object.");
    }
    return out;
  }

  return [];
}
