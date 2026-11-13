import { stateResponse, type Ctx } from "@/app/api/respond";

export const dynamic = "force-dynamic";
export const GET = async (_req: Request, { params }: Ctx) => stateResponse((await params).pg);
