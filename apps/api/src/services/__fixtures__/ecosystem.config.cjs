// Fixture used by findEcosystemFile detection test — mirrors ecosystem.valid.cjs.
module.exports = {
  apps: [
    {
      name: "web",
      script: "./build/index.js",
      env: { PORT: "3000", NODE_ENV: "production" },
    },
  ],
};
