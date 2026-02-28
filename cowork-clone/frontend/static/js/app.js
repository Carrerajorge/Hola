/**
 * Cowork Clone - Frontend Application
 * Handles chat, file browsing, WebSocket communication, and UI updates.
 */

// ─── State ──────────────────────────────────────────────
const state = {
    sessionId: generateId(),
    workspacePath: '',
    isConnected: false,
    isProcessing: false,
    messages: [],
    tasks: [],
    currentPath: '.',
    ws: null,
};

// ─── Utilities ──────────────────────────────────────────
function generateId() {
    return 'session-' + Math.random().toString(36).substr(2, 9);
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(date) {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    if (!text) return '';
    // Simple markdown formatting
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
}

function getFileIcon(item) {
    if (item.is_dir) return '📁';
    const ext = (item.extension || '').toLowerCase();
    const iconMap = {
        '.py': '🐍', '.js': '📜', '.ts': '📜', '.html': '🌐', '.css': '🎨',
        '.json': '📋', '.md': '📝', '.txt': '📄', '.pdf': '📕', '.doc': '📘',
        '.docx': '📘', '.xls': '📊', '.xlsx': '📊', '.ppt': '📙', '.pptx': '📙',
        '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️', '.svg': '🖼️',
        '.mp4': '🎬', '.mp3': '🎵', '.zip': '📦', '.rar': '📦',
        '.csv': '📊', '.xml': '📋', '.yml': '⚙️', '.yaml': '⚙️',
    };
    return iconMap[ext] || '📄';
}

// ─── DOM Elements ───────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const messagesArea = $('#messages-area');
const chatInput = $('#chat-input');
const sendBtn = $('#send-btn');
const fileBrowser = $('#file-browser-list');
const providerDot = $('#provider-dot');
const providerText = $('#provider-text');
const workspacePath = $('#workspace-path');

// ─── WebSocket Connection ───────────────────────────────
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${state.sessionId}`;

    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
        state.isConnected = true;
        updateConnectionStatus(true);
        console.log('WebSocket connected');
    };

    state.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    state.ws.onclose = () => {
        state.isConnected = false;
        updateConnectionStatus(false);
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };

    state.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'thinking':
            showTypingIndicator(data.data.message);
            break;
        case 'text':
            appendToLastAssistantMessage(data.data.content);
            break;
        case 'tool_start':
            addToolActivity(data.data.tool, 'running', data.data.args);
            break;
        case 'tool_result':
            updateToolActivity(data.data.tool, 'done');
            break;
        case 'tool_error':
            updateToolActivity(data.data.tool, 'error');
            break;
        case 'task_update':
            updateTaskProgress(data.data);
            break;
        case 'response':
            hideTypingIndicator();
            if (data.data.message) {
                addMessage('assistant', data.data.message, data.data.files_affected);
            }
            state.isProcessing = false;
            updateUIState();
            refreshFileBrowser();
            break;
    }
}

function updateConnectionStatus(connected) {
    providerDot.className = 'provider-dot' + (connected ? '' : ' disconnected');
    providerText.textContent = connected ? 'Connected' : 'Disconnected';
}

// ─── Chat Functions ─────────────────────────────────────
async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || state.isProcessing) return;

    // Add user message
    addMessage('user', message);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    state.isProcessing = true;
    updateUIState();

    // Show typing
    showTypingIndicator('Thinking...');

    // Hide welcome screen
    const welcome = $('.welcome-screen');
    if (welcome) welcome.style.display = 'none';

    // Send via WebSocket or HTTP
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            type: 'chat',
            message: message,
        }));
    } else {
        // Fallback to HTTP
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    session_id: state.sessionId,
                    workspace_path: state.workspacePath || null,
                }),
            });
            const data = await response.json();
            hideTypingIndicator();
            addMessage('assistant', data.message, data.files_affected);
            state.isProcessing = false;
            updateUIState();
            refreshFileBrowser();
        } catch (error) {
            hideTypingIndicator();
            addMessage('assistant', `Error: ${error.message}. Make sure the server is running.`);
            state.isProcessing = false;
            updateUIState();
        }
    }
}

function addMessage(role, content, filesAffected = []) {
    const msg = { role, content, time: new Date(), filesAffected };
    state.messages.push(msg);
    renderMessage(msg);
    scrollToBottom();
}

function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;

    const avatar = msg.role === 'user' ? '👤' : '🤖';
    const sender = msg.role === 'user' ? 'You' : 'Cowork AI';

    let filesHtml = '';
    if (msg.filesAffected && msg.filesAffected.length > 0) {
        filesHtml = `
            <div class="files-affected">
                ${msg.filesAffected.map(f => `<span class="file-badge">📄 ${escapeHtml(f)}</span>`).join('')}
            </div>
        `;
    }

    div.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-body">
            <div class="message-header">
                <span class="message-sender">${sender}</span>
                <span class="message-time">${formatTime(msg.time)}</span>
            </div>
            <div class="message-content">${formatMarkdown(msg.content)}</div>
            ${filesHtml}
        </div>
    `;

    messagesArea.appendChild(div);
}

