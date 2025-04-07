const getTopics = (req, res) => {
  console.log("topics get");
  res.send("topics");
};
const postTopic = (req, res) => {
  console.log("topics post");
  res.send("success");
};

export { getTopics, postTopic };
