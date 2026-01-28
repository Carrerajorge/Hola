const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'creditCard', 'cvv', 'apiKey', 'access_token', 'refresh_token'];

export function redactSensitiveData(data: any): any {
    if (!data) return data;
    if (typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map(redactSensitiveData);

    const redacted = { ...data };
    for (const key of Object.keys(redacted)) {
        if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
            redacted[key] = '[REDACTED]';
        } else if (typeof redacted[key] === 'object') {
            redacted[key] = redactSensitiveData(redacted[key]);
        }
    }
    return redacted;
}
