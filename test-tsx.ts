export function createSubsystemLogger(subsystem: string) {
  function getFileLogger() {
    return subsystem;
  }
  return getFileLogger;
}
console.log(createSubsystemLogger("test")());
