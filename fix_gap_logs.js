const fs = require('fs');
let code = fs.readFileSync('server/storage.ts', 'utf8');

code = code.replace(/log.userId \? eq\(agentGapLogs.userId, log.userId\) : isNull\(agentGapLogs.userId\)/g, "undefined /* no userId */");
code = code.replace(/eq\(agentGapLogs.userId, log.userId\)/g, "undefined /* no userId */");
code = code.replace(/eq\(agentGapLogs.userId, userId\)/g, "sql\`1=1\` /* no userId */");
code = code.replace(/log\.userId/g, "undefined"); // Wait, let's just use sed

fs.writeFileSync('server/storage.ts', code);
