process.on('unhandledRejection', (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  console.error(reason && reason.stack ? reason.stack : "");
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

import("./server/index.ts").then(() => {
  console.log("Loaded successfully");
}).catch(e => {
  console.error("LOAD ERROR CAUGHT:", e);
});
