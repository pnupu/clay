import { load, publicState } from "@/lib/store";

export const dynamic = "force-dynamic";
export const GET = () => Response.json(publicState(load()));
