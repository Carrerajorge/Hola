eval "$(ssh-agent -s)"
./add_key.exp
ssh -o StrictHostKeyChecking=no root@69.62.98.126 "pm2 logs michat --lines 50 --nostream"
