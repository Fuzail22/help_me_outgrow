import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import fs from "fs";
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // server: {
  //   https: {
  //     key: fs.readFileSync("./ssl/key.pem"),
  //     cert: fs.readFileSync("./ssl/cert.pem"),
  //   },
  //   host: "localhost", // Ensures it runs on localhost
  //   port: 5173, // Change if needed
  //   allowedHosts: [
  //     "3fd2-2405-201-e009-e809-9c86-5e37-be49-f744.ngrok-free.app",
  //     "f2d5-2405-201-e009-e809-eddc-c9c6-72fd-9e4d.ngrok-free.app",
  //   ],
  // },
});
