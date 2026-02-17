#!/usr/bin/env node

const { runCli } = require("../cli/index");

runCli(process.argv.slice(2))
  .then((code) => {
    process.exit(Number.isInteger(code) ? code : 0);
  })
  .catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    console.error(`[rauskuclaw] ${msg}`);
    process.exit(1);
  });
