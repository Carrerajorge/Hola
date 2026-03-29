import { exec } from "child_process";
exec('osascript -e \'choose folder with prompt "Select a folder"\' -e \'POSIX path of result\'', (error, stdout) => {
  console.log(stdout.trim());
});
