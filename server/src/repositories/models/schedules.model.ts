import mongoose, { isValidObjectId, Schema, Types } from "mongoose";
import { timeRegex } from "../../utils/regex";

const schedulesSchema = new Schema({
  timeStamp: { type: Date, required: true },
  events: [
    {
      userId: { type: String, required: true },
      content: [{ eventId: Types.ObjectId, quote: String, required: true }],
    },
  ],
});

const Schedules = mongoose.model("Schedules", schedulesSchema);

export { Schedules, schedulesSchema };
