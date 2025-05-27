import {
  addNewTopic,
  addQuotesToTopic,
  getTopicQuoteByIndex,
} from "../services/topics.service";
import { Topic } from "../types/events.types";
import { Result } from "../types/generic.types.";

const getTopics = (req, res) => {
  console.log("topics get");
  res.send("topics");
};
const postTopic = async (req, res) => {
  const topic: Topic = req.body;
  const result: Result = await addNewTopic(topic);
  if (result.success) {
    return res.status(201).send("Topic added successfully");
  } else {
    return res.status(500).send("Error during topic addition");
  }
};

const updateTopic = async (req, res) => {
  const { name, quotes } = req.body;
  const result: Result = await addQuotesToTopic(name, quotes);
  if (result.success) {
    return res.status(201).send("Quote(s) added successfully");
  } else return res.status(500).send("Error during quotes updation");
};

const getQuote = async (req, res) => {
  const { name, index } = req.body;
  const result = await getTopicQuoteByIndex(name, index);
  if (result.success) return res.status(200).json({ quote: result.data });
  else if (result.data.contains("not found"))
    return res.status(404).json(result.data);
  else return res.status(500).send("Error during quotes updation");
};
export { getTopics, postTopic };