function appendToLastAssistantMessage(text) {
    const messages = messagesArea.querySelectorAll('.message.assistant');
    if (messages.length > 0) {
        const last = messages[messages.length - 1];
        const contentEl = last.querySelector('.message-content');
        if (contentEl) {
            contentEl.innerHTML += escapeHtml(text);
        }
    }
}

function showTypingIndicator(text) {
    hideTypingIndicator();
    const div = document.createElement('div');
    div.id = 'typing-indicator';
    div.className = 'message assistant';
    div.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-body">
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <span style="margin-left: 8px; font-size: 13px; color: var(--text-muted)">${escapeHtml(text)}</span>
            </div>
        </div>
    `;
    messagesArea.appendChild(div);
    scrollToBottom();
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

function addToolActivity(tool, status, args) {
    const div = document.createElement('div');
    div.className = 'tool-activity';
    div.id = `tool-${tool}-${Date.now()}`;
    const argsStr = args ? `: ${JSON.stringify(args).substring(0, 80)}` : '';
    div.innerHTML = `
        <span class="tool-name">⚡ ${tool}</span>
        <span>${argsStr}</span>
    `;
    messagesArea.appendChild(div);
    scrollToBottom();
}

function updateToolActivity(tool, status) {
    // Just visual feedback - could be expanded
}

function updateTaskProgress(data) {
    // Could render a task progress widget
    const existing = document.getElementById('task-progress');
    if (!existing) {
        const div = document.createElement('div');
        div.id = 'task-progress';
        div.className = 'task-progress';
        div.innerHTML = `<div class="task-progress-title">📋 Task Progress</div><div id="task-list"></div>`;
        messagesArea.appendChild(div);
    }

    const taskList = document.getElementById('task-list');
    if (taskList) {
        const iconClass = data.status === 'completed' ? 'completed' : 'in-progress';
        const icon = data.status === 'completed' ? '✓' : '⏳';
        const item = document.createElement('div');
        item.className = 'task-item';
        item.innerHTML = `
            <div class="task-icon ${iconClass}">${icon}</div>
            <span class="task-text ${data.status}">${escapeHtml(data.action)}</span>
        `;
        taskList.appendChild(item);
    }
    scrollToBottom();
}

function scrollToBottom() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function updateUIState() {
    sendBtn.disabled = state.isProcessing;
    chatInput.disabled = state.isProcessing;
    if (!state.isProcessing) {
        chatInput.focus();
    }
}

// ─── File Browser ───────────────────────────────────────
async function refreshFileBrowser() {
    try {
        const response = await fetch(`/api/workspace/browse?path=${encodeURIComponent(state.currentPath)}&session_id=${state.sessionId}`);
        const data = await response.json();
        renderFileBrowser(data.files);
    } catch (error) {
        fileBrowser.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 13px;">Unable to load files</div>';
    }
}

function renderFileBrowser(files) {
    if (!files || files.length === 0) {
        fileBrowser.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 13px;">Empty folder</div>';
        return;
    }

    // Sort: directories first, then files
    files.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return b.is_dir - a.is_dir;
        return a.name.localeCompare(b.name);
    });

    fileBrowser.innerHTML = '';

    // Add parent directory link if not at root
    if (state.currentPath !== '.') {
        const parentDiv = document.createElement('div');
        parentDiv.className = 'file-item';
        parentDiv.innerHTML = `
            <span class="file-icon folder">📁</span>
            <span class="file-name">..</span>
        `;
        parentDiv.onclick = () => navigateToFolder('..');
        fileBrowser.appendChild(parentDiv);
    }

    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'file-item';
        const icon = getFileIcon(file);
        const iconClass = file.is_dir ? 'folder' : 'file';

        div.innerHTML = `
            <span class="file-icon ${iconClass}">${icon}</span>
            <span class="file-name" title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</span>
            <span class="file-size">${file.is_dir ? '' : formatSize(file.size)}</span>
        `;

        if (file.is_dir) {
            div.onclick = () => navigateToFolder(file.path);
        }

        fileBrowser.appendChild(div);
    });
}

function navigateToFolder(path) {
    if (path === '..') {
        const parts = state.currentPath.split('/');
        parts.pop();
        state.currentPath = parts.length > 0 ? parts.join('/') : '.';
    } else {
        state.currentPath = path;
    }
    refreshFileBrowser();
}

// ─── Workspace Info ─────────────────────────────────────
async function loadWorkspaceInfo() {
    try {
        const response = await fetch(`/api/workspace/info?session_id=${state.sessionId}`);
        const data = await response.json();
        workspacePath.textContent = data.path.split('/').pop() || data.path;
        workspacePath.title = data.path;
        state.workspacePath = data.path;
    } catch (error) {
        workspacePath.textContent = 'Not connected';
    }
}

// ─── Quick Actions ──────────────────────────────────────
function handleQuickAction(action) {
    const prompts = {
        organize: "Please analyze and organize all the files in this workspace by their type (documents, images, code, etc.)",
        analyze: "Give me a detailed overview of this workspace - what files are here, how they're organized, and any suggestions for improvement",
        cleanup: "Find any duplicate files, empty folders, or unnecessary files in this workspace and suggest what to clean up",
        create: "Create a well-organized project structure with README, docs, and src folders"
    };
    if (prompts[action]) {
        chatInput.value = prompts[action];
        sendMessage();
    }
}

// ─── Settings Modal ─────────────────────────────────────
function openSettings() {
    $('#settings-modal').classList.add('active');
}

function closeSettings() {
    $('#settings-modal').classList.remove('active');
}

async function saveSettings() {
    const path = $('#settings-workspace').value.trim();
    if (path) {
        try {
            const response = await fetch('/api/workspace/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });
            if (response.ok) {
                state.workspacePath = path;
                closeSettings();
                refreshFileBrowser();
                loadWorkspaceInfo();
            }
        } catch (error) {
            alert('Error setting workspace: ' + error.message);
        }
    }
    closeSettings();
}

async function resetSession() {
    if (confirm('Reset conversation? This will clear all chat history.')) {
        try {
            await fetch(`/api/session/reset?session_id=${state.sessionId}`, { method: 'POST' });
            state.messages = [];
            messagesArea.innerHTML = '';
            renderWelcomeScreen();
        } catch (error) {
            console.error('Reset error:', error);
        }
    }
}

// ─── Welcome Screen ─────────────────────────────────────
function renderWelcomeScreen() {
    messagesArea.innerHTML = `
        <div class="welcome-screen">
            <div class="welcome-icon">🤖</div>
            <h1 class="welcome-title">Cowork AI</h1>
            <p class="welcome-subtitle">
                Your intelligent file management assistant. I can read, organize, create, and manage files in your workspace. Tell me what you need!
            </p>
            <div class="quick-actions">
                <div class="quick-action" onclick="handleQuickAction('organize')">
                    <div class="quick-action-icon">📂</div>
                    <div class="quick-action-title">Organize Files</div>
                    <div class="quick-action-desc">Sort files into categorized folders</div>
                </div>
                <div class="quick-action" onclick="handleQuickAction('analyze')">
                    <div class="quick-action-icon">🔍</div>
                    <div class="quick-action-title">Analyze Workspace</div>
                    <div class="quick-action-desc">Get an overview of your files</div>
                </div>
                <div class="quick-action" onclick="handleQuickAction('cleanup')">
                    <div class="quick-action-icon">🧹</div>
                    <div class="quick-action-title">Clean Up</div>
                    <div class="quick-action-desc">Find duplicates and unused files</div>
                </div>
                <div class="quick-action" onclick="handleQuickAction('create')">
                    <div class="quick-action-icon">✨</div>
                    <div class="quick-action-title">Create Structure</div>
                    <div class="quick-action-desc">Set up an organized project</div>
                </div>
            </div>
        </div>
    `;
}

// ─── Event Listeners ────────────────────────────────────
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

chatInput.addEventListener('input', () => {
    // Auto-resize textarea
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
});

sendBtn.addEventListener('click', sendMessage);

// Close modal on outside click
$('#settings-modal').addEventListener('click', (e) => {
    if (e.target === $('#settings-modal')) closeSettings();
});

// ─── Initialize ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderWelcomeScreen();
    connectWebSocket();
    loadWorkspaceInfo();
    refreshFileBrowser();
});
