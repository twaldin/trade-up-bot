const path = require("path");

// Cluster + wait_ready so `pm2 reload api` keeps the previous worker on port
// 3001 until this process finishes the calculator warm and calls listen.
// listen_timeout must stay above CALCULATOR_WARM_LIMIT_MS in server/boot-ready.ts.
// No secrets here — pm2 start inherits the running app environment.
module.exports = {
  apps: [
    {
      name: "api",
      cwd: path.resolve(__dirname),
      script: "server/index.ts",
      interpreter: "node",
      node_args: "--import tsx",
      exec_mode: "cluster",
      instances: 1,
      wait_ready: true,
      listen_timeout: 60000,
      kill_timeout: 10000,
    },
  ],
};
