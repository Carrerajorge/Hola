const originalExit = process.exit;
process.exit = function(code) {
  console.error("============= PROCESS.EXIT INTERCEPTED =============");
  console.error("Exit code:", code);
  console.error(new Error().stack);
  console.error("====================================================");
  return originalExit.call(this, code);
};

process.on('unhandledRejection', (reason, promise) => {
  console.error("============= UNHANDLED REJECTION =============");
  console.error("Promise:", promise);
  console.error("Reason:", reason);
  console.error(reason && reason.stack ? reason.stack : "");
  console.error("===============================================");
});

process.on('uncaughtException', (err) => {
  console.error("============= UNCAUGHT EXCEPTION =============");
  console.error(err);
  console.error("==============================================");
});

import("./server/index.ts").then(() => {
  console.log("Loaded successfully");
}).catch(e => {
  console.error("LOAD ERROR CAUGHT:", e);
});
