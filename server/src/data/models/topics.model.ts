// import { Schema } from "mongoose";

import { InferSchemaType, model, Schema } from "mongoose";
import { TopicType } from "../../types/events.types";

const TopicsSchema = new Schema({
  name: { type: String, enum: Object.values(TopicType), required: true },
  data: [{ text: { type: String, required: false }, media_src: String }],
});

const Topics = model("Topics", TopicsSchema);
export { Topics, TopicsSchema };
