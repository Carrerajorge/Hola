import os from 'os';
import { execSync } from 'child_process';
import path from 'path';

const platform = os.platform();

if (platform === 'darwin') {
    // macOS: launchctl
    const plistSrc = path.join(__dirname, '..', 'native', 'com.iliagpt.hypervisor.plist');
    const plistDst = '/Library/LaunchDaemons/com.iliagpt.hypervisor.plist';
    execSync(`sudo cp "${plistSrc}" "${plistDst}"`);
    execSync(`sudo launchctl load "${plistDst}"`);
    console.log('✅ macOS LaunchDaemon installed');
} else if (platform === 'win32') {
    // Windows: NSSM or sc.exe
    const daemonPath = path.join(__dirname, '..', 'dist', 'daemon.cjs');
    const nodePath = process.execPath;
    execSync(`sc.exe create ILIAGPTDaemon binPath= "${nodePath} ${daemonPath}" start= auto DisplayName= "ILIAGPT Hypervisor Daemon"`);
    execSync(`sc.exe start ILIAGPTDaemon`);
    console.log('✅ Windows Service installed');
} else if (platform === 'linux') {
    // Linux: systemd
    const serviceContent = `[Unit]
Description=ILIAGPT Hypervisor Daemon
After=network.target

[Service]
Type=simple
User=root
ExecStart=${process.execPath} ${path.join(__dirname, '..', 'dist', 'daemon.cjs')}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target`;

    const fs = require('fs');
    fs.writeFileSync('/etc/systemd/system/iliagpt-daemon.service', serviceContent);
    execSync('systemctl daemon-reload');
    execSync('systemctl enable iliagpt-daemon');
    execSync('systemctl start iliagpt-daemon');
    console.log('✅ Linux systemd service installed');
}
