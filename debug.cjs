const originalExit = process.exit;
process.exit = function(code) {
  console.error("process.exit called with code:", code);
  console.error(new Error().stack);
  originalExit.apply(this, arguments);
};
