<<<<<<< HEAD
import express from "express";
import { getTopics, postTopic } from "../controller/topics.controller";

const eventsRouter = express.Router();
eventsRouter.get("/", getTopics);
eventsRouter.post("/:id", postTopic);
export { eventsRouter };
=======
import express from "express";
import { getTopics, postTopic } from "../controllers/topics.controller";

const eventsRouter = express.Router();
eventsRouter.get("/", getTopics);
eventsRouter.post("/:id", postTopic);
export { eventsRouter };
>>>>>>> master
