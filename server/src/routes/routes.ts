// const eventsRoute = require("./events.route.ts");
// router.use("/users", "./users.route.ts");

import express from "express";
import { topicsRouter } from "./topics.route";

const router = express.Router();
// router.use("/events", eventsRoute);
// const router = require("express").Router();
// const topicsRoute = require("./topics.route.ts");
router.use("/topics", topicsRouter);

export { router };
