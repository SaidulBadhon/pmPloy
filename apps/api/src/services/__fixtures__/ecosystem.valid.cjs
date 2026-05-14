module.exports = {
  apps: [
    {
      name: "web",
      script: "./build/index.js",
      env: { PORT: "3000", NODE_ENV: "production" },
    },
    {
      name: "worker",
      script: "./build/worker.js",
      instances: 2,
      exec_mode: "cluster",
    },
  ],
};
