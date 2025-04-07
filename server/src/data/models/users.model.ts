import { Schema } from "mongoose";

const user = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  // password: { type: String, required: true },
  userId: { type: String, required: true },
  created_at: { type: Date, required: true },
  modified_at: { type: Date, required: true },
  devices: [{ deviceID: String, endpoint: String }],
});
