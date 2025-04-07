import express from "express";
import { getTopics, postTopic } from "../controller/topics.controller";

const topicsRouter = express.Router();
topicsRouter.get("/", getTopics);
topicsRouter.post("/:id", postTopic);
export { topicsRouter };
