root@pmploy-test:/home/pmploy# su - pmploy -c 'cd ~/pmPloy/apps/web && /home/pmploy/.bun/bin/bun run build'
$ tsc -b && vite build
vite v6.4.2 building for production...
✓ 691 modules transformed.
dist/index.html                   0.40 kB │ gzip:   0.27 kB
dist/assets/index-N5gNf1sv.css   13.25 kB │ gzip:   3.22 kB
dist/assets/index-BDaD0Rm9.js   694.98 kB │ gzip: 197.69 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 8.74s
root@pmploy-test:/home/pmploy# systemctl restart pmploy-api
root@pmploy-test:/home/pmploy# 






















