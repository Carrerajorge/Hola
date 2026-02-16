# IliaGPT API Documentation

## Base URL
```
https://iliagpt.com/api
```

## Authentication

Most endpoints require authentication. Use session-based auth or Bearer tokens.

### Endpoints

#### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login with email/password |
| GET | `/auth/session` | Get current session |
| POST | `/auth/logout` | Logout |
| POST | `/auth/phone/send-code` | Send OTP to phone |
| POST | `/auth/phone/verify` | Verify phone OTP |
| GET | `/auth/google` | Google OAuth redirect |
| GET | `/auth/google/callback` | Google OAuth callback |

#### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/chat` | Send chat message (streaming) |
| GET | `/chats` | List user chats |
| GET | `/chats/:id` | Get chat by ID |
| DELETE | `/chats/:id` | Delete chat |

#### Models
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/models` | List available AI models |

#### Tools
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tools` | List all 100 available tools |

#### GPTs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/gpts` | List public GPTs |
| GET | `/gpts/:id` | Get GPT details |
| POST | `/gpts` | Create custom GPT |

#### Memory (Semantic)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/memory/semantic/search` | Semantic memory search |
| POST | `/memory/semantic/remember` | Store new memory |
| GET | `/memory/semantic/recall` | List all memories |
| DELETE | `/memory/semantic/:id` | Delete memory |
| GET | `/memory/semantic/stats` | Memory statistics |

#### Context
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/context/metrics` | Cache metrics |
| GET | `/context/:chatId/health` | Context health |

#### Admin (requires admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/dashboard` | Dashboard stats |
| GET | `/admin/users` | List users |
| GET | `/admin/conversations` | List conversations |
| GET | `/admin/models` | List AI models |
| GET | `/admin/finance/payments` | List payments |
| GET | `/admin/finance/invoices` | List invoices |
| GET | `/admin/analytics` | Analytics data |
| GET | `/admin/security/config` | Security config |
| GET | `/admin/reports` | List reports |
| POST | `/admin/reports/generate` | Generate report |

## Request/Response Examples

### Chat Request
```json
POST /api/chat
{
  "messages": [
    { "role": "user", "content": "Hola, ¿cómo estás?" }
  ],
  "conversationId": "uuid",
  "provider": "xai",
  "model": "grok-4-1-fast-non-reasoning"
}
```

### Memory Search
```json
POST /api/memory/semantic/search
{
  "query": "preferencias del usuario",
  "limit": 10,
  "min_score": 0.3,
  "hybrid": true
}
```

### Response Format
```json
{
  "results": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

## Error Codes
| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Not authenticated |
| 403 | Forbidden - Not authorized |
| 404 | Not Found |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error |

## Rate Limits
- General: 60 requests/minute per IP
- Chat: 30 requests/minute per user
- Phone Auth: 5 codes/hour per phone

## Available AI Models

### xAI (Grok)
- `grok-4-1-fast-non-reasoning` (default)
- `grok-4-1-fast-reasoning`
- `grok-4-fast-non-reasoning`
- `grok-4-fast-reasoning`
- `grok-code-fast-1`
- `grok-4-0709`
- `grok-3-fast`
- `grok-2-vision-1212`

### Google Gemini
- `gemini-3-flash-preview`
- `gemini-2.5-flash`
- `gemini-2.5-pro`
