import express from "express";
import { router } from "./routes/routes";
import {
  generateVapid,
  sendNotification,
  setVapidDetails,
} from "./utils/web-push.utils";
import dotenv from "dotenv";
// import "dotenv/config";

const envFile = `.env.${process.env.NODE_ENV || "dev"}`;
dotenv.config({ path: envFile });
// console.log({ envFile });
const app = express();
const port = 5000;

app.use("/", router);
app.listen(port, () => {
  console.log("listening @a", port);
});
// setVapidDetails("fuzailhaariss@gmail.com", "");
// console.log(generateVapid());
// console.log(process.env.PUBLIC_KEY, process.env.SUBSCRIPTION);
setVapidDetails(
  "fuzailhaariss@gmail.com",
  process.env.PUBLIC_KEY,
  process.env.PRIVATE_KEY
);
const subscription = JSON.parse(process.env.SUBSCRIPTION);
console.log({ subscription });
sendNotification(
  subscription,
  JSON.stringify({
    title: "New Offer!",
    body: "Click to get a 50% discount!",
    data: {
      url: "https://www.google.com/",
    },
    actions: [
      {
        action: "open_url",
        title: "Open Now",
      },
    ],
  })
);
