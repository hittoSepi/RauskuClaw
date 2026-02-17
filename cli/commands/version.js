const pkg = require("../../package.json");

function runVersion() {
  process.stdout.write(`${pkg.name} ${pkg.version}\n`);
  return 0;
}

module.exports = { runVersion };
