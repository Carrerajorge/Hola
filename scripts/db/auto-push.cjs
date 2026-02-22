const { spawn } = require('child_process');

const child = spawn('npx', ['drizzle-kit', 'push'], {
    stdio: ['pipe', process.stdout, process.stderr],
    env: { ...process.env, DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iliagpt' }
});

process.stdout.write('Running auto-pusher...\n');

// Listen for stdout from drizzle-kit to detect prompts
child.stdout.on('data', (data) => {
    const output = data.toString();
    // If it's asking a question, hit enter
    if (output.includes('❯')) {
        process.stdout.write('Answering prompt...\n');
        child.stdin.write('\n');
    }
});

child.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
    process.exit(code);
});
