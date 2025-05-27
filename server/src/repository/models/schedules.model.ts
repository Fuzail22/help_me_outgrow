import mongoose, { isValidObjectId, Schema } from "mongoose";
import { timeRegex } from "../../utils/regex";

const schedulesSchema = new Schema({
  timeStamp: { type: String, match: timeRegex, required: true },
  events: [{ eventID: isValidObjectId, quote: String, required: true }],
});

const Schedules = mongoose.model("Schedules", schedulesSchema);

export { Schedules, schedulesSchema };
