import { InferSchemaType, model, Schema } from "mongoose";

const topicsDataSchema = new Schema(
  {
    text: { type: String, required: false },
    media_src: String,
  },
  { _id: false }
);

const topicsSchema = new Schema({
  name: { type: String, required: true, unique: true },
  data: [topicsDataSchema],
  users: [{ type: String }],
  isPublic: { type: Boolean, required: true },
});

topicsSchema.pre("save", function (next) {
  const uniqueTexts = new Set(this.data.map((item) => item));
  if (uniqueTexts.size !== this.data.length)
    return next(
      new Error("Duplicate text values are not allowed in data array")
    );
  next();
});
const Topics = model("Topics", topicsSchema);
export { Topics, topicsSchema, topicsDataSchema };
