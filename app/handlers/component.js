const DEFAULT_COMPONENT_NAME = "Component";
const NAME_PATTERN = /^[A-Z][A-Za-z0-9]{0,79}$/;

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizeComponentName(rawName) {
  const name = clampText(rawName, 80) || DEFAULT_COMPONENT_NAME;
  if (!NAME_PATTERN.test(name)) {
    throw new Error("component_name must match ^[A-Z][A-Za-z0-9]{0,79}$");
  }
  return name;
}

function normalizeFramework(raw) {
  const fw = clampText(raw, 20).toLowerCase() || "vue";
  if (fw !== "vue" && fw !== "react") {
    throw new Error("framework must be one of: vue, react");
  }
  return fw;
}

function normalizeLanguage(raw) {
  const lang = clampText(raw, 10).toLowerCase() || "ts";
  if (lang !== "ts" && lang !== "js") {
    throw new Error("language must be one of: ts, js");
  }
  return lang;
}

function buildVueContent(name, lang) {
  const scriptTag = lang === "ts" ? `<script setup lang="ts">` : "<script setup>";
  const typeHint = lang === "ts" ? "const title: string" : "const title";
  return `<template>
  <section class="${name.toLowerCase()}">
    <h2>{{ title }}</h2>
  </section>
</template>

${scriptTag}
${typeHint} = "${name}";
</script>

<style scoped>
.${name.toLowerCase()} {
  padding: 12px;
}
</style>
`;
}

function buildReactContent(name, lang) {
  const ext = lang === "ts" ? "tsx" : "jsx";
  const propType = lang === "ts"
    ? "type Props = { title?: string };\n\nexport function "
    : "export function ";
  const fnSig = lang === "ts"
    ? `${name}({ title = "${name}" }: Props) {\n`
    : `${name}({ title = "${name}" }) {\n`;
  const typeTail = lang === "ts" ? "" : "";
  const content = `${propType}${fnSig}  return (
    <section className="${name.toLowerCase()}">
      <h2>{title}</h2>
    </section>
  );
}
`;
  return { ext, content: content + typeTail };
}

function generateComponentFiles(input) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("code.component.generate input must be an object");
  }
  const safeInput = input || {};
  const componentName = normalizeComponentName(safeInput.component_name);
  const framework = normalizeFramework(safeInput.framework);
  const language = normalizeLanguage(safeInput.language);

  if (framework === "vue") {
    return {
      component_name: componentName,
      framework,
      language,
      files: [
        {
          path: `${componentName}.vue`,
          content: buildVueContent(componentName, language)
        }
      ]
    };
  }

  const react = buildReactContent(componentName, language);
  return {
    component_name: componentName,
    framework,
    language,
    files: [
      {
        path: `${componentName}.${react.ext}`,
        content: react.content
      }
    ]
  };
}

module.exports = {
  generateComponentFiles
};
