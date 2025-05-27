import { ObjectId } from "mongoose";
import { Topic, TopicData } from "../types/events.types";
import { Topics } from "./models/topics.model";

class TopicsRepository {
  async insertTopic(topic: Topic) {
    return await Topics.insertOne(topic);
  }
  async insertManyTopics(topics: Topic[]) {
    return await Topics.insertMany(topics);
  }
  async findTopicByIdOrName(name: String, id?: ObjectId) {
    const query: any = {};
    if (name) query.name = name;
    if (id) query._id = id;
    return await Topics.findOne(query);
  }
  async findAllTopics() {
    return await Topics.find();
  }
  /**
   * @description To add quotes to a given topic
   * @param name Topic name
   * @param quotes Quote(s) to be added
   * @returns Updated Topic Document
   */
  async UpdateQuotesInTopic(name, quotes: [TopicData]) {
    return Topics.findOneAndUpdate(
      { name },
      {
        $addToSet: { data: { $each: quotes } },
      },
      {
        new: true,
      }
    );
  }
  async findTopicQuoteByIndex(name: String, index: number) {
    const retrievedTopic: Topic = await Topics.findOne(
      { name },
      { data: { $slice: [index, 1] } }
    );
    return retrievedTopic?.data || null;
  }
}

export const topicsRepository = new TopicsRepository();
