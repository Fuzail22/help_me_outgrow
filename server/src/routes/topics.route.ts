import express from "express";
import { getTopics, postTopic } from "../controllers/topics.controller";

const topicsRouter = express.Router();
topicsRouter.get("/:id", getTopics);
topicsRouter.post("/", postTopic);
export { topicsRouter };
