const HELP_TEXT = `RauskuClaw CLI

Usage:
  rauskuclaw <command> [options]

Commands:
  setup [--non-interactive] [--force] [--set KEY=VALUE]
  start [--build] [--detach] [--json]
  stop [--json]
  restart [--build] [--json]
  status [--json]
  logs <api|worker|ui> [--tail N] [--follow] [--since 10m] [--security] [--json]
  smoke [--suite m1|m3|m4] [--success] [--json]
  memory reset --yes [--scope <scope>] [--api <baseUrl>] [--json]
  auth whoami [--api <baseUrl>] [--json]
  doctor [--json] [--fix-hints]
  codex <login|logout|exec ...> [codex flags...]
  config [show|validate|path] [--json]
  help
  version
`;

function runHelp() {
  process.stdout.write(HELP_TEXT);
  return 0;
}

module.exports = { runHelp, HELP_TEXT };
