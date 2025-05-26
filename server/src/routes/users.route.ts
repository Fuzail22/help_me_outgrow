import { Router } from "express";

const userRouter = Router();

userRouter.post("/");
userRouter.get("/");
userRouter.put("/");
userRouter.patch("/");
userRouter.delete("/");

export { userRouter };
