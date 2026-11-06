import { Schema } from "mongoose";

export const user = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique:true },
  // password: { type: String, required: true }, since google sign in will be used
  userId: { type: String, required: true },
  created_at: { type: Date, required: true },
  modified_at: { type: Date, required: true },
  devices: [
    {
      deviceID: String,
      endpoint: String,
      expired: { type: Boolean, required: true, default: false },
    },
  ],
});
