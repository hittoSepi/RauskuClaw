import React from "react";
import { Box, Text, render } from "ink";
import logoModule from "./logo.js";

const { RAUSKU_LOGO } = logoModule;
const h = React.createElement;

function Header({ command }) {
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    h(Text, { color: "cyanBright" }, RAUSKU_LOGO),
    h(Text, { color: "green" }, `RauskuClaw CLI • ${command}`)
  );
}

export async function renderCommandHeader({ command }) {
  const app = render(h(Header, { command }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  app.unmount();
}
