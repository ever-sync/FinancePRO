declare module "../../dist/trpc-vercel.js" {
  import type { Request, Response } from "express";

  const app: (req: Request, res: Response) => unknown;
  export default app;
}
