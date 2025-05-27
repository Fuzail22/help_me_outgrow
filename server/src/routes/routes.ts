// const eventsRoute = require("./events.route.ts");
// router.use("/users", "./users.route.ts");

import express from "express";
import { topicsRouter } from "./topics.route";
import { eventsRouter } from "./events.route";
import { userRouter } from "./users.route";

const router = express.Router();

router.use("/topics", topicsRouter);
router.use("/events", eventsRouter);
router.use("/users", userRouter);

export { router };
