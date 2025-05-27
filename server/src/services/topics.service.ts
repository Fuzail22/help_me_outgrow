import { ObjectId } from "mongoose";
import { Topics } from "../repository/models/topics.model";
import { topicsRepository } from "../repository/topics.repository";
import { Topic, TopicData } from "../types/events.types";
import { Result } from "../types/generic.types.";

const addNewTopic = async (topic: Topic): Promise<Result> => {
  try {
    let createdTopic = await topicsRepository.insertTopic(topic);
    return { success: true, data: createdTopic };
  } catch (err) {
    console.error("Error during topic creation", err);
    return { success: false, data: err.message };
  }
};

const bulkAddTopics = async (topics: Topic[]) => {
  try {
    const createdTopics = await topicsRepository.insertManyTopics(topics);
    return { success: true, data: createdTopics };
  } catch (err) {
    console.error("Error during bulk addition of topics", err);
    return { success: false, data: err.message };
  }
};

const getTopic = async (name: String, id?: ObjectId) => {
  try {
    let topicRetrived = await topicsRepository.findTopicByIdOrName(name, id);
    return { success: true, data: topicRetrived };
  } catch (err) {
    return { success: false, data: err.message };
  }
};

const getTopicQuoteByIndex = async (topic: String, index: number) => {
  try {
    const quote = await topicsRepository.findTopicQuoteByIndex(topic, index);
    if (!quote) {
      return { success: false, data: "Quote not found" };
    } else {
      return { success: true, data: quote };
    }
  } catch (err) {
    console.error("Error while retrieving quote by index", err);
    return { success: false, data: err.message };
  }
};

const addQuotesToTopic = async (name: String, quotes: [TopicData]) => {
  try {
    const updatedTopic = await topicsRepository.UpdateQuotesInTopic(
      name,
      quotes
    );
    return { success: true, data: updatedTopic };
  } catch (err) {
    return { success: false, data: err.message };
  }
};
export {
  addNewTopic,
  bulkAddTopics,
  getTopic,
  getTopicQuoteByIndex,
  addQuotesToTopic,
};
