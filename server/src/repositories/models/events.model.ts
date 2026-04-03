import { Days, TopicType } from "../../types/events.types";
import { match } from "assert";
import { dayTimeRegex } from "../../utils/regex";
import mongoose, { isValidObjectId, Model, Schema, Types } from "mongoose";
//todo need a transformer that translates start and end date's time to 00:00 and 23:59 respectively
const notificationEventsSchema = new Schema({
  _id: Types.ObjectId,
  topic: { type: String, enum: Object.values(TopicType), required: true },
  times: [{ type: String, match: dayTimeRegex, required: true }],
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  userId: { type: String, required: true },
  media_type: { type: String, default: "text" },
  failureCount: { type: Number, default: 0 },
  created_at: { type: Date, required: true, default: new Date().toISOString() },
});

const notificationEvent = mongoose.model(
  "notificationEvent",
  notificationEventsSchema
);
export { notificationEvent, notificationEventsSchema };
