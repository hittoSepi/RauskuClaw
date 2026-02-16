const { startWorker } = require("./worker");

console.log("[openclaw-worker] starting worker loop");
startWorker();

// keep process alive
setInterval(() => {}, 1 << 30);
