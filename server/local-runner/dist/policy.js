"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkspaceRoot = validateWorkspaceRoot;
exports.resolveWorkspacePath = resolveWorkspacePath;
exports.sanitizeCommand = sanitizeCommand;
exports.isCommandAllowed = isCommandAllowed;
exports.isCommandDangerous = isCommandDangerous;
exports.createSafeEnv = createSafeEnv;
const fs_extra_1 = __importDefault(require("fs-extra"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const DENYLIST_SEGMENTS = [
    ".ssh",
    ".aws",
    ".gnupg",
    ".config/gcloud",
    ".config/gh",
    ".kube",
    ".npmrc",
    ".env",
    "id_rsa",
    "id_ed25519",
    "credentials",
];
function normalize(value) {
    return value.replace(/\\/g, "/");
}
async function validateWorkspaceRoot(workspaceInput) {
    if (!workspaceInput || !workspaceInput.trim()) {
        throw new Error("Workspace is required");
    }
    const expanded = expandHome(workspaceInput.trim());
    const resolved = path_1.default.resolve(expanded);
    const exists = await fs_extra_1.default.pathExists(resolved);
    if (!exists) {
        throw new Error(`Workspace does not exist: ${resolved}`);
    }
    const stats = await fs_extra_1.default.stat(resolved);
    if (!stats.isDirectory()) {
        throw new Error(`Workspace is not a directory: ${resolved}`);
    }
    const real = await fs_extra_1.default.realpath(resolved);
    if (isSensitive(real)) {
        throw new Error("Workspace cannot be a sensitive directory");
    }
    return real;
}
async function resolveWorkspacePath(workspaceRoot, requestedPath) {
    if (!requestedPath || !requestedPath.trim()) {
        throw new Error("Path is required");
    }
    const expanded = expandHome(requestedPath.trim());
    const lexical = path_1.default.isAbsolute(expanded)
        ? path_1.default.resolve(expanded)
        : path_1.default.resolve(workspaceRoot, expanded);
    if (!isWithinRoot(workspaceRoot, lexical)) {
        throw new Error("Access denied: path is outside of workspace");
    }
    if (isSensitive(lexical)) {
        throw new Error("Access denied: sensitive path is blocked");
    }
    await assertNoSymlinkTraversal(workspaceRoot, lexical);
    return lexical;
}
function sanitizeCommand(command) {
    return command.trim().replace(/\s+/g, " ");
}
function isCommandAllowed(command, allowlist) {
    const normalized = sanitizeCommand(command);
    if (!normalized) {
        return false;
    }
    return allowlist.some((allowed) => {
        const rule = sanitizeCommand(allowed);
        if (!rule) {
            return false;
        }
        return normalized === rule || normalized.startsWith(`${rule} `);
    });
}
function isCommandDangerous(command, dangerousList) {
    const normalized = sanitizeCommand(command);
    if (!normalized) {
        return false;
    }
    const firstToken = normalized.split(" ")[0];
    return dangerousList.some((entry) => {
        const rule = sanitizeCommand(entry);
        return rule === firstToken || normalized.startsWith(`${rule} `);
    });
}
function createSafeEnv(workspaceRoot) {
    return {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: os_1.default.homedir(),
        LANG: process.env.LANG ?? "en_US.UTF-8",
        TERM: process.env.TERM ?? "xterm",
        PWD: workspaceRoot,
        NODE_ENV: "production",
    };
}
function expandHome(input) {
    if (input === "~") {
        return os_1.default.homedir();
    }
    if (input.startsWith("~/")) {
        return path_1.default.join(os_1.default.homedir(), input.slice(2));
    }
    return input;
}
function isWithinRoot(root, candidate) {
    const relative = path_1.default.relative(root, candidate);
    if (!relative) {
        return true;
    }
    return !relative.startsWith("..") && !path_1.default.isAbsolute(relative);
}
function isSensitive(absolutePath) {
    const normalized = normalize(absolutePath);
    const homeNormalized = normalize(os_1.default.homedir());
    if (!normalized.startsWith(homeNormalized)) {
        return false;
    }
    const rel = normalized.slice(homeNormalized.length).replace(/^\//, "");
    return DENYLIST_SEGMENTS.some((segment) => {
        const s = normalize(segment).replace(/^\//, "");
        return rel === s || rel.startsWith(`${s}/`) || rel.includes(`/${s}/`);
    });
}
async function assertNoSymlinkTraversal(root, target) {
    const rel = path_1.default.relative(root, target);
    if (!rel) {
        return;
    }
    let current = root;
    for (const segment of rel.split(path_1.default.sep)) {
        current = path_1.default.join(current, segment);
        if (!(await fs_extra_1.default.pathExists(current))) {
            continue;
        }
        const stat = await fs_extra_1.default.lstat(current);
        if (stat.isSymbolicLink()) {
            throw new Error("Access denied: symlink traversal is blocked");
        }
    }
}
