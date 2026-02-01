# Refactoring Guide - Large Files

## Files Needing Refactoring

### 1. chat-interface.tsx (5,878 lines)

**Split into:**
- `ChatInterface.tsx` - Main container (200 lines)
- `hooks/useChatState.ts` - State management
- `hooks/useChatActions.ts` - Actions (already exists)
- `hooks/useSpeechRecognition.ts` - Voice input
- `components/ChatInput.tsx` - Input area
- `components/ChatHeader.tsx` - Header (already exists)
- `components/MessageActions.tsx` - Message action buttons
- `components/AttachmentUploader.tsx` - File uploads
- `components/VoiceMode.tsx` - Voice chat mode

### 2. admin.tsx (5,013 lines)

**Split into:**
- `AdminLayout.tsx` - Layout wrapper (100 lines)
- `tabs/DashboardTab.tsx` - Dashboard
- `tabs/UsersTab.tsx` - Users management
- `tabs/ConversationsTab.tsx` - Conversations
- `tabs/ModelsTab.tsx` - AI Models
- `tabs/PaymentsTab.tsx` - Payments
- `tabs/InvoicesTab.tsx` - Invoices
- `tabs/AnalyticsTab.tsx` - Analytics
- `tabs/DatabaseTab.tsx` - Database
- `tabs/SecurityTab.tsx` - Security
- `tabs/ReportsTab.tsx` - Reports
- `tabs/SettingsTab.tsx` - Settings

### 3. spreadsheet-editor.tsx (2,744 lines)

**Split into:**
- `SpreadsheetEditor.tsx` - Main (300 lines)
- `components/SpreadsheetToolbar.tsx`
- `components/SpreadsheetGrid.tsx`
- `components/SpreadsheetCell.tsx`
- `components/FormulaBar.tsx`
- `hooks/useSpreadsheetState.ts`
- `hooks/useSpreadsheetFormulas.ts`

### 4. storage.ts (2,633 lines)

**Split into:**
- `storage/index.ts` - Main exports
- `storage/users.ts` - User operations
- `storage/chats.ts` - Chat operations
- `storage/payments.ts` - Payment operations
- `storage/admin.ts` - Admin operations
- `storage/analytics.ts` - Analytics operations

## Priority

1. **High**: admin.tsx → tabs (quick win, each tab is independent)
2. **High**: storage.ts → modules (reduces complexity)
3. **Medium**: chat-interface.tsx (more complex, needs careful refactoring)
4. **Low**: spreadsheet-editor.tsx (specialized component)

## Notes

- Keep backward compatibility during refactoring
- Create aliases for old imports
- Add unit tests before refactoring
- Refactor in small PRs
