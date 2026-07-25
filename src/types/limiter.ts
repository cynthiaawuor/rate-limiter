import type { Request } from "express";

export type KeyGenerator = (req: Request) => string;
