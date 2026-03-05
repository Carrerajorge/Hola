"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = createLogger;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
function createLogger(logFilePath) {
    const resolved = path_1.default.resolve(logFilePath);
    fs_extra_1.default.ensureDirSync(path_1.default.dirname(resolved));
    return {
        info(payload) {
            writeLine(resolved, "info", payload);
        },
        error(payload) {
            writeLine(resolved, "error", payload);
        },
    };
}
function writeLine(filePath, level, payload) {
    const record = {
        ts: new Date().toISOString(),
        level,
        ...payload,
    };
    fs_extra_1.default.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
}
