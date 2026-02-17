const { startWorker } = require("./worker");

console.log("[rauskuclaw-worker] starting worker loop");
startWorker();

// keep process alive
setInterval(() => {}, 1 << 30);
