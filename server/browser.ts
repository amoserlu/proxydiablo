import fs from 'node:fs';
import { spawn } from 'node:child_process';

const windowsCommand = '/mnt/c/Windows/System32/cmd.exe';

export function openBrowser(url: string): void {
  const command = fs.existsSync(windowsCommand) ? windowsCommand : 'xdg-open';
  const args = command === windowsCommand ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}
