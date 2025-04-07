import { Days, TopicType } from "../../types/events.types";
import { match } from "assert";
import { dayTimeRegex } from "../../utils/regex";
import { Schema } from "mongoose";

const event = new Schema({
  topic: { type: String, enum: Object.values(TopicType), required: true },
  times: [{ type: String, match: dayTimeRegex, required: true }],
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  user: { type: String, required: true },
  media_type: { type: String, default: "text" },
});
