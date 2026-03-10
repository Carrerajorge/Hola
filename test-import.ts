const originalExit = process.exit;
process.exit = function(code) {
  console.log("process.exit called with code:", code);
  console.log(new Error().stack);
  originalExit.apply(this, arguments);
};

import("./server/index.ts").then(() => {
  console.log("Loaded successfully");
}).catch(e => {
  console.error("LOAD ERROR CAUGHT:", e);
});
