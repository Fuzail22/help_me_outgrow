import { Topics } from "../data/models/topics.model";

const addNewTopic = (topic) => {
  let topicCreated;
  //CONTIINUE CHECKING COPILOT
  Topics.insertOne(topic)
    .then((res) => res)
    .catch((err) => console.log("Err during topic creation"));
};
